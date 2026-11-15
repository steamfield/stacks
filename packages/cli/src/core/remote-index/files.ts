/**
 * Moves remote index entries between their downloaded form and a directory on disk.
 *
 * An index entry ships as a bundle: one JSON document listing every file of the entry with its
 * path, contents and executable bit. Its digest (`bundleDigest` from `@steamfield/stacks-format`)
 * is a SHA-256 over the canonical form of that list, and the signed index records the digest each
 * entry must have. `core/remote-index.ts` uses this module in two directions:
 *
 * - `directoryMatches` reads an extracted directory back into a bundle and recomputes its digest,
 *   so a cached copy is used only while it still hashes to what the index promised. Anything odd
 *   (a symlink, a missing file, an unreadable directory) is simply "doesn't match".
 * - `extractBundle` writes a verified bundle's files into an empty directory, refusing paths with
 *   empty or `.` segments before writing anything and never overwriting a file.
 */
import { bundleDigest, type EntryBundle, type IndexEntry } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path } from "effect";

type BundleFile = EntryBundle["files"][number];

/** Reads every file under `entry.dir` into a bundle; a symlink or other non-file fails. */
const directoryBundle = Effect.fn("remoteIndex.directoryBundle")(function* (
  entry: Pick<IndexEntry, "id" | "kind"> & { dir: string },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files: Array<BundleFile> = [];
  const visit = (relative: string): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      const at = path.join(entry.dir, relative);
      const stat = yield* fs.lstat(at);
      if (stat.type === "Directory") {
        for (const name of yield* fs.readDirectory(at))
          yield* visit(relative ? `${relative}/${name}` : name);
        return;
      }
      if (stat.type !== "File") return yield* Effect.fail("invalid");
      const content = yield* fs.readFile(at);
      files.push({
        path: relative,
        executable: (stat.mode & 0o111) !== 0,
        encoding: "base64",
        content: Buffer.from(content).toString("base64"),
      });
    });
  yield* visit("");
  return { id: entry.id, kind: entry.kind, files } satisfies EntryBundle;
});

/** True when the directory holds exactly the bundle with `entry.digest`; any failure is false. */
export const directoryMatches = (
  entry: Pick<IndexEntry, "id" | "kind" | "digest"> & { dir: string },
) =>
  directoryBundle(entry).pipe(
    Effect.flatMap(bundleDigest),
    Effect.map((digest) => digest === entry.digest),
    Effect.orElseSucceed(() => false),
  );

/** True for `a//b`, `./a` or a trailing slash: aliases of a path that `BundlePath` lets through. */
const hasAliasSegment = (filePath: string) =>
  filePath.split("/").some((segment) => segment === "" || segment === ".");

const fileBytes = (file: BundleFile) =>
  file.encoding === "utf8"
    ? new TextEncoder().encode(file.content)
    : Buffer.from(file.content, "base64");

/** Writes a bundle's files under `dir` with exclusive creates, after checking every path first. */
export const extractBundle = Effect.fn("remoteIndex.extract")(function* (
  bundle: EntryBundle,
  dir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // BundlePath already rejects traversal; aliases are rejected here, before any write.
  if (bundle.files.some((file) => hasAliasSegment(file.path))) return yield* Effect.fail("invalid");
  for (const file of bundle.files) {
    const at = path.join(dir, file.path);
    yield* fs.makeDirectory(path.dirname(at), { recursive: true });
    yield* fs.writeFile(at, fileBytes(file), {
      flag: "wx",
      mode: file.executable ? 0o755 : 0o644,
    });
  }
});
