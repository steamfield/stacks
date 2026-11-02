import { NodeRuntime, NodeServices, NodeStdio } from "@effect/platform-node";
import { Cause, Effect, Layer, Logger, References } from "effect";
import { McpProtocol, McpServer } from "effect/ai";
import pkg from "../package.json" with { type: "json" };
import { McpConfig } from "./config";
import { handlerLayer } from "./handlers";
import { resourceLayer } from "./resource";
import { CliRunner } from "./run";
import { toolkit } from "./toolkit";

const serverLayer = McpServer.layerStdio({
  name: "stacks-mcp",
  version: pkg.version,
  instructions:
    "Over MCP the loop is three tools: stacks_list to pick a stack, stacks_new with an absolute dir, then stacks_verify on that dir until the outcome is green. stacks://guide is the CLI's guide; it names CLI commands this server doesn't expose.",
  protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25],
});

const appLayer = Layer.mergeAll(McpServer.toolkit(toolkit), resourceLayer).pipe(
  Layer.provide(handlerLayer),
  Layer.provide(serverLayer),
  Layer.provide(NodeStdio.layer),
  Layer.provide(CliRunner.layer),
);

const main = Effect.gen(function* () {
  const config = yield* McpConfig;
  yield* Layer.launch(appLayer).pipe(
    Effect.provideService(McpConfig, config),
    Effect.provideService(Logger.LogToStderr, true),
    Effect.provideService(References.MinimumLogLevel, config.logLevel),
  );
}).pipe(
  Effect.provide(McpConfig.layer),
  Effect.catchTag("ConfigInvalid", (error) =>
    Effect.sync(() => {
      process.stderr.write(`${error.message.replaceAll("\n", " ")}\n`);
      return error;
    }).pipe(Effect.flatMap(Effect.fail)),
  ),
  Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(main, {
  disableErrorReporting: true,
  teardown: (exit, onExit) =>
    onExit(exit._tag === "Success" || Cause.hasInterruptsOnly(exit.cause) ? 0 : 1),
});
