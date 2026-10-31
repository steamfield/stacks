import { chmodSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AddResult } from "../src/schemas/add";
import { NewResult } from "../src/schemas/new";
import { ShowReport } from "../src/schemas/show";
import { TelemetryResult } from "../src/schemas/telemetry";
import { VerifyResult } from "../src/schemas/verify";
import { fakeAgent } from "./helpers/agents";
import { ndjson, scriptedTerminal } from "./helpers/cli";
import {
  configFile,
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
import { readManifestAt } from "./helpers/verify";

const decodeResult = Schema.decodeUnknownSync(
  Schema.Union([AddResult, NewResult, ShowReport, TelemetryResult, VerifyResult]),
  { onExcessProperty: "error" },
);
async function checkedCli(...args: Parameters<typeof telemetryCli>) {
  const result = await telemetryCli(...args);
  if (args[0].includes("--json") && result.stdout) decodeResult(JSON.parse(result.stdout));
  return result;
}

let space: ReturnType<typeof workspace>;
let server: TelemetryServer;
beforeEach(async () => {
  space = workspace();
  server = await telemetryServer();
});
afterEach(async () => {
  await server.close();
  expect(server.errors).toEqual([]);
  space.cleanup();
});

test("a registry override never exposes its entry or step names as official", async () => {
  const home = space.home;
  await notified(home, server.url);
  const env = { STACKS_TELEMETRY_URL: server.url, STACKS_REGISTRY_DIR: registry };
  ok(await checkedCli(["show", "go-cli", "--json"], { home, env }));
  expect(server.events()).toMatchObject([{ type: "show", id: "custom" }]);
  ok(await checkedCli(["new", "go-cli", "project", "--json"], { home, env }));
  const event = server.events().find((event) => event.type === "new");
  expect(event).toMatchObject({
    stack: "custom",
    fragments: ["custom"],
    nonOfficial: { user: 0, project: 0, source: 2 },
  });
  expect(event).not.toHaveProperty("fingerprint");
  expect(event).not.toHaveProperty("origin");
  expect(JSON.stringify(server.events())).not.toContain("go-cli");
});

test("add preserves the name allowlist instead of blessing hand-edited steps", async () => {
  const home = space.home;
  const env = { STACKS_TELEMETRY_URL: server.url };
  await notified(home, server.url);
  ok(await checkedCli(["new", "go-cli", "project", "--json"], { home, env }));
  const root = join(home, "project");
  const manifest = readManifestAt(root);
  writeFileSync(
    join(root, ".stacks/manifest.json"),
    JSON.stringify({
      ...manifest,
      verify: [
        ...manifest.verify,
        {
          name: "private-check",
          phase: "check",
          layer: "test",
          run: "true",
          owner: "go-cli",
          skipByDefault: false,
        },
      ],
    }),
  );
  const options = { home, env, host: { cwd: root, stdinIsTTY: true } };
  const accepted = await checkedCli(["verify", "--accept-changes", "--json"], options);
  expect(accepted.status, accepted.stderr).toBe(0);
  expect(JSON.parse(accepted.stdout)).toMatchObject({ outcome: "green" });
  expect(ndjson(accepted.stderr).length).toBeGreaterThan(0);
  ok(await checkedCli(["add", "extra", "--json"], options));
  const verified = await checkedCli(["verify", "--json"], options);
  expect(verified.status, verified.stderr).toBe(0);
  expect(JSON.parse(verified.stdout)).toMatchObject({ outcome: "green" });
  expect(ndjson(verified.stderr).length).toBeGreaterThan(0);
  const event = server
    .events()
    .filter((event) => event.type === "verify")
    .at(-1);
  expect(event).toMatchObject({ stepsChanged: 1 });
  expect(JSON.stringify(event)).not.toContain("private-check");
});

test("malformed settings preserve queued events when the config parent exists", async () => {
  const home = space.home;
  await notified(home, server.url);
  await queue(home, server.url);
  mkdirSync(join(home, "config/stacks"), { recursive: true });
  writeFileSync(configFile(home), "{half-edited");
  const result = await checkedCli(["telemetry", "status", "--json"], {
    home,
    env: { STACKS_TELEMETRY_URL: server.url },
  });
  ok(result);
  expect(statusValue(result.stdout)).toMatchObject({ reason: "config_invalid", spooled: 1 });
  expect(spooled(home)).toHaveLength(1);
  expect(server.requests).toEqual([]);
});

test("a failed spool stays silent even when human debug logs are enabled", async () => {
  const home = space.home;
  await notified(home, server.url);
  writeFileSync(join(telemetryRoot(home), "spool"), "blocked");
  const options = {
    home,
    env: { STACKS_TELEMETRY_URL: server.url, LOG_LEVEL: "debug" },
    host: { stdoutIsTTY: true },
  };
  const disabled = await checkedCli(["show", "go-cli", "--no-telemetry"], options);
  const actual = await checkedCli(["show", "go-cli"], options);
  expect(actual.status).toBe(0);
  expect(actual.stdout).toBe(disabled.stdout);
  expect(actual.stderr).not.toContain("Telemetry unavailable");
  expect(readFileSync(join(telemetryRoot(home), "spool"), "utf8")).toBe("blocked");
  expect(server.requests).toEqual([]);
});

test("a failed first JSON command cannot count as having delivered the notice", async () => {
  const home = space.home;
  const env = { STACKS_TELEMETRY_URL: server.url };
  mkdirSync(join(home, "occupied"));
  writeFileSync(join(home, "occupied/file"), "existing");
  const failed = await checkedCli(["new", "go-cli", "occupied", "--json"], { home, env });
  expect(failed.status).toBe(2);
  expect(failed.stdout).toBe("");
  expect(ndjson(failed.stderr)).toEqual([
    expect.objectContaining({ error: expect.objectContaining({ tag: "TargetNotEmpty" }) }),
  ]);
  expect(existsSync(join(telemetryRoot(home), "notice.json"))).toBe(false);
  await notified(home, server.url);
  expect(server.requests).toEqual([]);
  expect(spooled(home)).toEqual([]);
});

test("a failed JSON command leaves the second notice pending", async () => {
  const home = space.home;
  const env = { STACKS_TELEMETRY_URL: server.url };
  await notified(home, server.url);
  ok(await checkedCli(["new", "go-cli", "project", "--json"], { home, env }));
  const old = { noticeShownAt: new Date().toISOString(), noticeVersion: 1 };
  writeJson(join(telemetryRoot(home), "notice.json"), old);
  mkdirSync(join(home, "occupied"));
  writeFileSync(join(home, "occupied/file"), "existing");
  const failed = await checkedCli(["new", "go-cli", "occupied", "--json"], { home, env });
  expect(failed.status).toBe(2);
  expect(failed.stdout).toBe("");
  expect(JSON.parse(readFileSync(join(telemetryRoot(home), "notice.json"), "utf8"))).toEqual(old);
  const next = await checkedCli(["verify", "--json"], {
    home,
    env: { ...env, PATH: process.env.PATH },
    host: { cwd: join(home, "project") },
  });
  expect(next.status).toBe(0);
  expect(JSON.parse(next.stdout)).toHaveProperty("notice");
});

test("the second notice claim counts as shown while JSON output is pending", async () => {
  const home = space.home;
  const env = { STACKS_TELEMETRY_URL: server.url, PATH: process.env.PATH };
  await notified(home, server.url);
  ok(await checkedCli(["new", "go-cli", "project", "--json"], { home, env }));
  const noticeFile = join(telemetryRoot(home), "notice.json");
  writeJson(noticeFile, { noticeShownAt: new Date().toISOString(), noticeVersion: 1 });
  let writing = false;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cwd = join(home, "project");
  const first = checkedCli(["verify", "--json"], {
    home,
    env,
    host: { cwd },
    stdout: async () => {
      writing = true;
      await held;
    },
  });
  try {
    await vi.waitFor(() => expect(writing).toBe(true));
    expect(JSON.parse(readFileSync(noticeFile, "utf8"))).toMatchObject({
      noticeVersion: 2,
      pending: true,
      claimId: expect.stringMatching(/^second:/),
    });
    const second = await checkedCli(["verify", "--json"], { home, env, host: { cwd } });
    expect(second.status).toBe(0);
    expect(server.events().filter((event) => event.type === "verify")).toHaveLength(1);
  } finally {
    release();
  }
  expect((await first).status).toBe(0);
  expect(JSON.parse(readFileSync(noticeFile, "utf8"))).toMatchObject({ noticeVersion: 2 });
});

test("another invocation cannot queue before the first JSON notice is delivered", async () => {
  const home = space.home;
  const env = { STACKS_TELEMETRY_URL: server.url };
  let writing = false;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = checkedCli(["show", "go-cli", "--json"], {
    home,
    env,
    stdout: async () => {
      writing = true;
      await held;
    },
  });
  try {
    await vi.waitFor(() => expect(writing).toBe(true));
    const second = await checkedCli(["show", "go-cli", "--json"], { home, env });
    ok(second);
    expect(spooled(home)).toEqual([]);
    expect(existsSync(join(telemetryRoot(home), "install.json"))).toBe(false);
  } finally {
    release();
  }
  ok(await first);
  expect(JSON.parse((await first).stdout)).toHaveProperty("notice");
  expect(server.requests).toEqual([]);
});

test("add fingerprints the complete updated official composition", async () => {
  const home = space.home;
  const env = { STACKS_TELEMETRY_URL: server.url };
  await notified(home, server.url);
  const reference = await checkedCli(["new", "go-cli", "reference", "--with", "extra", "--json"], {
    home,
    env,
  });
  ok(reference);
  ok(await checkedCli(["new", "go-cli", "project", "--json"], { home, env }));
  ok(
    await checkedCli(["add", "extra", "--json"], {
      home,
      env,
      host: { cwd: join(home, "project") },
    }),
  );
  const added = server.events().find((event) => event.type === "add");
  expect(added).toMatchObject({ fingerprint: JSON.parse(reference.stdout).fingerprint });
});

test("a config opt-out during verify is read again before queueing or sending", async () => {
  const home = space.home;
  const env = { STACKS_TELEMETRY_URL: server.url };
  await notified(home, server.url);
  ok(await checkedCli(["new", "go-cli", "project", "--json"], { home, env }));
  await queue(home, server.url);
  const requests = server.requests.length;
  const result = await checkedCli(["verify", "--json"], {
    home,
    env,
    host: { cwd: join(home, "project") },
    stderr: async () => {
      writeJson(configFile(home), { telemetry: false });
    },
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ outcome: "green" });
  expect(ndjson(result.stderr).length).toBeGreaterThan(0);
  expect(server.requests).toHaveLength(requests);
  expect(spooled(home)).toEqual([]);
});

test("changing consent preserves file settings without persisting environment overrides", async () => {
  const home = space.home;
  writeJson(configFile(home), { author: "Original" });
  const result = await checkedCli(["telemetry", "disable", "--json"], {
    home,
    env: { STACKS_DATA_DIR: join(home, "temporary-data") },
  });
  ok(result);
  expect(JSON.parse(result.stdout)).toEqual({ enabled: false });
  expect(JSON.parse(readFileSync(configFile(home), "utf8"))).toEqual({
    author: "Original",
    telemetry: false,
  });
});
test("a non-flushing command observing a standing opt-out purges the backlog", async () => {
  const home = space.home;
  await notified(home, server.url);
  await queue(home, server.url);
  ok(
    await checkedCli(["show", "go-cli", "--json"], {
      home,
      env: { STACKS_TELEMETRY_URL: server.url, DO_NOT_TRACK: "1" },
    }),
  );
  expect(spooled(home)).toEqual([]);
  ok(
    await checkedCli(["telemetry", "flush", "--json"], {
      home,
      env: { STACKS_TELEMETRY_URL: server.url },
    }),
  );
  expect(server.requests).toEqual([]);
});
test("explicit reset and disable report an incomplete cleanup truthfully", async () => {
  const home = space.home;
  const options = { home, env: { STACKS_TELEMETRY_URL: server.url } };
  await notified(home, server.url);
  await queue(home, server.url);
  chmodSync(telemetryRoot(home), 0o500);
  try {
    const reset = await checkedCli(["telemetry", "reset", "--json"], options);
    ok(reset);
    expect(JSON.parse(reset.stdout)).toEqual({ reset: false });
    const disable = await checkedCli(["telemetry", "disable", "--json"], options);
    ok(disable);
    expect(JSON.parse(disable.stdout)).toEqual({ enabled: false, cleared: false });
  } finally {
    chmodSync(telemetryRoot(home), 0o700);
  }
});
test("flush does not remove active event or project staging directories", async () => {
  const home = space.home;
  await notified(home, server.url);
  await queue(home, server.url);
  for (const dir of ["spool", "projects"])
    writeJson(join(telemetryRoot(home), dir, ".write-active/value"), { pending: true });
  ok(
    await checkedCli(["telemetry", "flush", "--json"], {
      home,
      env: { STACKS_TELEMETRY_URL: server.url },
    }),
  );
  for (const dir of ["spool", "projects"])
    expect(readFileSync(join(telemetryRoot(home), dir, ".write-active/value"), "utf8")).toBe(
      '{"pending":true}',
    );
  expect(server.events()).toHaveLength(1);
});
test.each(["pending", "malformed"])(
  "an abandoned %s notice is recovered before collection",
  async (kind) => {
    const home = space.home;
    const file = join(telemetryRoot(home), "notice.json");
    const past = new Date(Date.now() - 11 * 60 * 1000);
    writeJson(file, { noticeShownAt: past.toISOString(), pending: true });
    if (kind === "malformed") writeFileSync(file, "{interrupted");
    utimesSync(file, past, past);
    await notified(home, server.url);
    expect(server.requests).toEqual([]);
    expect(spooled(home)).toEqual([]);
  },
);
test("backoff is checked before walking historical project records", async () => {
  const home = space.home;
  const options = { home, env: { STACKS_TELEMETRY_URL: server.url } };
  await notified(home, server.url);
  await queue(home, server.url);
  server.mode("fail");
  ok(await checkedCli(["telemetry", "flush", "--json"], options));
  const file = join(telemetryRoot(home), "projects/old.json");
  writeJson(file, { scaffoldedAt: "2000-01-01T00:00:00Z" });
  ok(await checkedCli(["telemetry", "flush", "--json"], options));
  expect(existsSync(file)).toBe(true);
  expect(server.requests).toHaveLength(1);
});

test.each(["new", "add"])(
  "%s records the selected launch after the human picker",
  async (command) => {
    const home = space.home;
    const env = { STACKS_TELEMETRY_URL: server.url };
    await notified(home, server.url);
    if (command === "add")
      ok(await checkedCli(["new", "go-cli", "project", "--json"], { home, env }));
    const bin = join(home, "bin");
    const claude = fakeAgent(bin, "claude");
    const codex = fakeAgent(bin, "codex");
    const result = await checkedCli(
      command === "new" ? ["new", "go-cli", "project"] : ["add", "extra"],
      {
        home,
        env: { ...env, PATH: bin },
        terminal: scriptedTerminal(["2"]),
        host: {
          cwd: command === "new" ? home : join(home, "project"),
          stdinIsTTY: true,
          stdoutIsTTY: true,
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Launching");
    expect(result.stderr).toBe("");
    expect(codex.ran()).toBe(true);
    expect(claude.ran()).toBe(false);
    expect(
      server
        .events()
        .filter((event) => event.type === command)
        .at(-1),
    ).toMatchObject({ handoff: "launch" });
  },
);
