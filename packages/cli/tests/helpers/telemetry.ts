import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import {
  INDEX_PUBLIC_KEYS,
  TelemetryAccepted,
  TelemetryBatch,
  TelemetryEvent,
  TelemetryEventV2,
  TelemetryEventV3,
} from "@steamfield/stacks-format";
import { type Clock, Effect, type FileSystem, Layer, type Path, Schema } from "effect";
import type { HttpClient } from "effect/http";
import { expect } from "vitest";
import { AppConfig, type Environment } from "../../src/config";
import { Allowlist } from "../../src/core/allowlist";
import { ErrorEnvelope } from "../../src/errors";
import { NetLayer } from "../../src/platform/net";
import { Host } from "../../src/services/host";
import { runCli, tempDir } from "./cli";
import { environment } from "./remote-index";

export const telemetryModule = join(import.meta.dirname, "../../src/telemetry/index.ts");
export const registry = join(import.meta.dirname, "../fixtures/telemetry/registry");
export const decodeEvent = Schema.decodeUnknownSync(
  Schema.Union([TelemetryEvent, TelemetryEventV2, TelemetryEventV3]),
  { onExcessProperty: "error" },
);
export const telemetryRoot = (home: string) => join(home, "state/stacks/telemetry");
export const configFile = (home: string) => join(home, "config/stacks/config.json");
export const json = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));
export function writeJson(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
}
export function files(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [root];
  return readdirSync(root).flatMap((name) => {
    const file = join(root, name);
    return statSync(file).isDirectory() ? files(file) : [file];
  });
}
export const spoolFiles = (home: string) => files(join(telemetryRoot(home), "spool"));
export const spooled = (home: string) => spoolFiles(home).map((file) => decodeEvent(json(file)));
export const ok = (result: Awaited<ReturnType<typeof runCli>>) => {
  expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.trim()).not.toBe("");
};
export function failure(result: Awaited<ReturnType<typeof runCli>>, tag: string, status: number) {
  expect(result.status).toBe(status);
  expect(result.stdout).toBe("");
  const lines = result.stderr.trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(Schema.decodeUnknownSync(ErrorEnvelope)(JSON.parse(lines[0] ?? ""))).toMatchObject({
    error: { tag },
  });
}
const Status = Schema.Struct({
  reason: Schema.String,
  installId: Schema.optionalKey(Schema.String.check(Schema.isUUID())),
  noticeShownAt: Schema.optionalKey(Schema.String),
  spooled: Schema.Int,
});
const Flush = Schema.Struct({
  sent: Schema.Int,
  kept: Schema.Int,
  rejected: Schema.Int,
  reason: Schema.String,
});
export const statusValue = (stdout: string) =>
  Schema.decodeUnknownSync(Status, { onExcessProperty: "error" })(JSON.parse(stdout));
export const flushValue = (stdout: string) =>
  Schema.decodeUnknownSync(Flush, { onExcessProperty: "error" })(JSON.parse(stdout));
