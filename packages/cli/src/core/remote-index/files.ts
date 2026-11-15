import { bundleDigest, type EntryBundle, type IndexEntry } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path } from "effect";

const directoryBundle = Effect.fn("remoteIndex.directoryBundle")(function* (
  entry: Pick<IndexEntry, "id" | "kind"> & { dir: string },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files: Array<EntryBundle["files"][number]> = [];
  const visit = (rel: string): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      const at = path.join(entry.dir, rel);
      const info = yield* fs.lstat(at);
      if (info.type === "Directory") {
        for (const name of yield* fs.readDirectory(at)) yield* visit(rel ? `${rel}/${name}` : name);
        return;
      }
      if (info.type !== "File") return yield* Effect.fail("invalid");
      const content = yield* fs.readFile(at);
      files.push({
        path: rel,
        executable: (info.mode & 0o111) !== 0,
        encoding: "base64",
        content: Buffer.from(content).toString("base64"),
      });
    });
  yield* visit("");
  return { id: entry.id, kind: entry.kind, files } satisfies EntryBundle;
});

export const directoryMatches = (
  entry: Pick<IndexEntry, "id" | "kind" | "digest"> & { dir: string },
) =>
  directoryBundle(entry).pipe(
    Effect.flatMap(bundleDigest),
    Effect.map((digest) => digest === entry.digest),
    Effect.orElseSucceed(() => false),
  );

export const extractBundle = Effect.fn("remoteIndex.extract")(function* (
  bundle: EntryBundle,
  dir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const file of bundle.files) {
    // BundlePath handles traversal; reject aliases too, before any write.
    if (file.path.split("/").some((part) => part === "" || part === "."))
      return yield* Effect.fail("invalid");
  }
  for (const file of bundle.files) {
    const at = path.join(dir, file.path);
    yield* fs.makeDirectory(path.dirname(at), { recursive: true });
    const bytes =
      file.encoding === "utf8"
        ? new TextEncoder().encode(file.content)
        : Buffer.from(file.content, "base64");
    yield* fs.writeFile(at, bytes, { flag: "wx", mode: file.executable ? 0o755 : 0o644 });
  }
});
