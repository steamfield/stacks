/**
 * Replaces a file atomically so readers always get complete contents. A scoped temporary
 * directory beside the target keeps the rename on one filesystem and ensures cleanup. The
 * rename replaces a target symlink itself.
 */
import { Effect, FileSystem, Path, type PlatformError } from "effect";
import { defined } from "../object";

export const replaceFile = (
  target: string,
  text: string | Uint8Array,
  options?: { mode?: number },
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({
        directory: path.dirname(target),
        prefix: ".write-",
      });
      const temporary = path.join(directory, "value");
      // `wx` refuses to follow anything already at the temporary path.
      const writeOptions: { flag: "wx"; mode?: number } = defined({
        flag: "wx",
        mode: options?.mode,
      });
      yield* typeof text === "string"
        ? fs.writeFileString(temporary, text, writeOptions)
        : fs.writeFile(temporary, text, writeOptions);
      yield* fs.rename(temporary, target);
    }),
  );
