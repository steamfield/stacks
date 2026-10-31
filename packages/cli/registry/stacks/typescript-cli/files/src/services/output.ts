import { Context, Effect, Layer } from "effect";
import { type AppError, BrokenPipe, errorEnvelope, errorTable, PermissionDenied } from "../errors";

export type Writer = (text: string) => Promise<void>;
const write = (writer: Writer, text: string) =>
  Effect.tryPromise({
    try: () => writer(`${text}\n`),
    catch: (error) =>
      typeof error === "object" && error !== null && "code" in error && error.code === "EPIPE"
        ? new BrokenPipe()
        : new PermissionDenied(),
  });

export class Output extends Context.Service<
  Output,
  {
    json: boolean;
    setJson: (value: boolean) => Effect.Effect<void>;
    result: (value: unknown, text: string) => Effect.Effect<void>;
    flush: Effect.Effect<void, BrokenPipe | PermissionDenied>;
    note: (text: string) => Effect.Effect<void, BrokenPipe | PermissionDenied>;
    error: (error: AppError) => Effect.Effect<void, BrokenPipe | PermissionDenied>;
  }
>()("app/Output") {
  static layer = (json: boolean, stdout: Writer, stderr: Writer) =>
    Layer.sync(Output, () => {
      const pending: string[] = [];
      let machine = json;
      return {
        get json() {
          return machine;
        },
        setJson: (value) =>
          Effect.sync(() => {
            machine = value;
          }),
        result: (value, text) =>
          Effect.sync(() => {
            pending.push(machine ? JSON.stringify(value) : text);
          }),
        flush: Effect.gen(function* () {
          for (const text of pending.splice(0)) yield* write(stdout, text);
        }),
        note: (text) => write(stderr, text),
        error: (error) =>
          write(
            stderr,
            machine ? JSON.stringify(errorEnvelope(error)) : errorTable[error._tag].message,
          ),
      };
    });
}
