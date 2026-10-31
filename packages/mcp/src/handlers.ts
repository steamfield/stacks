import { Effect, FileSystem, type Path, Ref, Result, Schema } from "effect";
import { McpSchema, McpServer } from "effect/ai";
import { decodeCli } from "./decode";
import { CliFailure } from "./errors";
import { CliRunner } from "./run";
import { ListResult, NewResult, VerifyEvent, VerifyResult } from "./schemas/cli";
import type { ListParams, NewParams, VerifyParams } from "./schemas/tools";
import { toolkit } from "./toolkit";

export const listHandler = Effect.fn("handlers.list")(function* (params: ListParams) {
  const runner = yield* CliRunner;
  const output = yield* runner.run([
    "list",
    "--json",
    ...(params.group === undefined ? [] : ["--", params.group]),
  ]);
  return (yield* decodeCli(ListResult, output, "list")).result;
});

function newArgs(params: NewParams): ReadonlyArray<string> {
  return [
    "new",
    "--no-launch",
    "--json",
    ...(params.preset === undefined ? [] : [`--preset=${params.preset}`]),
    ...(params.with ?? []).map((id) => `--with=${id}`),
    ...(params.without ?? []).map((id) => `--without=${id}`),
    "--",
    params.stack,
    params.dir,
  ];
}

export const newHandler = Effect.fn("handlers.new")(function* (params: NewParams) {
  const runner = yield* CliRunner;
  const output = yield* runner.run(newArgs(params));
  return (yield* decodeCli(NewResult, output, "new")).result;
});

const verifyDirectory = Effect.fn("handlers.verifyDirectory")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const invalid = (detail: string) =>
    new CliFailure({
      tag: "InvalidArgument",
      cliMessage: `Cannot verify ${dir}: ${detail}`,
      next: `Pass an existing project directory as dir: ${dir}.`,
      retryable: false,
    });
  const stat = yield* fs.stat(dir).pipe(Effect.mapError((error) => invalid(error.message)));
  if (stat.type !== "Directory") return yield* invalid("not a directory");
  return yield* fs.realPath(dir).pipe(Effect.mapError((error) => invalid(error.message)));
});

export const verifyHandler = Effect.fn("handlers.verify")(function* (
  params: VerifyParams,
  onStderrLine?: (line: string) => Effect.Effect<void>,
) {
  const runner = yield* CliRunner;
  const cwd = yield* verifyDirectory(params.dir);
  const output = yield* runner.run(["verify", "--json"], {
    cwd,
    ...(onStderrLine === undefined ? {} : { onStderrLine }),
  });
  const decoded = yield* decodeCli(VerifyResult, output, "verify");
  return { ...decoded.result, ...(decoded.next === undefined ? {} : { next: decoded.next }) };
});

export const forwardVerifyProgress = Effect.fn("handlers.forwardVerifyProgress")(function* (
  send: (update: { readonly progress: number; readonly message: string }) => Effect.Effect<void>,
) {
  const counter = yield* Ref.make(0);
  return Effect.fn("handlers.verifyProgress")(function* (line: string) {
    const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(VerifyEvent))(
      line,
    ).pipe(Effect.result);
    if (Result.isFailure(decoded)) return;
    const progress = yield* Ref.updateAndGet(counter, (value) => value + 1);
    const status = decoded.success.event === "step-started" ? "started" : decoded.success.status;
    yield* send({ progress, message: `${decoded.success.name}: ${status}` });
  });
});

export const handlerLayer = toolkit.toLayer(
  Effect.gen(function* () {
    const services = yield* Effect.context<CliRunner | FileSystem.FileSystem | Path.Path>();
    const server = yield* McpServer.McpServer;
    return {
      stacks_list: (params) => listHandler(params).pipe(Effect.provideContext(services)),
      stacks_new: (params) => newHandler(params).pipe(Effect.provideContext(services)),
      stacks_verify: Effect.fn("handlers.verifyRequest")(function* (params) {
        const request = yield* McpSchema.McpRequestContext;
        const token = request.requestMetadata?.progressToken;
        const onStderrLine =
          typeof token === "string" || typeof token === "number"
            ? yield* forwardVerifyProgress((update) =>
                server.notifications["notifications/progress"]({ progressToken: token, ...update }),
              )
            : undefined;
        return yield* verifyHandler(params, onStderrLine).pipe(Effect.provideContext(services));
      }),
    };
  }),
);
