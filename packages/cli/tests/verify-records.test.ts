import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MANIFEST_PATH } from "../src/core/project/manifest";
import { ProjectState } from "../src/core/project/state";
import { ndjson, quiet, runCli } from "./helpers/cli";
import { newRegistry } from "./helpers/registry";
import {
  decodeResult,
  readManifestAt,
  readRecord,
  recordPath,
  runRecords,
  type StepInput,
  splitEvents,
  startedSteps,
  stateEnv,
  verify,
  workspace,
  writeProject,
  writeRecordedProject,
} from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

const asRoot = process.getuid?.() === 0;
const runsFile = (root: string) => join(root, ".stacks", "state", "runs.jsonl");

function recorded(steps: StepInput[]) {
  const home = space.dir();
  const root = space.dir();
  const written = writeRecordedProject(root, home, steps);
  return {
    home,
    root,
    manifest: written,
    env: stateEnv(home),
    file: recordPath(home, written.projectId),
  };
}

describe("run records", () => {
  test("a fresh new project verifies with tamperCheck full and appends one RunRecord without commands [1.3b#1]", async () => {
    const home = space.dir();
    const created = await runCli(["new", "fixture-stack", "app", "--json"], {
      home,
      env: { ...quiet, ...stateEnv(home) },
      host: { registry: newRegistry, cwd: home },
    });
    expect(created.status).toBe(0);
    const root = join(home, "app");
    const run = await verify(["--json"], { cwd: root, home, env: stateEnv(home) });
    expect(splitEvents(run.stderr).rest).toBe("");
    expect(startedSteps(run.stderr)).toEqual(["stack-ran", "ran"]);
    expect(run.status).toBe(0);
    const result = decodeResult(run.stdout);
    expect(result).toMatchObject({ outcome: "green", tamperCheck: "full", stateRecord: true });
    const records = runRecords(root);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      schemaVersion: 1,
      agent: "none",
      outcome: "green",
      scope: "full",
      tamperCheck: "full",
      acceptedChanges: false,
    });
    expect(records[0]?.steps.map((step) => step.name)).toEqual(result.steps.map((s) => s.name));
    const raw = readFileSync(runsFile(root), "utf8");
    expect(raw.split("\n")).toHaveLength(2);
    for (const step of readManifestAt(root).verify) expect(raw).not.toContain(step.run);
    expect(raw).not.toContain(root);

    const agent = await verify(["--json"], {
      cwd: root,
      home,
      env: { ...stateEnv(home), AI_AGENT: "foo" },
    });
    expect(agent.status).toBe(0);
    expect(runRecords(root).at(-1)?.agent).toBe("other");
  });

  test("a record's at and durationMs describe the run, and secondsSinceCreated matches the result", async () => {
    const { root, env } = recorded([{ name: "lint", run: "true" }]);
    const before = Date.now();
    const run = await verify(["--json"], { cwd: root, env });
    const result = decodeResult(run.stdout);
    const [record] = runRecords(root);
    expect(Date.parse(record?.at ?? "")).toBeGreaterThanOrEqual(before - 1000);
    expect(record?.durationMs).toBe(result.durationMs);
    expect(record?.secondsSinceCreated).toBe(result.secondsSinceCreated);
    expect(record?.steps).toEqual([
      {
        name: "lint",
        phase: "check",
        status: "passed",
        exitCode: 0,
        durationMs: result.steps[0]?.durationMs,
      },
    ]);
  });

  test("a failing step's record keeps its kind and exit code but not its reason or output", async () => {
    const { root, env } = recorded([
      { name: "unit", run: "echo secret-output; exit 3", layer: "test" },
    ]);
    const run = await verify(["--json"], { cwd: root, env });
    expect(run.status).toBe(5);
    const [record] = runRecords(root);
    expect(record?.outcome).toBe("failed");
    expect(record?.steps[0]).toMatchObject({
      name: "unit",
      layer: "test",
      status: "failed",
      failureKind: "step",
      exitCode: 3,
    });
    expect(readFileSync(runsFile(root), "utf8")).not.toContain("secret-output");
  });

  test("interrupting a run during a sleep step appends a record with outcome interrupted [1.3b#10]", {
    timeout: 30_000,
  }, async () => {
    const { root, env } = recorded([
      { name: "hang", run: "touch started; exec sleep 30" },
      { name: "clean", phase: "teardown", run: "true" },
    ]);
    const controller = new AbortController();
    const aborted = vi
      .waitFor(() => expect(existsSync(join(root, "started"))).toBe(true), { timeout: 10_000 })
      .then(() => controller.abort());
    const run = await verify(["--json"], { cwd: root, env, signal: controller.signal });
    await aborted;
    expect(run.status).toBe(130);
    const records = runRecords(root);
    expect(records).toHaveLength(1);
    expect(records[0]?.outcome).toBe("interrupted");
    expect(records[0]?.steps[0]).toMatchObject({ name: "hang", failureKind: "interrupted" });
  });

  test("an unknown --only name appends nothing", async () => {
    const { root, env } = recorded([{ name: "lint", run: "true" }]);
    const run = await verify(["--only", "nope", "--json"], { cwd: root, env });
    expect(run.status).toBe(2);
    expect(runRecords(root)).toEqual([]);
  });

  test.skipIf(asRoot)(
    "with .stacks/state/ unwritable, the outcome and exit are unchanged and one warning is logged [1.3b#13]",
    async () => {
      const { root, env } = recorded([{ name: "lint", run: "true" }]);
      const state = join(root, ".stacks", "state");
      mkdirSync(state, { recursive: true });
      chmodSync(state, 0o500);
      const log = join(space.dir(), "cli.jsonl");
      try {
        const run = await verify(["--json"], {
          cwd: root,
          env: { ...env, LOG_LEVEL: "warn", STACKS_LOG_FILE: log },
        });
        expect(splitEvents(run.stderr).rest).toBe("");
        expect(startedSteps(run.stderr)).toEqual(["lint"]);
        expect(run.status).toBe(0);
        expect(decodeResult(run.stdout).outcome).toBe("green");
        const warnings = ndjson(readFileSync(log, "utf8")).filter(
          (line) => (line as { level?: string }).level === "warn",
        );
        expect(warnings).toHaveLength(1);
      } finally {
        chmodSync(state, 0o700);
      }
      expect(existsSync(runsFile(root))).toBe(false);
    },
  );

  test("a .stacks/state that is a symlink out of the project is not written through", async () => {
    const { root, env } = recorded([{ name: "lint", run: "true" }]);
    const outside = join(space.dir(), "elsewhere");
    mkdirSync(outside);
    symlinkSync(outside, join(root, ".stacks", "state"));
    const run = await verify(["--json"], { cwd: root, env });
    expect(run.status).toBe(0);
    expect(existsSync(join(outside, "runs.jsonl"))).toBe(false);
  });

  test("a runs.jsonl that is a symlink or hard link to a file out of the project is not written through", async () => {
    const { root, env } = recorded([{ name: "lint", run: "true" }]);
    mkdirSync(join(root, ".stacks", "state"));
    const target = join(space.dir(), "rc");
    writeFileSync(target, "keep\n");
    symlinkSync(target, runsFile(root));
    const run = await verify(["--json"], { cwd: root, env });
    expect(run.status).toBe(0);
    expect(decodeResult(run.stdout).outcome).toBe("green");
    expect(readFileSync(target, "utf8")).toBe("keep\n");

    rmSync(runsFile(root));
    linkSync(target, runsFile(root));
    expect((await verify(["--json"], { cwd: root, env })).status).toBe(0);
    expect(readFileSync(target, "utf8")).toBe("keep\n");
  });

  test("a .stacks that is a symlink out of the project gets no state directory there", async () => {
    const home = space.dir();
    const root = space.dir();
    const outside = join(space.dir(), "elsewhere");
    mkdirSync(outside);
    symlinkSync(outside, join(root, ".stacks"));
    writeRecordedProject(root, home, [{ name: "lint", run: "true" }]);
    const run = await verify(["--json"], { cwd: root, env: stateEnv(home) });
    expect(run.status).toBe(0);
    expect(existsSync(join(outside, "state"))).toBe(false);
  });
});

