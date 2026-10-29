import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import {
  RunRecord,
  TelemetryAddEvent,
  TelemetryErrorEvent,
  TelemetryNewEvent,
  TelemetryShowEvent,
  TelemetryVerifyEvent,
  TelemetryVerifyEventV2,
  telemetryEventJsonSchema,
} from "@steamfield/stacks-format";
import { Clock, Effect, Schema } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";
import { AddResult } from "../src/schemas/add";
import { NewResult } from "../src/schemas/new";
import { ShowReport } from "../src/schemas/show";
import { VerifyResult } from "../src/schemas/verify";
import { VERSION } from "../src/version";
import { ndjson } from "./helpers/cli";
import { minimal, writeEntry } from "./helpers/registry";
import {
  decodeEvent,
  files,
  notified,
  ok,
  queue,
  spooled,
  type TelemetryServer,
  telemetryCli,
  telemetryLayer,
  telemetryModule,
  telemetryRoot,
  telemetryServer,
  workspace,
} from "./helpers/telemetry";
import { readManifestAt } from "./helpers/verify";

const NewV2 = Schema.Struct({ ...TelemetryNewEvent.fields, schemaVersion: Schema.Literal(2) });
const AddV2 = Schema.Struct({ ...TelemetryAddEvent.fields, schemaVersion: Schema.Literal(2) });
const ShowV2 = Schema.Struct({ ...TelemetryShowEvent.fields, schemaVersion: Schema.Literal(2) });
const ErrorV2 = Schema.Struct({ ...TelemetryErrorEvent.fields, schemaVersion: Schema.Literal(2) });

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
const env = () => ({ STACKS_TELEMETRY_URL: server.url });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const officialPassedSteps = [
  { name: "install", phase: "setup", layer: "install", status: "passed", duration: "5s" },
  { name: "lint", phase: "check", layer: "lint", status: "passed", duration: "5s" },
  { name: "typecheck", phase: "check", layer: "typecheck", status: "passed", duration: "5s" },
  { name: "test", phase: "check", layer: "test", status: "passed", duration: "5s" },
] satisfies typeof TelemetryVerifyEvent.Type.steps;
async function scaffold(name = "project", flags: string[] = []) {
  const result = await telemetryCli(["new", "go-cli", name, "--json", ...flags], {
    home,
    env: env(),
  });
  ok(result);
  Schema.decodeUnknownSync(NewResult)(JSON.parse(result.stdout));
  return { result, root: join(home, name) };
}
async function flush() {
  ok(await telemetryCli(["telemetry", "flush", "--json"], { home, env: env() }));
}

test("a hanging sink preserves new's exact output with a bounded delay [4.1a#6]", async () => {
  await notified(home, server.url);
  const start = performance.now();
  const baseline = await scaffold("project", ["--no-telemetry"]);
  const disabledMs = performance.now() - start;
  rmSync(baseline.root, { recursive: true });
  server.mode("hold");
  const enabledStart = performance.now();
  const enabled = await scaffold();
  const enabledMs = performance.now() - enabledStart;
  expect(hash(enabled.result.stdout)).toBe(hash(baseline.result.stdout));
  expect(enabled.result.status).toBe(baseline.result.status);
  expect(enabled.result.stderr).toBe(baseline.result.stderr);
  // The 800ms client deadline has 200ms scheduling margin, relative to this test's disabled run.
  expect(enabledMs - disabledMs).toBeLessThanOrEqual(1000);
  expect(server.requests).toHaveLength(1);
  expect(spooled(home)).toHaveLength(1);
}, 10_000); // Two scaffolds and the real 800ms deadline on a busy test host.

