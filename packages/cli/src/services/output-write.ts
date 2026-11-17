import { Effect } from "effect";
import { BrokenPipe, PermissionDenied } from "../errors";

export type Writer = (text: string) => Promise<void>;

/** Writes `text`, failing `BrokenPipe` on EPIPE and `PermissionDenied` on any other error. */
export function write(writer: Writer, text: string) {
  return Effect.tryPromise({
    try: () => writer(text),
    catch: (error) =>
      typeof error === "object" && error !== null && "code" in error && error.code === "EPIPE"
        ? new BrokenPipe()
        : new PermissionDenied({ details: { reason: "write" } }),
  });
}