describe("a state record changed during the run", () => {
  /** A recorded project whose one step copies `replacement` over its state record mid-run. */
  function swapping(change: (state: ProjectState) => ProjectState) {
    const home = space.dir();
    const root = space.dir();
    const file = recordPath(home, "0f8fad5b-d9cb-469f-a165-70867728950e");
    const replacement = join(space.dir(), "replacement.json");
    const steps = [{ name: "unit", run: `cp '${replacement}' '${file}'`, layer: "test" as const }];
    writeRecordedProject(root, home, steps);
    const replaced = change(readRecord(file));
    writeFileSync(replacement, JSON.stringify(Schema.encodeSync(ProjectState)(replaced)));
    return { root, env: stateEnv(home), file, replaced };
  }

  test("a concurrent --accept-changes keeps its digests; this run sets no timing field", async () => {
    const { root, env, file, replaced } = swapping((state) => ({
      ...state,
      verifyDigest: `sha256:${"1".repeat(64)}`,
      stepDigests: { unit: `sha256:${"2".repeat(64)}` },
    }));
    const run = await verify(["--json"], { cwd: root, env });
    expect(run.status).toBe(0);
    expect(decodeResult(run.stdout)).toMatchObject({
      outcome: "green",
      firstGreen: false,
      stateRecord: false,
    });
    expect(readRecord(file)).toEqual(replaced);
  });

  test("a concurrent run's firstGreenAt is kept, and this run's firstTestPassAt still lands", async () => {
    const at = "2026-10-26T09:30:00.000Z";
    const { root, env, file } = swapping((state) => ({ ...state, firstGreenAt: at }));
    const run = await verify(["--json"], { cwd: root, env });
    expect(decodeResult(run.stdout)).toMatchObject({ firstGreen: false, stateRecord: true });
    const record = readRecord(file);
    expect(record.firstGreenAt).toBe(at);
    expect(record.firstTestPassAt).not.toBeNull();
  });
});