it.effect.each(["new", "add", "show", "verify"])(
  "a failed spool write cannot change %s output or exit [4.1a#7]",
  (command) =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock;
      yield* Effect.promise(async () => {
        await notified(home, server.url);
        const project = join(home, "project");
        if (command === "add" || command === "verify") {
          await scaffold();
          // The setup scaffold's own delivery isn't the run under test.
          server.requests.length = 0;
        }
        const commands = new Map([
          ["new", ["new", "go-cli", "project", "--json"]],
          ["add", ["add", "extra", "--json"]],
          ["show", ["show", "go-cli", "--json"]],
          ["verify", ["verify", "--json"]],
        ]);
        const args = commands.get(command);
        if (!args) throw new Error("Missing command case");
        const options = {
          home,
          clock,
          env: env(),
          host: { cwd: command === "add" || command === "verify" ? project : home },
        };
        const snapshot = workspace();
        try {
          cpSync(home, join(snapshot.home, "before"), { recursive: true });
          const baseline = await telemetryCli([...args, "--no-telemetry"], options);
          expect(baseline.status, baseline.stderr).toBe(0);
          Schema.decodeUnknownSync(Schema.Union([NewResult, AddResult, ShowReport, VerifyResult]))(
            JSON.parse(baseline.stdout),
          );
          rmSync(home, { recursive: true });
          cpSync(join(snapshot.home, "before"), home, { recursive: true });
          const spool = join(telemetryRoot(home), "spool");
          rmSync(spool, { recursive: true, force: true });
          writeFileSync(spool, "blocked spool\n", { mode: 0o600 });
          expect(statSync(spool).isFile()).toBe(true);
          const actual = await telemetryCli(args, options);
          expect(actual.status).toBe(baseline.status);
          expect(hash(actual.stdout)).toBe(hash(baseline.stdout));
          expect(actual.stderr).toBe(baseline.stderr);
          expect(statSync(spool).isFile()).toBe(true);
          expect(readFileSync(spool, "utf8")).toBe("blocked spool\n");
        } finally {
          snapshot.cleanup();
        }
        expect(server.requests).toEqual([]);
      });
    }),
);

it.effect.prop(
  "serialized events never disclose random project names, manifest ids or private entry ids [4.1a#8]",
  [Schema.String.check(Schema.isPattern(/^[a-z]{8,16}$/))],
  ([suffix]) =>
    Effect.promise(async () => {
      const isolated = workspace();
      try {
        await notified(isolated.home, server.url);
        const secret = `private-${suffix}`;
        const excluded = `private-fragment-${suffix}`;
        const projectName = `secret-project-${suffix}`;
        const entry = writeEntry({
          root: join(isolated.home, "config/stacks"),
          kind: "stack",
          dir: secret,
          frontmatter: minimal("stack", secret, `fragments:\n  default: [${excluded}]`),
        });
        writeEntry({
          root: join(isolated.home, "config/stacks"),
          kind: "fragment",
          dir: excluded,
          frontmatter: minimal("fragment", excluded),
        });
        expect(existsSync(entry)).toBe(true);
        for (const id of [secret, excluded]) {
          ok(await telemetryCli(["show", id, "--json"], { home: isolated.home, env: env() }));
        }
        const result = await telemetryCli(
          ["new", secret, projectName, "--json", "--source", "cli", "--without", excluded],
          {
            home: isolated.home,
            env: env(),
          },
        );
        ok(result);
        const manifest = readManifestAt(join(isolated.home, projectName));
        const events = server.events().filter((e) => e.installId === spooledInstall(isolated.home));
        expect(events).toHaveLength(3);
        const serialized = JSON.stringify(events.map((event) => decodeEvent(event)));
        for (const forbidden of [projectName, manifest.projectId, secret, excluded, isolated.home])
          expect(serialized).not.toContain(forbidden);
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "new",
              stack: "custom",
              without: ["custom"],
              nonOfficial: { user: 1, project: 0, source: 0 },
            }),
          ]),
        );
        expect(events.filter((e) => e.type === "show").map((e) => e.id)).toEqual([
          "custom",
          "custom",
        ]);
      } finally {
        isolated.cleanup();
      }
    }),
  { timeout: 30_000, arbitrary: { runs: 10 } }, // Ten real scaffolds with isolated homes.
);

