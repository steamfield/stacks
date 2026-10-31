import { Effect, Schema } from "effect";
import { CliFailure } from "./errors";
import type { CliOutput } from "./run";
import { CliErrorEnvelope } from "./schemas/cli";

export const invalidOutput = (output: CliOutput, cause: unknown) =>
  new CliFailure({
    tag: "CliOutputInvalid",
    cliMessage: `Cannot decode the CLI output: ${cause instanceof Error ? cause.message : String(cause)}`,
    next: "Report this error; the server and CLI versions may not match.",
    retryable: false,
    exitCode: output.exit,
    details: {
      stderr: output.stderr.slice(-4096),
    },
  });

export const decodeJson = Effect.fn("decode.json")(function* <A>(
  schema: Schema.Decoder<A>,
  text: string,
  output: CliOutput,
) {
  const value: unknown = yield* Effect.try({
    try: () => JSON.parse(text),
    catch: (cause) => invalidOutput(output, cause),
  });
  return yield* Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((cause) => invalidOutput(output, cause)),
  );
});

export const decodeEnvelope = Effect.fn("decode.envelope")(function* (
  output: CliOutput,
  command: string,
) {
  const line = output.stderr.trimEnd().split("\n").at(-1) ?? "";
  const { error } = yield* decodeJson(CliErrorEnvelope, line, output);
  return new CliFailure({
    tag: error.tag,
    cliMessage: error.message,
    retryable: error.retryable,
    next: error.next ?? `Run stacks ${command} --help for the command's arguments.`,
    exitCode: output.exit,
    ...(error.rollback === undefined ? {} : { rollback: error.rollback }),
    ...(error.details === undefined ? {} : { details: error.details }),
  });
});

export const decodeCli = Effect.fn("decode.cli")(function* <A>(
  schema: Schema.Decoder<A>,
  output: CliOutput,
  command: string,
) {
  if (output.exit === 0) return { result: yield* decodeJson(schema, output.stdout, output) };
  const failure = yield* decodeEnvelope(output, command);
  if (command !== "verify" || output.exit !== 5) return yield* failure;
  const result = yield* decodeJson(schema, output.stdout, output).pipe(
    Effect.catchTag("CliFailure", () => failure),
  );
  return { result, next: failure.next };
});
