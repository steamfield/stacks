/**
 * Classifies submission write failures. Permission errors give the user a path they can fix, while
 * other failures in the CLI's own temporary workspace indicate a defect.
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