function spooledInstall(at: string) {
  const install = Schema.decodeUnknownSync(Schema.Struct({ installId: Schema.String }))(
    JSON.parse(readFileSync(join(telemetryRoot(at), "install.json"), "utf8")),
  );
  return install.installId;
}

test("hand-added verify steps are custom, with no command text [4.1a#9]", async () => {
  await notified(home, server.url);
  const { root } = await scaffold();
  const manifest = readManifestAt(root);
  writeFileSync(
    join(root, ".stacks/manifest.json"),
    JSON.stringify({
      ...manifest,
      verify: [
        ...manifest.verify,
        {
          name: "private-step",
          phase: "check",
          layer: "test",
          run: "true",
          skipByDefault: false,
          owner: "go-cli",
        },
      ],
    }),
  );
  const result = await telemetryCli(["verify", "--accept-changes", "--json"], {
    home,
    env: env(),
    host: { cwd: root, stdinIsTTY: true },
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ outcome: "green" });
  expect(ndjson(result.stderr).length).toBeGreaterThan(0);
  const event = server.events().find((e) => e.type === "verify");
  expect(event).toBeDefined();
  const decoded = Schema.decodeUnknownSync(TelemetryVerifyEventV2, { onExcessProperty: "error" })(
    event,
  );
  expect(decoded.stepsChanged).toBe(1);
  expect(JSON.stringify(decoded)).not.toContain("private-step");
  expect(decoded.steps.map((s) => s.name)).toEqual([
    "install",
    "lint",
    "typecheck",
    "test",
    "custom",
  ]);
});

test("show queues exactly one project-free event and TargetNotEmpty queues a closed error [4.1a#10]", async () => {
  await notified(home, server.url);
  await queue(home, server.url);
  expect(Schema.decodeUnknownSync(ShowV2)(spooled(home)[0])).toMatchObject({
    type: "show",
    kind: "stack",
    id: "go-cli",
  });
  expect(spooled(home)[0]).not.toHaveProperty("projectId");
  mkdirSync(join(home, "occupied"));
  writeFileSync(join(home, "occupied", "secret.txt"), "private content");
  const result = await telemetryCli(["new", "go-cli", "occupied", "--json"], { home, env: env() });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(ndjson(result.stderr)).toEqual([
    expect.objectContaining({ error: expect.objectContaining({ tag: "TargetNotEmpty" }) }),
  ]);
  await flush();
  const errors = server.events().filter((e) => e.type === "error");
  expect(errors).toHaveLength(1);
  expect(Schema.decodeUnknownSync(ErrorV2, { onExcessProperty: "error" })(errors[0])).toMatchObject(
    { command: "new", code: "TargetNotEmpty", stack: "go-cli" },
  );
  expect(errors[0]).not.toHaveProperty("message");
  expect(errors[0]).not.toHaveProperty("projectId");
});

test("a known error tag outside telemetry's closed list is other [4.1a#10]", async () => {
  await notified(home, server.url);
  const { root } = await scaffold();
  const manifest = readManifestAt(root);
  writeFileSync(
    join(root, ".stacks/manifest.json"),
    JSON.stringify({
      ...manifest,
      verify: manifest.verify.map((step) => ({ ...step, run: "false" })),
    }),
  );
  const result = await telemetryCli(["add", "extra", "--json"], {
    home,
    env: env(),
    host: { cwd: root },
  });
  expect(result.status).toBe(5);
  expect(result.stdout).toBe("");
  expect(ndjson(result.stderr)).toEqual([
    expect.objectContaining({ error: expect.objectContaining({ tag: "VerifyChanged" }) }),
  ]);
  await flush();
  const errors = server.events().filter((e) => e.type === "error");
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatchObject({ type: "error", command: "add", code: "other" });
});

