/** Owns the fixed git commands used to inspect or initialize a project (trust point 1). */
import { Duration, Effect, FileSystem, Option } from "effect";
import { AppConfig } from "../../config";
import { GIT_REPOSITORY_VARIABLES } from "../../env-names";
import type { NewResult } from "../../schemas/new";
import { type Finished, Processes } from "../../services/processes";
import type { GitState } from "../brief/types";
import type { Target } from "./target";

const TIMEOUT = Duration.seconds(10);
const TOPLEVEL = "git rev-parse --show-toplevel 2>&1";
const HAS_COMMIT = "git rev-parse --verify --quiet HEAD >/dev/null 2>&1";
const INIT = "git init --quiet";
const USER_NAME = "git config user.name 2>/dev/null";
/** What git prints when no repository encloses its working directory. */
const NOT_A_REPOSITORY = "not a git repository";

/**
 * Clear hook-exported repository variables so git resolves from `cwd`. Keep diagnostics
 * untranslated for `probeGit`.
 */
const git = (command: string, cwd: string) =>
  Effect.gen(function* () {
    const processes = yield* Processes;
    const env = (yield* AppConfig).childEnv(GIT_REPOSITORY_VARIABLES, { LC_ALL: "C" });
    return yield* processes
      .run({ command, cwd, env, timeout: TIMEOUT })
      .pipe(Effect.catchTag("SpawnFailed", () => Effect.succeed(undefined)));
  });

const ok = (finished: Finished | undefined): finished is Finished =>
  finished !== undefined && finished.exitCode === 0 && !finished.timedOut;

/** A git command's exit code for a warning: 124 for a timeout, none when it couldn't start. */
const exitOf = (finished: Finished | undefined) => {
  if (finished === undefined) return undefined;
  return finished.timedOut ? 124 : finished.exitCode;
};

/** The last line `git rev-parse --show-toplevel` printed, when it succeeded with one. */
const toplevelOf = (finished: Finished | undefined) =>
  ok(finished) ? finished.tail.trim().split("\n").at(-1) || undefined : undefined;

const isUnenclosed = (found: Finished | undefined) =>
  found !== undefined &&
  found.exitCode !== 0 &&
  !found.timedOut &&
  found.tail.includes(NOT_A_REPOSITORY);

export const gitToplevel = (cwd: string) => Effect.map(git(TOPLEVEL, cwd), toplevelOf);

export const gitInstalled = Effect.gen(function* () {
  return Option.isSome(yield* (yield* Processes).which("git"));
});

export type GitProbe = {
  state: GitState;
  /** Whether `new` should run `git init`: only for a fresh target with no `.git` of its own. */
  init: boolean;
  /** The repository is the target's own (its root is the target), not one enclosing it. */
  own: boolean;
  /** Set when git couldn't say where the target stands; the state is then `none`. */
  warning?: NewResult["warnings"][number];
};

const NO_GIT: GitProbe = { state: { kind: "none" }, init: false, own: false };

/** The probe when git found no toplevel: fresh if git says there's no repository, else unusable. */
function withoutToplevel(target: Target, found: Finished | undefined): GitProbe {
  // A `.git` in the target that git doesn't see as a repository is not ours to init over.
  if (isUnenclosed(found) && !target.git)
    return { state: { kind: "fresh" }, init: true, own: false };
  const exitCode = exitOf(found);
  return {
    ...NO_GIT,
    warning: {
      code: "git_unusable",
      id: "git",
      ...(exitCode === undefined ? {} : { exitCode }),
    },
  };
}

/**
 * Only git's "not a git repository" counts as no repository. Other failures warn as `git_unusable`
 * to guard against initializing over a broken `.git` or nesting inside an unreadable repository.
 */
export const probeGit = (
  target: Target,
  installed: boolean,
): Effect.Effect<GitProbe, never, FileSystem.FileSystem | Processes | AppConfig> =>
  Effect.gen(function* () {
    if (!installed) return NO_GIT;
    const fs = yield* FileSystem.FileSystem;
    const found = yield* git(TOPLEVEL, target.nearest);
    const toplevel = toplevelOf(found);
    if (!toplevel) return withoutToplevel(target, found);
    const real = (at: string) => fs.realPath(at).pipe(Effect.orElseSucceed(() => at));
    const own = target.exists && (yield* real(toplevel)) === (yield* real(target.path));
    if (!own)
      return { state: { kind: "parent", toplevel }, init: false, own: false } satisfies GitProbe;
    // The target's own repository: still fresh until something is committed in it.
    const committed = ok(yield* git(HAS_COMMIT, target.path));
    const state: GitState = committed ? { kind: "parent", toplevel } : { kind: "fresh" };
    return { state, init: false, own: true } satisfies GitProbe;
  });

/** `git init --quiet` in the project root: its exit code, or 127 when git couldn't start. */
export const gitInit = (root: string) =>
  Effect.gen(function* () {
    const finished = yield* git(INIT, root);
    if (!finished) return 127;
    // A timed-out git that still reported 0 didn't finish its init.
    return finished.timedOut && finished.exitCode === 0 ? 124 : finished.exitCode;
  });

/** `git config user.name` from `cwd` (the target's nearest existing directory), else empty. */
export const gitUserName = (cwd: string) =>
  Effect.gen(function* () {
    const finished = yield* git(USER_NAME, cwd);
    return ok(finished) ? (finished.tail.split("\n")[0]?.trim() ?? "") : "";
  });