export type TelemetryOptions = Omit<NonNullable<Parameters<typeof runCli>[1]>, "program"> & {
  releaseBuild?: boolean;
  /** runCli applies this clock to the whole invocation, including layer construction. */
  clock?: Clock.Clock;
};
type TelemetryDependencies =
  | AppConfig
  | Host
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient;
/** A complete real layer for core tests that consume RunRecord without invoking the parser. */
export async function telemetryLayer(options: { home: string; cwd: string; env: Environment }) {
  const { Telemetry } = await import(telemetryModule);
  const layer: Layer.Layer<unknown, never, TelemetryDependencies> = Telemetry.layer({}).pipe(
    Layer.provideMerge(Allowlist.layer({ keys: INDEX_PUBLIC_KEYS })),
  );
  const config = Layer.effect(
    AppConfig,
    Effect.map(AppConfig, (live) => ({ ...live, releaseBuild: true })),
  ).pipe(
    Layer.provide(AppConfig.memory({ ...environment(options.home), ...options.env })),
    Layer.provide(NodeServices.layer),
  );
  return layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        config,
        Host.memory({ cwd: options.cwd, platform: "darwin", registry }),
        NetLayer,
        NodeServices.layer,
      ),
    ),
  );
}
/** Existing runCli must gain releaseBuild; this wrapper leaves that existing file untouched. */
export async function telemetryCli(
  args: readonly string[],
  options: TelemetryOptions & { home: string },
) {
  // A computed import keeps tsc green until the planned module lands, but each test still runs.
  await import(telemetryModule);
  const invocation = {
    ...options,
    releaseBuild: options.releaseBuild ?? true,
    env: { ...environment(options.home), ...options.env },
    host: { registry, platform: "darwin", ...options.host },
  };
  return runCli(args, invocation);
}
export function workspace() {
  const temp = tempDir();
  return { home: realpathSync(temp.path), cleanup: temp.cleanup };
}
export async function notified(home: string, url: string) {
  const result = await telemetryCli(["show", "go-cli", "--json"], {
    home,
    env: { STACKS_TELEMETRY_URL: url },
  });
  ok(result);
  expect(JSON.parse(result.stdout)).toHaveProperty("notice");
  expect(spooled(home)).toEqual([]);
}
export async function queue(home: string, url: string, count = 1) {
  for (let i = 0; i < count; i++) {
    const { Telemetry } = await import(telemetryModule);
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* (yield* Telemetry).recordShow({
          kind: "stack",
          id: "go-cli",
          origin: "bundled",
          trusted: true,
        });
      }).pipe(
        Effect.provide(
          await telemetryLayer({ home, cwd: home, env: { STACKS_TELEMETRY_URL: url } }),
        ),
      ),
    );
  }
  expect(spooled(home)).toHaveLength(count);
}
/** Seed backlog from a real queued event, retaining the sender's own disk representation. */
export function seed(home: string, count: number, sentAt = new Date().toISOString()) {
  const first = spooled(home)[0];
  if (!first) throw new Error("Queue one real event before seeding a backlog");
  const events = Array.from({ length: count }, (_, i) =>
    decodeEvent({
      ...first,
      eventId: randomUUID(),
      sentAt: new Date(Date.parse(sentAt) + i).toISOString(),
    }),
  );
  for (const event of events)
    writeJson(join(telemetryRoot(home), "spool", `${event.eventId}.json`), event);
  return events;
}
export async function telemetryServer() {
  const requests: {
    method: string;
    path: string;
    events: readonly TelemetryBatch["events"][number][];
  }[] = [];
  const errors: unknown[] = [];
  const held: { response: ServerResponse; events: readonly TelemetryBatch["events"][number][] }[] =
    [];
  let mode: "accept" | "hold" | "fail" | "foreign" | "reject" | "retry" = "accept";
  let retryStatus = 429;
  let retryAfter = "1200";
  const reply = (response: ServerResponse, events: readonly TelemetryBatch["events"][number][]) => {
    let rejected: string[] = [];
    if (mode === "foreign") rejected = [randomUUID()];
    if (mode === "reject") rejected = events.slice(0, 1).map((e) => e.eventId);
    const accepted = Schema.decodeUnknownSync(TelemetryAccepted, { onExcessProperty: "error" })({
      rejected,
    });
    response.writeHead(202, { "Content-Type": "application/json" }).end(JSON.stringify(accepted));
  };
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const batch = Schema.decodeUnknownSync(TelemetryBatch, { onExcessProperty: "error" })(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      const events = batch.events.map((event) => decodeEvent(event));
      requests.push({ method: request.method ?? "", path: request.url ?? "", events });
      if (mode === "hold") {
        held.push({ response, events });
        return;
      }
      if (mode === "fail") {
        response.writeHead(500).end();
        return;
      }
      if (mode === "retry") {
        response.writeHead(retryStatus, { "Retry-After": retryAfter }).end();
        return;
      }
      reply(response, events);
    } catch (error) {
      errors.push(error);
      response.writeHead(400).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing fixture port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    errors,
    events: () => requests.flatMap((request) => request.events),
    mode(value: typeof mode) {
      mode = value;
    },
    retry(status: number, after: string) {
      mode = "retry";
      retryStatus = status;
      retryAfter = after;
    },
    release() {
      for (const { response, events } of held.splice(0)) reply(response, events);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
export type TelemetryServer = Awaited<ReturnType<typeof telemetryServer>>;
