import { sign } from "node:crypto";
import { cpSync, existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { it } from "@effect/vitest";
import {
  DependencyAllowlist,
  SignedIndex,
  TelemetryBatch,
  TelemetryEventV3,
} from "@steamfield/stacks-format";
import { Clock, Effect, Schema } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach, expect, test } from "vitest";
import { keyId, privateKey, publicKey } from "./fixtures/index/harness";
import { runCli, tempDir } from "./helpers/cli";
import { registry, telemetryRoot, writeJson } from "./helpers/telemetry";
import { readManifestAt } from "./helpers/verify";

const allowlist = Schema.decodeUnknownSync(DependencyAllowlist)({
  formatVersion: 1,
  generatedAt: "2026-10-28T00:00:00Z",
  names: { npm: ["react"], pypi: [], go: ["github.com/a/b"], crates: [] },
});
const decodeV3 = Schema.decodeUnknownSync(TelemetryEventV3, { onExcessProperty: "error" });
const decodeBatch = Schema.decodeUnknownSync(TelemetryBatch, { onExcessProperty: "error" });
function signed(payload: DependencyAllowlist, valid = true) {
  const bytes = JSON.stringify(payload);
  return Schema.decodeUnknownSync(SignedIndex)({
    keyId,
    payload: bytes,
    signature: valid
      ? sign(null, Buffer.from(bytes), readFileSync(privateKey)).toString("base64")
      : Buffer.alloc(64).toString("base64"),
  });
}
async function server() {
  const requests: string[] = [];
  const events: unknown[] = [];
  const errors: unknown[] = [];
  let envelope = signed(allowlist);
  const http = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      requests.push(path);
      if (path === "/v1/allowlist.json") {
        response
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify(envelope));
        return;
      }
      if (path === "/v1/events") {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const batch = decodeBatch(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        events.push(...batch.events);
        response.writeHead(202, { "Content-Type": "application/json" }).end('{"rejected":[]}');
        return;
      }
      response.writeHead(404).end();
    } catch (error) {
      errors.push(error);
      response.writeHead(400).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", resolve);
  });
  const address = http.address();
  if (address === null || typeof address === "string") throw new Error("No fixture port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    events,
    errors,
    setEnvelope(value: SignedIndex) {
      envelope = value;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()));
        http.closeAllConnections();
      }),
  };
}
type Server = Awaited<ReturnType<typeof server>>;
let temporary: ReturnType<typeof tempDir>;
let home: string;
let endpoint: Server;
beforeEach(async () => {
  temporary = tempDir();
  home = realpathSync(temporary.path);
  endpoint = await server();
});
afterEach(async () => {
  try {
    await endpoint.close();
    expect(endpoint.errors).toEqual([]);
  } finally {
    temporary.cleanup();
  }
});

async function invoke(
  args: string[],
  options: {
    cwd?: string;
    doNotTrack?: boolean;
    clock?: Clock.Clock;
    stdinIsTTY?: boolean;
  } = {},
) {
  return runCli(args, {
    home,
    releaseBuild: true,
    apiUrl: endpoint.url,
    allowlistKeys: [{ keyId, publicKey }],
    host: {
      registry,
      platform: "darwin",
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.stdinIsTTY ? { stdinIsTTY: true } : {}),
    },
    env: {
      STACKS_DEV_API_URL: endpoint.url,
      STACKS_TELEMETRY_URL: endpoint.url,
      XDG_CACHE_HOME: join(home, "cache"),
      XDG_STATE_HOME: join(home, "state"),
      PATH: process.env.PATH,
      LOG_LEVEL: "none",
      ...(options.doNotTrack ? { DO_NOT_TRACK: "1" } : {}),
    },
    ...(options.clock ? { clock: options.clock } : {}),
  });
}
function notice(version: number) {
  writeJson(join(telemetryRoot(home), "notice.json"), {
    noticeShownAt: "2026-10-28T00:00:00.000Z",
    noticeVersion: version,
  });
}
async function scaffold(clock?: Clock.Clock, name = "project", privateName?: string) {
  const result = await invoke(["new", "go-cli", name, "--json"], { clock });
  expect(result.status, result.stderr).toBe(0);
  expect(endpoint.requests).toContain("/v1/allowlist.json");
  const root = join(home, name);
  writeFileSync(
    join(root, "go.mod"),
    `module example.com/${name}\nrequire (\n github.com/a/b/v2 v2.3.1\n${privateName ? ` private.example/${privateName} v1.2.3\n` : ""})\n`,
  );
  return root;
}
function verifies() {
  return endpoint.events
    .filter(
      (event) =>
        typeof event === "object" && event !== null && "type" in event && event.type === "verify",
    )
    .map((event) => decodeV3(event));
}

