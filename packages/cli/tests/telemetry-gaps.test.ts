import assert from "node:assert/strict";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { it } from "@effect/vitest";
import { Manifest, TelemetryEventV2, TelemetryEventV3 } from "@steamfield/stacks-format";
import { Clock, Effect, Schema } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NewResult } from "../src/schemas/new";
import { VerifyEvent, VerifyResult } from "../src/schemas/verify";
import { ndjson } from "./helpers/cli";
import {
  files,
  json,
  ok,
  spooled,
  spoolFiles,
  type TelemetryServer,
  telemetryCli,
  telemetryRoot,
  telemetryServer,
  workspace,
  writeJson,
} from "./helpers/telemetry";
import { readManifestAt } from "./helpers/verify";

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
const home = () => space.home;
const env = () => ({ STACKS_TELEMETRY_URL: server.url });
const run = (args: string[], cwd = home(), extra: Record<string, string> = {}) =>
  telemetryCli(args, { home: home(), env: { ...env(), ...extra }, host: { cwd } });
async function firstProject() {
  const result = await run(["new", "go-cli", "project", "--json"]);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toHaveProperty("notice");
  expect(server.requests).toEqual([]);
  expect(existsSync(join(telemetryRoot(home()), "install.json"))).toBe(false);
  expect(existsSync(join(telemetryRoot(home()), "deferred"))).toBe(true);
  return join(home(), "project");
}

test("notice scaffold is delivered before its first verify with the original project id and time", async () => {
  const root = await firstProject();
  const manifest = Schema.decodeUnknownSync(Manifest)(json(join(root, ".stacks/manifest.json")));
  const result = await run(["verify", "--json"], root);
  expect(result.status, result.stderr).toBe(0);
  const events = server
    .events()
    .map((event) =>
      Schema.decodeUnknownSync(TelemetryEventV3, { onExcessProperty: "error" })(event),
    );
  expect(events.map((event) => event.type)).toEqual(["new", "verify"]);
  const created = events.find((event) => event.type === "new");
  const verified = events.find((event) => event.type === "verify");
  expect(created?.projectId).toBe(verified?.projectId);
  const seconds = verified?.secondsSinceScaffold ?? -1;
  expect(seconds).toBeGreaterThanOrEqual(0);
  expect(seconds).toBeCloseTo(
    (Date.parse(verified?.sentAt ?? "") - Date.parse(manifest.createdAt)) / 1000,
    0,
  );
});

test("a notice-run scaffold and its first verify leave recoverable telemetry on disk", async () => {
  const created = await run(["new", "go-cli", "project", "--json"]);
  ok(created);
  const result = JSON.parse(created.stdout);
  expect(Object.keys(result).at(-1)).toBe("notice");
  expect(Schema.decodeUnknownSync(NewResult)(result).notice).toContain("telemetry disable");
  const cwd = join(home(), "project");
  const manifest = readManifestAt(cwd);
  const root = telemetryRoot(home());
  const linkFile = `projects/${manifest.projectId}.json`;
  const deferredFile = `deferred/${manifest.projectId}.json`;
  expect(
    files(root)
      .map((file) => relative(root, file))
      .sort(),
  ).toEqual([deferredFile, "notice.json", linkFile]);
  const noticeFile = join(root, "notice.json");
  const notice = json(noticeFile);
  const isoTime = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(notice).toEqual({ noticeShownAt: isoTime, noticeVersion: 2 });
  const link = json(join(root, linkFile));
  assert(link && typeof link === "object" && "telemetryProjectId" in link);
  const steps = ["install", "lint", "typecheck", "test"];
  expect(link).toEqual({
    telemetryProjectId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    scaffoldedAt: manifest.createdAt,
    stack: "go-cli",
    fragments: ["tools"],
    steps,
  });
  const deferred = json(join(root, deferredFile));
  assert(deferred && typeof deferred === "object");
  expect(deferred).toMatchObject({ type: "new", projectId: link.telemetryProjectId });
  expect(server.requests).toEqual([]);

  server.mode("fail");
  const verified = await run(["verify", "--json"], cwd);
  expect(verified.status).toBe(0);
  expect(Schema.decodeUnknownSync(VerifyResult)(JSON.parse(verified.stdout)).outcome).toBe("green");
  const decodeVerifyEvent = Schema.decodeUnknownSync(VerifyEvent);
  const events = ndjson(verified.stderr).map((event) => decodeVerifyEvent(event));
  expect(events.map(({ event, name }) => [event, name])).toEqual(
    steps.flatMap((step) => [
      ["step-started", step],
      ["step-finished", step],
    ]),
  );
  expect(existsSync(join(root, deferredFile))).toBe(false);
  expect(json(noticeFile)).toEqual(notice);
  expect(json(join(root, linkFile))).toEqual({ ...link, firstTestPassAt: isoTime });
  const pending = spooled(home());
  const scaffoldEvent = pending.find((event) => event.type === "new");
  const verifyEvent = pending.find((event) => event.type === "verify");
  expect(scaffoldEvent).toMatchObject(deferred);
  expect(scaffoldEvent?.projectId).not.toBe(manifest.projectId);
  expect(verifyEvent).toMatchObject({
    projectId: scaffoldEvent?.projectId,
    outcome: "green",
    secondsToFirstTestPass: expect.any(Number),
  });
  expect(server.requests).toEqual([
    { method: "POST", path: "/v1/events", events: [scaffoldEvent, verifyEvent] },
  ]);
  expect(spoolFiles(home()).sort()).toEqual(
    [scaffoldEvent, verifyEvent]
      .map((event) => join(root, "spool", `${event?.eventId}.json`))
      .sort(),
  );
});

