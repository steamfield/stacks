/**
 * Decides what a failed filesystem write means for `stacks submit`.
 *
 * `submit` writes only into its own temporary directory (the clone, the pull request body), so a
 * denied write is something the user can fix, such as an unwritable `TMPDIR`, and reports as
 * `PermissionDenied` with the path. Any other filesystem failure there means the CLI's own
 * workspace broke, which is a defect rather than an expected failure. `submit.ts` and
 * `assemble.ts` wrap each write in `writePermission`.
 */
import { Effect, type PlatformError } from "effect";
import { PermissionDenied } from "../../errors";

/**
 * Keeps only platform permission failures recoverable at submit's write boundary. `path` is the
 * path to report, or a function that finds it in the error; a denial with no path is a defect.
 */
export const writePermission = <A, R>(
  operation: Effect.Effect<A, PlatformError.PlatformError, R>,
  path: string | ((error: PlatformError.PlatformError) => string | undefined),
) =>
  operation.pipe(
    Effect.catchTag("PlatformError", (error) => {
      const at = typeof path === "string" ? path : path(error);
      return error.reason._tag === "PermissionDenied" && at !== undefined
        ? Effect.fail(new PermissionDenied({ details: { reason: "write", path: at } }))
        : Effect.die(error);
    }),
  );
