import { Effect, type PlatformError } from "effect";
import { PermissionDenied } from "../../errors";

/** Keep only platform permission failures recoverable at submit's write boundary. */
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
