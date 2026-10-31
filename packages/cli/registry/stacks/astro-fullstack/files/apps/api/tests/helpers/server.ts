import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { ConfigProvider, Context, Effect, Exit, Layer, Logger, References, Scope } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { onTestFinished } from "vitest";
import { App } from "../../src/app.ts";
import { type LogEntry, makeLogger } from "../../src/logging.ts";
import { FailureRoutes } from "./failures.ts";

export function capturedApp(records: LogEntry[], staticDir = "", maxBodyBytes = 1024) {
  return Layer.mergeAll(App, FailureRoutes).pipe(
    Layer.provideMerge(Logger.layer([makeLogger((record) => records.push(record))])),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnvRecord({
          LOG_LEVEL: "debug",
          MAX_BODY_BYTES: String(maxBodyBytes),
          STATIC_DIR: staticDir,
        }),
      ),
    ),
    Layer.provide(Layer.succeed(References.MinimumLogLevel, "Debug")),
  );
}

export async function testServer(staticDir = "", maxBodyBytes = 1024) {
  const records: LogEntry[] = [];
  const scope = await Effect.runPromise(Scope.make());
  const close = () => Effect.runPromise(Scope.close(scope, Exit.void));
  onTestFinished(close);
  const server = HttpRouter.serve(capturedApp(records, staticDir, maxBodyBytes), {
    disableLogger: true,
    disableListenLog: true,
  }).pipe(Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0, host: "127.0.0.1" })));
  const context = await Effect.runPromise(Layer.buildWithScope(server, scope));
  const address = Context.get(context, HttpServer.HttpServer).address;
  if (address._tag === "UnixPathAddress") throw new Error("Expected a TCP listener");
  return {
    records,
    request: (path: string, init?: RequestInit) =>
      fetch(`http://127.0.0.1:${address.port}${path}`, init),
  };
}