describe("timing fields", () => {
  test("the first green writes firstGreenAt and says firstGreen; a later green leaves it [1.3b#11]", async () => {
    const { root, env, file } = recorded([{ name: "lint", run: "true" }]);
    const first = await verify(["--json"], { cwd: root, env });
    expect(decodeResult(first.stdout)).toMatchObject({ firstGreen: true, stateRecord: true });
    const at = readRecord(file).firstGreenAt;
    expect(at).not.toBeNull();
    const second = await verify(["--json"], { cwd: root, env });
    expect(decodeResult(second.stdout)).toMatchObject({ firstGreen: false, stateRecord: true });
    expect(readRecord(file).firstGreenAt).toBe(at);
  });

  test("a partial green never writes firstGreenAt", async () => {
    const { root, env, file } = recorded([
      { name: "lint", run: "true" },
      { name: "unit", run: "true" },
    ]);
    const run = await verify(["--only", "lint", "--json"], { cwd: root, env });
    expect(decodeResult(run.stdout)).toMatchObject({ outcome: "partial", firstGreen: false });
    expect(readRecord(file).firstGreenAt).toBeNull();
  });

  test("a failing full run whose test-layer step passed writes firstTestPassAt only [1.3b#12]", async () => {
    const { root, env, file } = recorded([
      { name: "unit", run: "true", layer: "test" },
      { name: "lint", run: "exit 1", layer: "lint" },
    ]);
    const run = await verify(["--json"], { cwd: root, env });
    expect(run.status).toBe(5);
    const record = readRecord(file);
    expect(record.firstTestPassAt).not.toBeNull();
    expect(record.firstGreenAt).toBeNull();
  });

  test("--only unit passing on a fresh project writes firstTestPassAt [1.3b#12]", async () => {
    const { root, env, file } = recorded([
      { name: "unit", run: "true", layer: "test" },
      { name: "lint", run: "true", layer: "lint" },
    ]);
    const run = await verify(["--only", "unit", "--json"], { cwd: root, env });
    expect(run.status).toBe(0);
    expect(readRecord(file).firstTestPassAt).not.toBeNull();
    expect(readRecord(file).firstGreenAt).toBeNull();
  });

  test("a changed run never writes firstTestPassAt [1.3b#12]", async () => {
    const { root, env, file } = recorded([{ name: "unit", run: "true", layer: "test" }]);
    writeProject(root, [{ name: "unit", run: "true; true", layer: "test" }]);
    const run = await verify(["--json"], { cwd: root, env });
    expect(run.status).toBe(5);
    expect(readRecord(file).firstTestPassAt).toBeNull();
  });

  test.skipIf(asRoot)(
    "an unwritable state record leaves the outcome alone and reports stateRecord false",
    async () => {
      const { root, env, home } = recorded([{ name: "lint", run: "true" }]);
      const projects = join(home, "state", "stacks", "projects");
      chmodSync(projects, 0o500);
      try {
        const run = await verify(["--json"], { cwd: root, env });
        expect(run.status).toBe(0);
        expect(decodeResult(run.stdout)).toMatchObject({
          outcome: "green",
          tamperCheck: "full",
          firstGreen: false,
          stateRecord: false,
        });
      } finally {
        chmodSync(projects, 0o700);
      }
    },
  );

  test("secondsSinceCreated counts from the state record's createdAt, not the editable manifest's", async () => {
    const home = space.dir();
    const root = space.dir();
    const steps = [{ name: "lint", run: "true" }];
    writeRecordedProject(root, home, steps, { createdAt: "2020-01-01T00:00:00.000Z" });
    const future = new Date(Date.now() + 86_400_000).toISOString();
    writeProject(root, steps, { createdAt: future });
    const env = stateEnv(home);
    const sinceRecord = (Date.now() - Date.parse("2020-01-01T00:00:00.000Z")) / 1000;

    const run = decodeResult((await verify(["--json"], { cwd: root, env })).stdout);
    expect(run.outcome).toBe("green");
    expect(run.secondsSinceCreated).toBeGreaterThanOrEqual(sinceRecord - 60);
    expect(runRecords(root).at(-1)?.secondsSinceCreated).toBe(run.secondsSinceCreated);

    writeProject(root, [{ name: "lint", run: "true; true" }], { createdAt: future });
    const changed = await verify(["--json"], { cwd: root, env });
    expect(changed.status).toBe(5);
    const result = decodeResult(changed.stdout);
    expect(result.outcome).toBe("changed");
    expect(result.secondsSinceCreated).toBeGreaterThanOrEqual(sinceRecord - 60);
  });

  test("the manifest is never rewritten by a plain run", async () => {
    const { root, env } = recorded([{ name: "lint", run: "true" }]);
    const before = readFileSync(join(root, MANIFEST_PATH), "utf8");
    await verify(["--json"], { cwd: root, env });
    expect(readFileSync(join(root, MANIFEST_PATH), "utf8")).toBe(before);
  });
});
