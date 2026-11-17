/**
 * Compares on-disk entries with index digests and extracts downloaded bundles. Recomputing
 * `bundleDigest` allows reuse only while the disk contents match the index.
 */
import { bundleDigest, type EntryBundle, type IndexEntry } from "@steamfield/stacks-format";
import { Effect } from "effect";
import type { FileAccess } from "../types";

type BundleFile = EntryBundle["files"][number];

const directoryBundle = Effect.fn("remoteIndex.directoryBundle")(function* (
  { fs, path }: FileAccess,
  entry: Pick<IndexEntry, "id" | "kind"> & { dir: string },
) {
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
      // A link or special file cannot represent a cached bundle member.
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

/** Any failure to reconstruct the bundle counts as a digest mismatch. */
export const directoryMatches = (
  io: FileAccess,
  entry: Pick<IndexEntry, "id" | "kind" | "digest"> & { dir: string },
) =>
  directoryBundle(io, entry).pipe(
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

/** Create bundle files exclusively in the empty staging directory after checking every path. */
export const extractBundle = Effect.fn("remoteIndex.extract")(function* (
  { fs, path }: FileAccess,
  bundle: EntryBundle,
  dir: string,
) {
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