test("one user fragment is counted and redacted beside an official fragment [4.1a#11]", async () => {
  await notified(home, server.url);
  writeEntry({
    root: join(home, "config/stacks"),
    kind: "fragment",
    dir: "private-tools",
    frontmatter: minimal("fragment", "private-tools"),
  });
  await scaffold("project", ["--with", "private-tools"]);
  const event = Schema.decodeUnknownSync(NewV2)(server.events()[0]);
  expect(event).toMatchObject({
    stack: "go-cli",
    fragments: ["tools", "custom"],
    origin: "bundled",
    nonOfficial: { user: 1, project: 0, source: 0 },
  });
  expect(event).not.toHaveProperty("fingerprint");
  expect(JSON.stringify(event)).not.toContain("private-tools");
});

test.each([undefined, "skill"])("new source is opt-in metadata (%s) [4.1a#12]", async (source) => {
  await notified(home, server.url);
  await scaffold("project", source ? ["--source", source] : []);
  const event = Schema.decodeUnknownSync(NewV2)(server.events()[0]);
  if (source) expect(event.source).toBe(source);
  else expect(event).not.toHaveProperty("source");
});

test("an unsupported source is BadInput with no custom value in telemetry [4.1a#12]", async () => {
  await notified(home, server.url);
  const result = await telemetryCli(
    ["new", "go-cli", "project", "--source", "other-thing", "--json"],
    { home, env: env() },
  );
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(ndjson(result.stderr)).toEqual([
    expect.objectContaining({ error: expect.objectContaining({ tag: "BadInput" }) }),
  ]);
  expect(JSON.stringify(server.events())).not.toContain("other-thing");
});

test.each([undefined, "web", "docs", "skill", "cli", "other"])(
  "add records its supported source (%s) and exactly one add event [4.1a#12]",
  async (source) => {
    await notified(home, server.url);
    const { root } = await scaffold();
    const result = await telemetryCli(
      ["add", "extra", "--json", ...(source ? ["--source", source] : [])],
      {
        home,
        env: env(),
        host: { cwd: root },
      },
    );
    ok(result);
    const events = server.events().filter((event) => event.type === "add");
    expect(events).toHaveLength(1);
    const event = Schema.decodeUnknownSync(AddV2, { onExcessProperty: "error" })(events[0]);
    expect(event).toMatchObject({
      stack: "go-cli",
      fragments: ["tools", "extra"],
      origin: "bundled",
      nonOfficial: { user: 0, project: 0, source: 0 },
    });
    expect(event.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    if (source) expect(event.source).toBe(source);
    else expect(event).not.toHaveProperty("source");
  },
);

test("add rejects an unsupported source before writing [4.1a#12]", async () => {
  await notified(home, server.url);
  const { root } = await scaffold();
  const before = readFileSync(join(root, ".stacks/manifest.json"), "utf8");
  const result = await telemetryCli(["add", "extra", "--source", "private-value", "--json"], {
    home,
    env: env(),
    host: { cwd: root },
  });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(ndjson(result.stderr)).toEqual([
    expect.objectContaining({ error: expect.objectContaining({ tag: "BadInput" }) }),
  ]);
  expect(readFileSync(join(root, ".stacks/manifest.json"), "utf8")).toBe(before);
  expect(JSON.stringify(server.events())).not.toContain("private-value");
});

test("every schema field has a documented consumer and legacy flags never serialize [4.1a#13]", async () => {
  const path = join(import.meta.dirname, "../src/telemetry/events.ts");
  const module = await import(path);
  const consumers = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.String))(
    module.TELEMETRY_FIELD_CONSUMERS,
  );
  const schemas = [
    TelemetryNewEvent,
    TelemetryAddEvent,
    TelemetryShowEvent,
    TelemetryErrorEvent,
    TelemetryVerifyEvent,
  ];
  const fields = new Set(schemas.flatMap((schema) => Object.keys(schema.fields)));
  fields.add("deps");
  expect(Object.keys(consumers).sort()).toEqual([...fields].sort());
  for (const reader of Object.values(consumers)) expect(reader.trim().length).toBeGreaterThan(0);
  const docs = readFileSync(join(import.meta.dirname, "../docs/reference/telemetry.md"), "utf8");
  const rows = docs.split("\n").filter((line) => line.startsWith("|"));
  for (const [field, reader] of Object.entries(consumers)) {
    expect(
      rows.some((line) => line.includes(`\`${field}\``) && line.includes(reader)),
      field,
    ).toBe(true);
  }
  await notified(home, server.url);
  await scaffold("project", ["--yes"]);
  for (const event of server.events()) {
    decodeEvent(event);
    expect(event).not.toHaveProperty("yes");
    expect(event).not.toHaveProperty("existingRepo");
  }
});