test("disable removes a deferred notice scaffold", async () => {
  await firstProject();
  ok(await run(["telemetry", "disable", "--json"]));
  expect(existsSync(join(telemetryRoot(home()), "deferred"))).toBe(false);
  ok(await run(["list", "--json"]));
  expect(server.events()).toEqual([]);
});

test("standing opt-out removes a deferred notice scaffold", async () => {
  await firstProject();
  ok(await run(["list", "--json"], home(), { DO_NOT_TRACK: "1" }));
  expect(existsSync(join(telemetryRoot(home()), "deferred"))).toBe(false);
  ok(await run(["list", "--json"]));
  expect(server.events()).toEqual([]);
});

test("reset removes a deferred notice scaffold", async () => {
  await firstProject();
  ok(await run(["telemetry", "reset", "--json"]));
  expect(existsSync(join(telemetryRoot(home()), "deferred"))).toBe(false);
  ok(await run(["list", "--json"]));
  expect(server.events()).toEqual([]);
});

test("debug inspection preserves a deferred scaffold for later delivery", async () => {
  await firstProject();
  expect((await run(["list", "--json"], home(), { STACKS_TELEMETRY_DEBUG: "1" })).status).toBe(0);
  expect(existsSync(join(telemetryRoot(home()), "deferred"))).toBe(true);
  expect(server.events()).toEqual([]);
  ok(await run(["list", "--json"]));
  expect(server.events().map((event) => event.type)).toEqual(["new"]);
});

test("recovered deferred delivery reuses its event identity", async () => {
  await firstProject();
  const deferred = join(telemetryRoot(home()), "deferred");
  const manifest = Schema.decodeUnknownSync(Manifest)(
    json(join(home(), "project/.stacks/manifest.json")),
  );
  const file = join(deferred, `${manifest.projectId}.json`);
  const saved = json(file);
  expect(JSON.stringify(saved)).not.toContain("manifest");
  expect(JSON.stringify(saved)).not.toContain("run");
  ok(await run(["list", "--json"]));
  expect(server.events().map((event) => event.type)).toEqual(["new"]);
  const firstId = server.events()[0]?.eventId;
  writeJson(file, saved);
  ok(await run(["list", "--json"]));
  expect(server.events().map((event) => event.eventId)).toEqual([firstId, firstId]);
});

test("overlapping enabled runs use one deferred event identity", async () => {
  await firstProject();
  const results = await Promise.all(Array.from({ length: 4 }, () => run(["list", "--json"])));
  for (const result of results) expect(result.status, result.stderr).toBe(0);
  const ids = server
    .events()
    .filter((event) => event.type === "new")
    .map((event) => event.eventId);
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(1);
});

test("notice-run add delivers its event and link on the next enabled run", async () => {
  expect((await run(["new", "go-cli", "project", "--json", "--no-telemetry"])).status).toBe(0);
  const root = join(home(), "project");
  const added = await run(["add", "extra", "--json"], root);
  expect(added.status, added.stderr).toBe(0);
  expect(JSON.parse(added.stdout)).toHaveProperty("notice");
  expect(existsSync(join(telemetryRoot(home()), "install.json"))).toBe(false);
  expect(server.events()).toEqual([]);
  expect((await run(["verify", "--json"], root)).status).toBe(0);
  expect(server.events().map((event) => event.type)).toEqual(["add", "verify"]);
  const addedEvent = server.events().find((event) => event.type === "add");
  const verifyEvent = server.events().find((event) => event.type === "verify");
  expect(addedEvent?.projectId).toBe(verifyEvent?.projectId);
});

