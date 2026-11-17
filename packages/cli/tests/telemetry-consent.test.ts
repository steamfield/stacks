import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Environment } from "../src/config";
import { runCli } from "./helpers/cli";
import {
  configFile,
  failure,
  files,
  flushValue,
  json,
  notified,
  ok,
  queue,
  registry,
  spooled,
  statusValue,
  type TelemetryServer,
  telemetryCli,
  telemetryRoot,
  telemetryServer,
  workspace,
  writeJson,
} from "./helpers/telemetry";

let space: ReturnType<typeof workspace>;
let home: string;
let server: TelemetryServer;
beforeEach(async () => {
  space = workspace();
  home = space.home;
  server = await telemetryServer();
});
afterEach(async () => {
  await server.close();
  expect(server.errors).toEqual([]);
  space.cleanup();
});
const env = (): Environment => ({ STACKS_TELEMETRY_URL: server.url });
async function status(
  options: { env?: Environment; flags?: string[]; releaseBuild?: boolean } = {},
) {
  const result = await telemetryCli(["telemetry", "status", "--json", ...(options.flags ?? [])], {
    home,
    env: { ...env(), ...options.env },
    releaseBuild: options.releaseBuild,
  });
  ok(result);
  return statusValue(result.stdout);
}

describe("consent precedence", () => {
  const rows: {
    reason: string;
    env?: Environment;
    flags?: string[];
    config?: unknown;
    releaseBuild?: boolean;
  }[] = [
    { reason: "flag", flags: ["--no-telemetry"], env: { STACKS_OFFLINE: "1", DO_NOT_TRACK: "1" } },
    { reason: "offline", flags: ["--offline"], env: { DO_NOT_TRACK: "1" } },
    { reason: "offline", env: { STACKS_OFFLINE: "1", DO_NOT_TRACK: "1" } },
    { reason: "do_not_track", env: { DO_NOT_TRACK: "yes", STACKS_TELEMETRY_DISABLED: "1" } },
    {
      reason: "environment",
      env: { STACKS_TELEMETRY_DISABLED: "yes" },
      config: { telemetry: false },
    },
    { reason: "config", config: { telemetry: false }, env: { CI: "" } },
    { reason: "config_invalid", config: { telemetry: "false" }, env: { CI: "1" } },
    { reason: "ci", env: { CI: "" }, releaseBuild: false },
    { reason: "source_build", releaseBuild: false, env: { STACKS_TELEMETRY_URL: undefined } },
    { reason: "no_endpoint", env: { STACKS_TELEMETRY_URL: undefined } },
    { reason: "not_notified" },
    { reason: "enabled" },
  ];
  test.each(rows)("reports $reason, first matching row wins [4.1a#1]", async (row) => {
    if (row.reason === "enabled") await notified(home, server.url);
    if (row.config !== undefined) writeJson(configFile(home), row.config);
    const value = await status(row);
    expect(value.reason).toBe(row.reason);
    expect(value.spooled).toBe(0);
    expect(value.installId).toBeUndefined();
    expect(server.requests).toEqual([]);
    if (["source_build", "no_endpoint"].includes(row.reason))
      expect(existsSync(telemetryRoot(home))).toBe(false);
  });

  test("reports home_not_writable without falling back to the project [4.1a#1] [4.1a#20]", async () => {
    const state = join(home, "state");
    mkdirSync(state);
    chmodSync(state, 0o500);
    try {
      expect((await status()).reason).toBe("home_not_writable");
      const result = await telemetryCli(["show", "go-cli", "--json"], { home, env: env() });
      ok(result);
      const disabled = await telemetryCli(["show", "go-cli", "--json", "--no-telemetry"], {
        home,
        env: env(),
      });
      expect(result).toEqual(disabled);
      expect(files(state)).toEqual([]);
      expect(existsSync(join(home, ".stacks"))).toBe(false);
      expect(server.requests).toEqual([]);
    } finally {
      chmodSync(state, 0o700);
    }
  });

  test.each(["", "0", "false"])(
    "empty/false off switches (%j) do not disable consent [4.1a#1]",
    async (value) => {
      await notified(home, server.url);
      expect(
        (await status({ env: { DO_NOT_TRACK: value, STACKS_TELEMETRY_DISABLED: value } })).reason,
      ).toBe("enabled");
    },
  );
});