test("v1 matches its format snapshot and a fixture field addition breaks equality [4.1a#16]", () => {
  const committed = readFileSync(
    join(import.meta.dirname, "../../format/schemas/telemetry-event.v1.json"),
    "utf8",
  );
  const current = `${JSON.stringify(telemetryEventJsonSchema(), null, 2)}\n`;
  expect(hash(current)).toBe(hash(committed));
  const fixture = (show: Schema.Top) =>
    Schema.Union([
      TelemetryNewEvent,
      TelemetryAddEvent,
      TelemetryVerifyEvent,
      show,
      TelemetryErrorEvent,
    ]);
  const unchanged = schemaSnapshot(fixture(Schema.Struct({ ...TelemetryShowEvent.fields })));
  const changed = schemaSnapshot(
    fixture(Schema.Struct({ ...TelemetryShowEvent.fields, privateField: Schema.String })),
  );
  expect(hash(unchanged)).toBe(hash(committed));
  expect(changed).toContain("privateField");
  expect(hash(changed)).not.toBe(hash(committed));
});

function schemaSnapshot(schema: Schema.Top) {
  const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" });
  const definitions = document.definitions ?? {};
  return `${JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      ...document.schema,
      ...(Object.keys(definitions).length ? { $defs: definitions } : {}),
    },
    null,
    2,
  )}\n`;
}

test.each(["human", "json"])(
  "the %s notice names collection, privacy URL and off switch [4.1a#17]",
  async (mode) => {
    const args = ["show", "go-cli", ...(mode === "json" ? ["--json"] : [])];
    const result = await telemetryCli(args, {
      home,
      env: env(),
      host: { stdoutIsTTY: mode === "human" },
    });
    expect(result.status).toBe(0);
    const notice =
      mode === "json"
        ? JSON.stringify(
            Schema.decodeUnknownSync(Schema.Struct({ notice: Schema.Unknown }))(
              JSON.parse(result.stdout),
            ).notice,
          )
        : result.stderr;
    // The privacy page is `/telemetry` on the endpoint's host, here the local recording server.
    expect(notice).toContain(`${new URL("/telemetry", server.url).href}`);
    expect(notice).toContain("telemetry disable");
    expect(notice).toMatch(/anonymous|usage/i);
    if (mode === "json") {
      expect(result.stderr).toBe("");
      Schema.decodeUnknownSync(ShowReport)(JSON.parse(result.stdout));
    } else expect(result.stdout.trim()).not.toBe("");
    expect(server.requests).toEqual([]);
    expect(files(telemetryRoot(home)).map((f) => f.split("/").at(-1))).toEqual(["notice.json"]);
  },
);