it.effect("deferred verify timing starts at the notice-run scaffold", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.now());
    const clock = yield* Clock.Clock;
    const first = yield* Effect.promise(() =>
      telemetryCli(["new", "go-cli", "project", "--json"], {
        home: home(),
        env: env(),
        clock,
      }),
    );
    expect(first.status).toBe(0);
    yield* TestClock.adjust("2 hours");
    const verified = yield* Effect.promise(() =>
      telemetryCli(["verify", "--json"], {
        home: home(),
        env: env(),
        clock,
        host: { cwd: join(home(), "project") },
      }),
    );
    expect(verified.status, verified.stderr).toBe(0);
    const event = server.events().find((value) => value.type === "verify");
    expect(event?.secondsSinceScaffold).toBeGreaterThanOrEqual(7200);
  }),
);

test.each(["human", "agent", "json"])(
  "%s notice precedes the first enabled delivery",
  async (audience) => {
    const args = ["new", "go-cli", "project", ...(audience === "json" ? ["--json"] : [])];
    const result = await telemetryCli(args, {
      home: home(),
      env: env(),
      host: { cwd: home(), stdoutIsTTY: audience === "human" },
    });
    expect(result.status, result.stderr).toBe(0);
    const text =
      audience === "json" ? JSON.stringify(JSON.parse(result.stdout).notice) : result.stderr;
    expect(text).toContain("telemetry disable");
    expect(text).toContain(new URL("/telemetry", server.url).href);
    expect(server.events()).toEqual([]);
    expect(existsSync(join(telemetryRoot(home()), "install.json"))).toBe(false);
    const next = await run(["list", "--json"]);
    expect(next.status).toBe(0);
    expect(server.events().map((event) => event.type)).toEqual(["new"]);
  },
);

test("verify reports nonempty Asked items and omits the field without NOTES", async () => {
  const root = await firstProject();
  writeFileSync(join(root, ".stacks/NOTES.md"), "# Notes\n\n## Asked\n- first\n- \n* second\n");
  expect((await run(["verify", "--json"], root)).status).toBe(0);
  const first = server.events().find((event) => event.type === "verify");
  expect(first).toMatchObject({ schemaVersion: 3, asked: 2 });
  rmSync(join(root, ".stacks/NOTES.md"));
  expect((await run(["verify", "--json"], root)).status).toBe(0);
  const second = server
    .events()
    .filter((event) => event.type === "verify")
    .at(-1);
  expect(second).not.toHaveProperty("asked");
});

test("an old v2 spool event is delivered unchanged beside v3", async () => {
  const root = await firstProject();
  ok(await run(["show", "go-cli", "--json"]));
  const old = Schema.decodeUnknownSync(TelemetryEventV2)({
    ...server.events().find((event) => event.type === "show"),
    schemaVersion: 2,
  });
  // A v2 fixture is kept on disk exactly as earlier versions wrote it.
  writeJson(join(telemetryRoot(home()), "spool", `${old.eventId}.json`), old);
  expect((await run(["verify", "--json"], root)).status).toBe(0);
  expect(server.events()).toContainEqual(old);
  expect(server.events().some((event) => event.schemaVersion === 3)).toBe(true);
});

test("list flushes a failed verify after its own JSON output", async () => {
  const root = await firstProject();
  server.mode("fail");
  expect((await run(["verify", "--json"], root)).status).toBe(0);
  expect(spooled(home()).some((event) => event.type === "verify")).toBe(true);
  server.mode("accept");
  writeJson(join(telemetryRoot(home()), "flush.json"), { until: 0 });
  const baseline = await run(["list", "--json", "--no-telemetry"]);
  const actual = await run(["list", "--json"]);
  expect(actual.status).toBe(baseline.status);
  expect(actual.stdout).toBe(baseline.stdout);
  expect(actual.stderr).toBe(baseline.stderr);
  expect(server.events().filter((event) => event.type === "verify")).toHaveLength(2);
  expect(spooled(home())).toEqual([]);
});

test("list starts delivery only after its JSON output is written", async () => {
  const root = await firstProject();
  server.mode("fail");
  expect((await run(["verify", "--json"], root)).status).toBe(0);
  writeJson(join(telemetryRoot(home()), "flush.json"), { until: 0 });
  server.mode("accept");
  const before = server.requests.length;
  let writing = false;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = telemetryCli(["list", "--json"], {
    home: home(),
    env: env(),
    stdout: async () => {
      writing = true;
      await held;
    },
  });
  try {
    await vi.waitFor(() => expect(writing).toBe(true));
    expect(server.requests).toHaveLength(before);
  } finally {
    release();
  }
  expect((await pending).status).toBe(0);
  expect(server.requests.length).toBeGreaterThan(before);
});
