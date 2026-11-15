/**
 * The one rule for when a failed filesystem call means "nothing is there".
 *
 * Code that looks for something on disk has to tell "it isn't there" apart from "I couldn't
 * look". `isAbsent` treats `NotFound` and `BadResource` (ENOTDIR: a file sits where a directory
 * was expected, so nothing can be below it) as absent. Every other reason, such as
 * `PermissionDenied` or `Unknown`, means the CLI couldn't look, and callers fail rather than
 * report nothing there (`.claude/rules/cli/effect.md`, "Errors").
 *
 * Used where a path is probed on the way down to something: finding a manifest, an entry's
 * files, the writer's path checks. Readers of one known file whose absence has a default treat
 * only `NotFound` as absent and don't use this.
 */
import type { PlatformError } from "effect";

/** Whether a filesystem failure means nothing is at the path: `NotFound` or `BadResource`. */
export const isAbsent = (error: PlatformError.PlatformError) =>
  error.reason._tag === "NotFound" || error.reason._tag === "BadResource";