test("a symlinked state root and a Unicode project path keep ids outside the repo [4.1a#27]", async () => {
  const actual = join(home, "real state");
  mkdirSync(actual);
  symlinkSync(actual, join(home, "state"));
  await notified(home, server.url);
  const { root } = await scaffold("projet été spaces");
  expect(files(root).some((file) => /telemetry|install\.json|notice\.json/.test(file))).toBe(false);
  expect(existsSync(join(actual, "stacks/telemetry/install.json"))).toBe(true);
  expect(JSON.stringify(server.events())).not.toContain(root);
  const brief = readFileSync(join(root, ".stacks/BRIEF.md"), "utf8");
  expect(brief).toContain(
    "If stacks printed a telemetry notice, tell the user once, in one sentence, including how to turn it off.",
  );
});

test("debug emits schema-valid events on stderr without spooling or HTTP [4.1a#29]", async () => {
  await notified(home, server.url);
  const result = await telemetryCli(["show", "go-cli", "--json"], {
    home,
    env: { ...env(), STACKS_TELEMETRY_DEBUG: "1" },
  });
  expect(result.status).toBe(0);
  Schema.decodeUnknownSync(ShowReport)(JSON.parse(result.stdout));
  const events = ndjson(result.stderr).map((event) => decodeEvent(event));
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: "show", id: "go-cli" });
  expect(spooled(home)).toEqual([]);
  expect(server.requests).toEqual([]);
  const disabled = await telemetryCli(["show", "go-cli", "--json"], {
    home,
    env: { ...env(), STACKS_TELEMETRY_DEBUG: "1", DO_NOT_TRACK: "1" },
  });
  ok(disabled);
  expect(hash(disabled.stdout)).toBe(hash(result.stdout));
});

test("cloned verifies have no link; known projects use a separate id and bucketed steps [4.1a#30]", async () => {
  await notified(home, server.url);
  const { root } = await scaffold();
  const manifest = readManifestAt(root);
  const created = Schema.decodeUnknownSync(NewV2)(server.events()[0]);
  expect(created.projectId).toBeDefined();
  expect(created.projectId).not.toBe(manifest.projectId);
  const known = await telemetryCli(["verify", "--json"], {
    home,
    env: { ...env(), PATH: process.env.PATH },
    host: { cwd: root },
  });
  expect(known.status).toBe(0);
  expect(JSON.parse(known.stdout)).toMatchObject({ outcome: "green" });
  expect(ndjson(known.stderr).length).toBeGreaterThan(0);
  const event = Schema.decodeUnknownSync(TelemetryVerifyEventV2)(
    server.events().find((e) => e.type === "verify"),
  );
  expect(event).toMatchObject({
    projectId: created.projectId,
    scope: "full",
    outcome: "green",
    steps: officialPassedSteps,
    stepsChanged: 0,
  });
  expect(event.secondsSinceScaffold).toBeGreaterThanOrEqual(0);
  expect(event.installId).toBe(created.installId);
  expect(event.secondsToFirstTestPass).toBeGreaterThanOrEqual(0);
  const clone = workspace();
  try {
    const target = join(clone.home, "clone");
    cpSync(root, target, { recursive: true });
    await notified(clone.home, server.url);
    const result = await telemetryCli(["verify", "--json"], {
      home: clone.home,
      env: { ...env(), PATH: process.env.PATH },
      host: { cwd: target },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ outcome: "green" });
    expect(ndjson(result.stderr).length).toBeGreaterThan(0);
    const cloned = Schema.decodeUnknownSync(TelemetryVerifyEventV2)(
      server
        .events()
        .filter((e) => e.type === "verify")
        .at(-1),
    );
    expect(cloned).not.toHaveProperty("projectId");
    expect(cloned).not.toHaveProperty("secondsToFirstTestPass");
    expect(cloned.installId).not.toBe(created.installId);
  } finally {
    clone.cleanup();
  }
});

