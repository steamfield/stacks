/**
 * Reads one file from a project for the dependency report, with limits that keep a hostile or
 * unusual project from making the CLI read outside it or read something huge.
 *
 * `core/deps.ts::readDependencies` calls `readProjectFile` for each manifest and lockfile it
 * wants. A file is read only when both its given path and its real path (symlinks followed) stay
 * under the project root, when it is a regular file, and when it is at most 2 MiB. Any refusal or
 * read failure returns `null`, which the caller treats as "file not there": the report is
 * best-effort telemetry, so a file the CLI can't or won't read is left out rather than failing a
 * green verify run.
 */
import { ByteSize, Effect, type FileSystem, type Path } from "effect";

const MAX_BYTES = 2 * 1024 * 1024;

/** Whether `file` is `root` itself or a path below it; `prefix` is `root` plus a separator. */
const isUnder = (file: string, root: string, prefix: string) =>
  file === root || file.startsWith(prefix);

/** Read a regular file only when its resolved path stays under the project root. */
export const readProjectFile = Effect.fn("deps.readProjectFile")(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  relative: string,
) {
  const file = path.resolve(root, relative);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!isUnder(file, root, prefix)) return null;
  // A symlink inside the project may point anywhere, so the real path is checked as well.
  const real = yield* fs.realPath(file).pipe(Effect.orElseSucceed(() => null));
  if (real === null || !isUnder(real, root, prefix)) return null;
  const info = yield* fs.stat(file).pipe(Effect.orElseSucceed(() => null));
  if (info?.type !== "File" || ByteSize.toBigInt(info.size) > BigInt(MAX_BYTES)) return null;
  // The file may grow between stat and read, so the size is checked again on the bytes read.
  const bytes = yield* fs.readFile(file).pipe(Effect.orElseSucceed(() => null));
  if (bytes === null || bytes.byteLength > MAX_BYTES) return null;
  return new TextDecoder().decode(bytes).replace(/^﻿/u, "");
});
