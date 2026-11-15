/**
 * Replaces a file's contents all at once, so a reader never sees a half-written file.
 *
 * The new bytes go to a fresh temporary directory beside the target, then a single rename moves
 * them into place. A rename is atomic only within one filesystem, which is why the temporary
 * directory sits under the target's own parent. Renaming over the target also replaces a symlink
 * planted there instead of writing through it. The temporary directory is scoped, so it is removed
 * whether the write succeeds or not.
 *
 * Every rewrite of a file the CLI keeps between runs goes through here: the state record
 * (`project-state.ts`), the run ledger (`ledger.ts`), cached downloads (`cached-fetch.ts`), the
 * search backoff (`search/remote.ts`) and telemetry's state (`telemetry/storage.ts`).
 */
import { Effect, FileSystem, Path, type PlatformError } from "effect";

/** Writes `text` to `target` through a temporary file and one rename; `mode` sets permissions. */
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
