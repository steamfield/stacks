import { type SpawnSyncOptions, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GIT_REPOSITORY_VARIABLES } from "../../src/env-names";

/**
 * This process's environment without the variables that point git at a repository. A git hook
 * (lefthook's pre-push runs the tests) exports `GIT_DIR`, and a test's own git call would
 * otherwise work on this checkout instead of its temporary directory.
 */
export function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of GIT_REPOSITORY_VARIABLES) delete env[name];
  return env;
}

/** A PATH directory under `home` holding only a `git` script with `body` as its case arms on "$1". */
export function gitShim(home: string, body: string): string {
  const bin = join(home, "shim-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "git"), `#!/bin/sh\ncase "$1" in\n${body}\n  *) exit 1 ;;\nesac\n`);
  chmodSync(join(bin, "git"), 0o755);
  return bin;
}
/** A shim's `rev-parse` arm that answers as git does outside any repository. */
export const NOT_A_REPO =
  '  rev-parse) echo "fatal: not a git repository (or any of the parent directories): .git" >&2; exit 128 ;;';

/**
 * Turns off git's automatic housekeeping. Without this a fixture `git commit` can start a detached
 * `git maintenance run --auto` that is still writing `.git/objects/maintenance.lock` when the test
 * snapshots or deletes the directory, and the test fails only when that background run is slow.
 */
const NO_BACKGROUND_MAINTENANCE = ["-c", "maintenance.auto=false", "-c", "gc.auto=0"];

/** `git ...args` on the real PATH, with `gitEnv()` unless `options.env` is given. */
export function spawnGit(args: readonly string[], options: SpawnSyncOptions = {}) {
  return spawnSync("git", [...NO_BACKGROUND_MAINTENANCE, ...args], { env: gitEnv(), ...options });
}
