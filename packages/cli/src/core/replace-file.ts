import { Effect, FileSystem, Path, type PlatformError } from "effect";

/** Stage under the target's parent so the final rename stays on one filesystem. */
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
      const writeOptions: { flag: "wx"; mode?: number } = {
        flag: "wx",
        ...(options?.mode === undefined ? {} : { mode: options.mode }),
      };
      yield* typeof text === "string"
        ? fs.writeFileString(temporary, text, writeOptions)
        : fs.writeFile(temporary, text, writeOptions);
      yield* fs.rename(temporary, target);
    }),
  );
