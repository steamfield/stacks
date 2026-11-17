import { Effect, FileSystem } from "effect";
import { Command } from "effect/cli";
import { cli } from "../../src/cli";
import { VERSION } from "../../src/version";

/** Runs the real command with a filesystem fault or interrupt at a particular operation. */
export function commandWithFileSystem(
  args: readonly string[],
  overrides: (fs: FileSystem.FileSystem) => Partial<FileSystem.FileSystem>,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* Command.runWith(cli, { version: VERSION, renderErrors: false })(args).pipe(
      Effect.provideService(FileSystem.FileSystem, FileSystem.make({ ...fs, ...overrides(fs) })),
    );
  });
}
