import { Effect, FileSystem, Path, type PlatformError } from "effect";

/** Stage under the target's parent so the final rename stays on one filesystem. */
export const replaceFile = (
  target: string,
  text: string,
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
      yield* fs.writeFileString(temporary, text, {
        flag: "wx",
        ...(options?.mode === undefined ? {} : { mode: options.mode }),
      });
      yield* fs.rename(temporary, target);
    }),
  );