let propertyProject = 0;
it.effect.prop(
  "unlisted package names stay out of serialized verify events [4.2d#1]",
  [Schema.String.check(Schema.isPattern(/^unlisted[a-z]{3,8}$/u))],
  ([privateName]) =>
    Effect.gen(function* () {
      notice(2);
      const root = yield* Effect.promise(() =>
        scaffold(undefined, `case-${propertyProject++}`, privateName),
      );
      const result = yield* Effect.promise(() => invoke(["verify", "--json"], { cwd: root }));
      expect(result.status, result.stderr).toBe(0);
      const event = verifies().at(-1);
      expect(event).toMatchObject({
        deps: [{ ecosystem: "go", name: "github.com/a/b", major: "2" }],
      });
      expect(JSON.stringify(event)).not.toContain(privateName);
    }),
  { arbitrary: { seed: "private-dependency", runs: 8 } },
);

test("list, show and new refresh the allowlist while verify uses the cache", async () => {
  notice(2);
  const cache = join(home, "cache/stacks");
  const count = () => endpoint.requests.filter((path) => path === "/v1/allowlist.json").length;
  for (const args of [
    ["list", "--json"],
    ["show", "go-cli", "--json"],
  ]) {
    rmSync(cache, { recursive: true, force: true });
    const before = count();
    const result = await invoke(args);
    expect(result.status, result.stderr).toBe(0);
    expect(count()).toBe(before + 1);
  }
  rmSync(cache, { recursive: true, force: true });
  const beforeNew = count();
  const root = await scaffold();
  expect(count()).toBe(beforeNew + 1);
  const beforeVerify = count();
  expect((await invoke(["verify", "--json"], { cwd: root })).status).toBe(0);
  expect(count()).toBe(beforeVerify);
});

it.effect("the signed allowlist cache respects 24-hour freshness and offline mode", () =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    yield* TestClock.setTime(Date.UTC(2026, 9, 28));
    notice(2);
    const count = () => endpoint.requests.filter((path) => path === "/v1/allowlist.json").length;
    expect((yield* Effect.promise(() => invoke(["list", "--json"], { clock }))).status).toBe(0);
    expect(count()).toBe(1);
    expect(existsSync(join(home, "cache/stacks/allowlist.json"))).toBe(true);
    expect(existsSync(join(home, "cache/stacks/allowlist.state.json"))).toBe(true);
    yield* TestClock.adjust("23 hours");
    expect(
      (yield* Effect.promise(() => invoke(["show", "go-cli", "--json"], { clock }))).status,
    ).toBe(0);
    expect(count()).toBe(1);
    yield* TestClock.adjust("1 hour");
    expect((yield* Effect.promise(() => invoke(["list", "--json"], { clock }))).status).toBe(0);
    expect(count()).toBe(2);
    yield* TestClock.adjust("24 hours");
    expect(
      (yield* Effect.promise(() => invoke(["list", "--json", "--offline"], { clock }))).status,
    ).toBe(0);
    expect(count()).toBe(2);
  }),
);

it.effect(
  "a bad allowlist signature sends no dependency names and keeps verify output [4.2d#7]",
  () =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock;
      yield* TestClock.setTime(Date.UTC(2026, 9, 28));
      endpoint.setEnvelope(signed(allowlist, false));
      notice(2);
      const root = yield* Effect.promise(() => scaffold(clock));
      const snapshot = tempDir();
      try {
        cpSync(home, join(snapshot.path, "before"), { recursive: true });
        const baseline = yield* Effect.promise(() =>
          invoke(["verify", "--json", "--no-telemetry"], { cwd: root, clock }),
        );
        rmSync(home, { recursive: true });
        cpSync(join(snapshot.path, "before"), home, { recursive: true });
        const result = yield* Effect.promise(() =>
          invoke(["verify", "--json"], { cwd: root, clock }),
        );
        expect(result.status).toBe(baseline.status);
        expect(result.stdout).toBe(baseline.stdout);
        expect(JSON.parse(result.stdout)).toMatchObject({ outcome: "green" });
        expect(verifies()).toHaveLength(1);
        expect(verifies()[0]).not.toHaveProperty("deps");
        expect(JSON.stringify(endpoint.events)).not.toContain("github.com/a/b");
      } finally {
        snapshot.cleanup();
      }
    }),
);