test("green base and failing app send the whole run's failed outcome [4.1a#30]", async () => {
  await notified(home, server.url);
  const { root } = await scaffold();
  const manifest = readManifestAt(root);
  writeFileSync(
    join(root, ".stacks/manifest.json"),
    JSON.stringify({
      ...manifest,
      verify: [
        ...manifest.verify,
        {
          name: "private-app-test",
          phase: "check",
          layer: "test",
          run: "false",
          tags: ["app"],
          skipByDefault: false,
          owner: "go-cli",
        },
      ],
    }),
  );
  const result = await telemetryCli(["verify", "--accept-changes", "--json"], {
    home,
    env: env(),
    host: { cwd: root, stdinIsTTY: true },
  });
  expect(result.status).toBe(5);
  expect(JSON.parse(result.stdout)).toMatchObject({
    outcome: "failed",
    stages: { base: "green", app: "failed" },
  });
  expect(ndjson(result.stderr).at(-1)).toMatchObject({ error: { tag: "VerifyFailed" } });
  const event = Schema.decodeUnknownSync(TelemetryVerifyEventV2, { onExcessProperty: "error" })(
    server.events().find((e) => e.type === "verify"),
  );
  expect(event.outcome).toBe("failed");
  expect(event).not.toHaveProperty("stages");
  expect(event.steps).toEqual([
    ...officialPassedSteps,
    {
      name: "custom",
      phase: "check",
      layer: "test",
      status: "failed",
      failureKind: "step",
      duration: "5s",
    },
  ]);
});

test.each([
  { ms: 0, bucket: "5s" },
  { ms: 4999, bucket: "5s" },
  { ms: 5000, bucket: "5s" },
  { ms: 5001, bucket: "30s" },
  { ms: 29999, bucket: "30s" },
  { ms: 30000, bucket: "30s" },
  { ms: 30001, bucket: "2m" },
  { ms: 119999, bucket: "2m" },
  { ms: 120000, bucket: "2m" },
  { ms: 120001, bucket: "10m" },
  { ms: 599999, bucket: "10m" },
  { ms: 600000, bucket: "10m" },
  { ms: 600001, bucket: "longer" },
])("verify duration $ms ms is delivered as $bucket [4.1a#30]", async ({ ms, bucket }) => {
  await notified(home, server.url);
  const { root } = await scaffold();
  const record = Schema.decodeUnknownSync(RunRecord)({
    schemaVersion: 1,
    at: new Date().toISOString(),
    cli: VERSION,
    agent: "none",
    outcome: "green",
    scope: "full",
    tamperCheck: "full",
    acceptedChanges: false,
    durationMs: ms,
    secondsSinceCreated: ms / 1000,
    steps: officialPassedSteps.map(({ name, phase, layer, status }) => ({
      name,
      phase,
      layer,
      status,
      durationMs: name === "test" ? ms : 0,
    })),
  });
  const { Telemetry } = await import(telemetryModule);
  // The real service consumes the public RunRecord; the parser cannot produce 10-minute steps
  // deterministically without waiting. No process or telemetry service is replaced here.
  const program = Effect.gen(function* () {
    const telemetry = yield* Telemetry;
    yield* telemetry.recordVerify(record);
    yield* telemetry.flush;
  }).pipe(Effect.provide(await telemetryLayer({ home, cwd: root, env: env() })));
  await Effect.runPromise(program);
  const events = server.events().filter((event) => event.type === "verify");
  expect(events).toHaveLength(1);
  const event = Schema.decodeUnknownSync(TelemetryVerifyEventV2, { onExcessProperty: "error" })(
    events[0],
  );
  expect(event.steps.find((step) => step.name === "test")?.duration).toBe(bucket);
});

test("informational and telemetry commands never emit usage events [4.1a#2]", async () => {
  await notified(home, server.url);
  for (const args of [
    ["list", "--json"],
    ["doctor", "--json"],
    ["validate", "--json"],
    ["telemetry", "status", "--json"],
    ["telemetry", "flush", "--json"],
  ]) {
    ok(await telemetryCli(args, { home, env: env() }));
    expect(spooled(home)).toEqual([]);
    expect(server.requests).toEqual([]);
  }
});
