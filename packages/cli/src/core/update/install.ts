/**
 * Works out how the running copy of stacks was installed, so `stacks update` knows whether it may
 * upgrade it in place.
 *
 * There are three answers. `npx` means the package runs from npx's cache, so the update command to
 * suggest is an `npx` one. `npm-global` means the package root is the one under npm's global
 * prefix (`npm prefix -g`, then `lib/node_modules/<package>`), compared by real path; only then
 * does `update.ts::update` run `npm install -g`. `other` covers everything else: a source checkout,
 * a project dependency, a missing `npm`, or an `npm prefix` that fails or times out.
 *
 * Detection is best effort. Any failure to look falls back to `other`, which only means the user
 * is shown the command instead of having it run; defects and interruption still propagate.
 */
import { Duration, Effect, FileSystem, Option, Path } from "effect";
import { AppConfig } from "../../config";
import { isNpxPath } from "../../invocation";
import { Host } from "../../services/host";
import { Processes } from "../../services/processes";
import { PACKAGE } from "../../version";

type Installation = { install: "npm-global"; npm: string } | { install: "npx" | "other" };

/** npm's global prefix from `npm prefix -g`, or none when it can't be run or says nothing. */
const globalPrefix = Effect.fn("update.globalPrefix")(function* (
  npm: string,
  timeout: Duration.Duration,
): Effect.fn.Return<Option.Option<string>, never, AppConfig | Processes> {
  const config = yield* AppConfig;
  const processes = yield* Processes;
  const { home } = yield* config.paths;
  const prefix = yield* processes
    .exec({ argv: [npm, "prefix", "-g"], cwd: home, env: config.childEnv([]), timeout })
    .pipe(Effect.catchTag("SpawnFailed", () => Effect.succeed(undefined)));
  if (prefix?.exitCode !== 0 || prefix.timedOut || !prefix.stdout.trim()) return Option.none();
  return Option.some(prefix.stdout.trim());
});

/** Whether `installed` and `running` resolve to the same real path; unresolvable is no. */
const samePlace = Effect.fn("update.samePlace")(function* (installed: string, running: string) {
  const fs = yield* FileSystem.FileSystem;
  const installedReal = yield* fs.realPath(installed).pipe(Effect.option);
  const runningReal = yield* fs.realPath(running).pipe(Effect.option);
  return (
    Option.isSome(installedReal) &&
    Option.isSome(runningReal) &&
    installedReal.value === runningReal.value
  );
});

const detectGlobal = Effect.fn("update.detectGlobal")(function* (
  timeout: Duration.Duration,
): Effect.fn.Return<
  Installation,
  never,
  AppConfig | Host | Processes | FileSystem.FileSystem | Path.Path
> {
  const host = yield* Host;
  const path = yield* Path.Path;
  const npm = yield* (yield* Processes).which("npm");
  if (Option.isNone(npm)) return { install: "other" };
  const prefix = yield* globalPrefix(npm.value, timeout);
  if (Option.isNone(prefix)) return { install: "other" };
  const installed = path.join(prefix.value, "lib", "node_modules", PACKAGE);
  if (yield* samePlace(installed, host.packageRoot))
    return { install: "npm-global", npm: npm.value };
  return { install: "other" };
});

/** Optional detection never prevents the version report; defects and interruption still propagate. */
export const installMethod = Effect.fn("update.installMethod")(function* (
  timeout = Duration.seconds(10),
) {
  if (isNpxPath((yield* Host).packageRoot)) return { install: "npx" } satisfies Installation;
  const found = yield* detectGlobal(timeout);
  if (found.install === "other") yield* Effect.logDebug("npm global install not detected");
  return found;
});