it.effect("green reports repeat after seven days; failed verify sends no deps [4.2d#8]", () =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    yield* TestClock.setTime(Date.UTC(2026, 9, 28));
    notice(2);
    const root = yield* Effect.promise(() => scaffold(clock));
    const run = () => invoke(["verify", "--json"], { cwd: root, clock });
    expect((yield* Effect.promise(run)).status).toBe(0);
    expect(verifies()).toHaveLength(1);
    expect(verifies().at(-1)).toMatchObject({
      type: "verify",
      schemaVersion: 3,
      deps: [{ ecosystem: "go", name: "github.com/a/b", major: "2" }],
    });
    yield* TestClock.adjust("1 day");
    expect((yield* Effect.promise(run)).status).toBe(0);
    expect(verifies()).toHaveLength(2);
    expect(verifies().at(-1)).not.toHaveProperty("deps");
    yield* TestClock.adjust("7 days");
    expect((yield* Effect.promise(run)).status).toBe(0);
    expect(verifies()).toHaveLength(3);
    expect(verifies().at(-1)).toHaveProperty("deps");
    yield* TestClock.adjust("7 days");
    const manifest = readManifestAt(root);
    const failing = {
      ...manifest,
      verify: manifest.verify.map((step) =>
        step.name === "test" ? { ...step, run: "false" } : step,
      ),
    };
    writeFileSync(join(root, ".stacks/manifest.json"), JSON.stringify(failing));
    const failed = yield* Effect.promise(() =>
      invoke(["verify", "--accept-changes", "--json"], { cwd: root, clock, stdinIsTTY: true }),
    );
    expect(failed.status).toBe(5);
    expect(verifies()).toHaveLength(4);
    expect(verifies().at(-1)).toMatchObject({ outcome: "failed" });
    expect(verifies().at(-1)).not.toHaveProperty("deps");
  }),
);

test("a v1 user sees the second notice before any dependency report [4.2d#9]", async () => {
  notice(2);
  const root = await scaffold();
  notice(1);
  const first = await invoke(["verify", "--json"], { cwd: root });
  expect(first.status, first.stderr).toBe(0);
  expect(JSON.parse(first.stdout)).toHaveProperty("notice");
  expect(first.stdout).toContain("dependenc");
  expect(first.stdout).toContain(`${endpoint.url}/telemetry`);
  expect(first.stdout).toContain("telemetry disable");
  expect(verifies().every((event) => !("deps" in event))).toBe(true);
  expect((await invoke(["verify", "--json"], { cwd: root })).status).toBe(0);
  expect(verifies().at(-1)).toHaveProperty("deps");
});

test("DO_NOT_TRACK suppresses the second notice and dependency report [4.2d#9]", async () => {
  notice(2);
  const root = await scaffold();
  notice(1);
  const before = endpoint.events.length;
  const result = await invoke(["verify", "--json"], { cwd: root, doNotTrack: true });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).not.toHaveProperty("notice");
  expect(endpoint.events).toHaveLength(before);
  expect(verifies().every((event) => !("deps" in event))).toBe(true);
});

it.effect(
  "verify output and exit stay byte-identical and verify never refreshes allowlist [4.2d#10]",
  () =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock;
      yield* TestClock.setTime(Date.UTC(2026, 9, 28));
      notice(2);
      const root = yield* Effect.promise(() => scaffold(clock));
      const snapshot = tempDir();
      try {
        cpSync(home, join(snapshot.path, "before"), { recursive: true });
        const before = endpoint.requests.filter((path) => path === "/v1/allowlist.json").length;
        const baseline = yield* Effect.promise(() =>
          invoke(["verify", "--json", "--no-telemetry"], { cwd: root, clock }),
        );
        rmSync(home, { recursive: true });
        cpSync(join(snapshot.path, "before"), home, { recursive: true });
        const actual = yield* Effect.promise(() =>
          invoke(["verify", "--json"], { cwd: root, clock }),
        );
        expect(actual.status).toBe(baseline.status);
        expect(actual.stdout).toBe(baseline.stdout);
        expect(endpoint.requests.filter((path) => path === "/v1/allowlist.json")).toHaveLength(
          before,
        );
      } finally {
        snapshot.cleanup();
      }
    }),
);
