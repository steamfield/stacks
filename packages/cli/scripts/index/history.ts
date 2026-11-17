import { Duration, Effect, FileSystem, Path } from "effect";
import { AppConfig } from "../../src/config";
import { Registry } from "../../src/core/registry/registry";
import { GIT_REPOSITORY_VARIABLES } from "../../src/env-names";
import { Processes } from "../../src/services/processes";

/** Every history read uses the checkout explicitly and drops inherited git selectors. */
export const historyExec = Effect.fn("index.historyExec")(function* (
  cwd: string,
  argv: readonly [string, ...string[]],
) {
  const processes = yield* Processes;
  const env = (yield* AppConfig).childEnv(GIT_REPOSITORY_VARIABLES);
  const result = yield* processes.exec({ argv, cwd, env, timeout: Duration.seconds(30) });
  if (result.exitCode !== 0 || result.timedOut || result.truncated)
    return yield* Effect.fail(
      new Error(`${argv.slice(0, 2).join(" ")}: failed while reading registry history.`),
    );
  return result.stdout.trim();
});

export const requireFullHistory = Effect.fn("index.requireFullHistory")(function* (cwd: string) {
  if ((yield* historyExec(cwd, ["git", "rev-parse", "--is-shallow-repository"])) === "true")
    return yield* Effect.fail(
      new Error(
        "Directory added dates need full history; fetch the full repository before building.",
      ),
    );
});

export const releaseTags = (cwd: string) =>
  historyExec(cwd, ["git", "tag", "--list", "--sort=version:refname", "v*"]).pipe(
    Effect.map((text) => text.split("\n").filter(Boolean)),
  );

/** Both published names and removed content read the same archived release registries. */
export const withReleaseRegistry = Effect.fn("index.withReleaseRegistry")(function* <A, E, R>(
  cwd: string,
  tag: string,
  read: (root: string) => Effect.Effect<A, E, R>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const checkout = yield* historyExec(cwd, ["git", "rev-parse", "--show-toplevel"]);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "stacks-release-" });
      const archive = path.join(temporary, "registry.tar");
      yield* historyExec(checkout, [
        "git",
        "archive",
        "--format=tar",
        `--output=${archive}`,
        tag,
        "packages/cli/registry/",
      ]);
      yield* historyExec(cwd, ["tar", "-xf", archive, "-C", temporary]);
      const root = path.join(temporary, "packages/cli/registry");
      return yield* read(root).pipe(
        Effect.provide(Registry.layer([{ origin: "bundled", path: root }])),
      );
    }),
  );
});
