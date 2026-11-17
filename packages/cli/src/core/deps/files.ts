/**
 * Reads bounded project files for the dependency report. Unavailable files are omitted because
 * best-effort telemetry must never fail verification.
 */
import { ByteSize, Effect, type FileSystem, type Path } from "effect";

const MAX_BYTES = 2 * 1024 * 1024;

const isUnder = (file: string, root: string, prefix: string) =>
  file === root || file.startsWith(prefix);

/**
 * Bound reads to regular files of at most 2 MiB, with both lexical and real paths inside the
 * project.
 */
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