test("source invocations never create telemetry state or contact an endpoint [4.1a#2]", async () => {
  // Deliberately use runCli without releaseBuild, even with a configured endpoint.
  const options = {
    home,
    env: {
      ...env(),
      PATH: process.env.PATH,
      LOG_LEVEL: "none",
      XDG_STATE_HOME: join(home, "state"),
    },
    host: { registry },
  };
  for (const args of [
    ["new", "go-cli", "project", "--json"],
    ["show", "go-cli", "--json"],
    ["doctor", "--json"],
    ["list", "--json"],
    ["validate", registry, "--json"],
    ["telemetry", "status", "--json"],
    ["telemetry", "flush", "--json"],
  ]) {
    const result = await runCli(args, options);
    ok(result);
    expect(existsSync(telemetryRoot(home))).toBe(false);
  }
  for (const args of [
    ["add", "extra", "--json"],
    ["verify", "--json"],
    ["runs", "--json"],
  ]) {
    const result = await runCli(args, {
      ...options,
      host: { registry, cwd: join(home, "project") },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).not.toBe("");
    // verify's step events are its existing stderr contract.
    if (args[0] !== "verify") expect(result.stderr).toBe("");
    expect(existsSync(telemetryRoot(home))).toBe(false);
  }
  expect(server.requests).toEqual([]);
});

test("notice run has no identity or events; the next scaffold delivers [4.1a#3]", async () => {
  await notified(home, server.url);
  expect(server.requests).toEqual([]);
  const first = await status();
  expect(first).toEqual({ reason: "enabled", noticeShownAt: expect.any(String), spooled: 0 });
  expect(Number.isFinite(Date.parse(first.noticeShownAt ?? ""))).toBe(true);
  const result = await telemetryCli(["new", "go-cli", "project", "--json"], { home, env: env() });
  ok(result);
  expect(JSON.parse(result.stdout)).not.toHaveProperty("notice");
  expect(server.events()).toHaveLength(1);
  const event = server.events()[0];
  expect(event).toMatchObject({ type: "new", stack: "go-cli" });
  expect((await status()).installId).toBe(event?.installId);
  expect(spooled(home)).toEqual([]);
  expect(server.requests.map((r) => [r.method, r.path])).toEqual([["POST", "/v1/events"]]);
});

test.each(["do_not_track", "config", "flag"])(
  "queued events obey %s on the next command [4.1a#4]",
  async (reason) => {
    await notified(home, server.url);
    await queue(home, server.url);
    const ids = spooled(home).map((e) => e.eventId);
    if (reason === "config") writeJson(configFile(home), { telemetry: false });
    const result = await telemetryCli(
      ["new", "go-cli", "project", "--json", ...(reason === "flag" ? ["--no-telemetry"] : [])],
      {
        home,
        env: { ...env(), ...(reason === "do_not_track" ? { DO_NOT_TRACK: "1" } : {}) },
      },
    );
    ok(result);
    expect(server.requests).toEqual([]);
    expect(spooled(home).map((e) => e.eventId)).toEqual(reason === "flag" ? ids : []);
    if (reason === "flag") {
      ok(await telemetryCli(["new", "go-cli", "next", "--json"], { home, env: env() }));
      expect(server.events().map((e) => e.eventId)).toEqual(expect.arrayContaining(ids));
      expect(spooled(home)).toEqual([]);
    }
  },
);

test("disable purges identity and pending state; reset rotates identity without changing consent [4.1a#5]", async () => {
  await notified(home, server.url);
  await queue(home, server.url);
  const original = (await status()).installId;
  writeJson(join(telemetryRoot(home), "projects", "stale.json"), {});
  writeJson(join(telemetryRoot(home), "flush.json"), {});
  ok(
    await telemetryCli(["telemetry", "reset", "--json"], {
      home,
      env: { ...env(), CODEX_CI: "1" },
    }),
  );
  const reset = await status();
  expect(reset.reason).toBe("enabled");
  expect(reset.installId).toBeDefined();
  expect(reset.installId).not.toBe(original);
  expect(reset.spooled).toBe(0);
  for (const name of ["projects", "flush.json"])
    expect(files(join(telemetryRoot(home), name))).toEqual([]);
  await queue(home, server.url);
  ok(
    await telemetryCli(["telemetry", "disable", "--json"], {
      home,
      env: { ...env(), CODEX_CI: "1" },
    }),
  );
  expect(json(configFile(home))).toMatchObject({ telemetry: false });
  expect(files(telemetryRoot(home)).map((f) => f.slice(telemetryRoot(home).length + 1))).toEqual([
    "notice.json",
  ]);
  expect((await status()).reason).toBe("config");
  failure(
    await telemetryCli(["telemetry", "enable", "--json"], {
      home,
      env: { ...env(), CODEX_CI: "1" },
      host: { stdinIsTTY: true },
    }),
    "PermissionDenied",
    6,
  );
  failure(
    await telemetryCli(["telemetry", "enable", "--json"], { home, env: env() }),
    "PermissionDenied",
    6,
  );
  ok(
    await telemetryCli(["telemetry", "enable", "--json"], {
      home,
      env: env(),
      host: { stdinIsTTY: true },
    }),
  );
  expect(json(configFile(home))).toMatchObject({ telemetry: true });
  expect((await status()).installId).toBeUndefined();
  expect(server.requests).toEqual([]);
});

test.each([false, true])(
  "manual flush rechecks standing consent (off=%s) [4.1a#14]",
  async (off) => {
    await notified(home, server.url);
    await queue(home, server.url, 3);
    const result = await telemetryCli(["telemetry", "flush", "--json"], {
      home,
      env: { ...env(), ...(off ? { DO_NOT_TRACK: "1" } : {}) },
    });
    ok(result);
    expect(flushValue(result.stdout)).toEqual({
      sent: off ? 0 : 3,
      kept: 0,
      rejected: 0,
      reason: off ? "do_not_track" : "enabled",
    });
    expect(server.events()).toHaveLength(off ? 0 : 3);
    expect(spooled(home)).toEqual([]);
  },
);

test.each([
  { reason: "do_not_track", env: { DO_NOT_TRACK: "1" }, purge: true },
  { reason: "environment", env: { STACKS_TELEMETRY_DISABLED: "1" }, purge: true },
  { reason: "ci", env: { CI: "false" }, purge: true },
  { reason: "config", config: { telemetry: false }, purge: true },
  { reason: "config_invalid", config: { telemetry: "broken" }, purge: false },
  { reason: "flag", flags: ["--no-telemetry"], purge: false },
  { reason: "offline", flags: ["--offline"], purge: false },
  { reason: "offline", env: { STACKS_OFFLINE: "1" }, purge: false },
])("flush honors $reason after enqueue [4.1a#28]", async (row) => {
  await notified(home, server.url);
  await queue(home, server.url);
  const before = spooled(home);
  if (row.config) writeJson(configFile(home), row.config);
  const result = await telemetryCli(["telemetry", "flush", "--json", ...(row.flags ?? [])], {
    home,
    env: { ...env(), ...row.env },
  });
  ok(result);
  expect(flushValue(result.stdout)).toEqual({
    sent: 0,
    kept: row.purge ? 0 : 1,
    rejected: 0,
    reason: row.reason,
  });
  expect(server.requests).toEqual([]);
  expect(spooled(home)).toEqual(row.purge ? [] : before);
});

test("malformed JSON config prevents sending but preserves pending events [4.1a#28]", async () => {
  await notified(home, server.url);
  await queue(home, server.url);
  mkdirSync(dirname(configFile(home)), { recursive: true });
  writeFileSync(configFile(home), "{half-edited");
  expect((await status()).reason).toBe("config_invalid");
  expect(spooled(home)).toHaveLength(1);
  expect(server.requests).toEqual([]);
});
