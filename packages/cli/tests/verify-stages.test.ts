import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, describe, expect, test, vi } from "vitest";
import { digestSteps, encodeManifest, MANIFEST_PATH } from "../src/core/manifest";
import { NewResult } from "../src/schemas/new";
import type { VerifyResult } from "../src/schemas/verify";
import { alive, quiet, runCli, terminal } from "./helpers/cli";
import {
  answers,
  decodeResult,
  freePort,
  lastLine,
  readManifestAt,
  readPid,
  readRecord,
  recordPath,
  runRecords,
  type StepInput,
  splitEvents,
  startedSteps,
  stateEnv,
  stepNamed,
  verify,
  workspace,
  writeRecordedProject,
} from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());
const registry = join(import.meta.dirname, "fixtures", "registry-stages");
type CliRun = Awaited<ReturnType<typeof runCli>>;

function recorded(steps: StepInput[]) {
  const home = space.dir();
  const root = space.dir();
  const written = writeRecordedProject(root, home, steps);
  return { home, root, env: stateEnv(home), file: recordPath(home, written.projectId) };
}

/** Compose through `new`, including its real git init and out-of-project state record. */
async function composed() {
  const home = space.dir();
  const created = await runCli(["new", "stage-stack", "project", "--with", "stage-app", "--json"], {
    home,
    env: { PATH: process.env.PATH, ...quiet, ...stateEnv(home) },
    host: { cwd: home, registry },
  });
  expect(created.status).toBe(0);
  expect(created.stderr).toBe("");
  const result = Schema.decodeUnknownSync(NewResult)(JSON.parse(created.stdout), {
    onExcessProperty: "error",
  });
  expect(result).toMatchObject({ fragments: ["stage-app"], git: "fresh", stateRecord: true });
  const root = join(home, "project");
  expect(existsSync(join(root, ".git", "HEAD"))).toBe(true);
  const written = readManifestAt(root);
  expect(written.schemaVersion).toBe(1);
  expect(
    written.verify.filter((step) => step.tags?.includes("app")).map((step) => step.name),
  ).toEqual(["app-setup", "app-test", "app-lint", "app-clean"]);
  expect(existsSync(join(root, "order.log"))).toBe(false);
  return { home, root, env: stateEnv(home), file: recordPath(home, written.projectId) };
}

const FIX =
  "fix the code or config these steps exercise, not the steps, then run stacks verify again.";
const APP_FIX =
  'follow the application section ("Then: the application") of .stacks/BRIEF.md, fix the code or config these steps exercise, then run stacks verify again.';

/** The steps that ran, in run order: each one, and only those, has a `step-started` event. */
const ran = (result: VerifyResult) =>
  result.steps.filter((step) => step.status !== "skipped").map((step) => step.name);

function passed(run: CliRun) {
  expect(run.status).toBe(0);
  expect(splitEvents(run.stderr).rest).toBe("");
  const result = decodeResult(run.stdout);
  expect(startedSteps(run.stderr)).toEqual(ran(result));
  return result;
}

function failed(run: CliRun, names: string[], next: string) {
  expect(run.status).toBe(5);
  const result = decodeResult(run.stdout);
  expect(result.outcome).toBe("failed");
  const failures = result.steps.filter((step) => step.status === "failed");
  expect(failures.map((step) => step.name).sort()).toEqual([...names].sort());
  expect(startedSteps(run.stderr)).toEqual(ran(result));
  // Parse every non-event line: ancillary output or a second envelope must fail too.
  expect(JSON.parse(splitEvents(run.stderr).rest)).toEqual({
    error: {
      tag: "VerifyFailed",
      message: "Verify failed.",
      retryable: false,
      next,
      details: {
        failed: failures.map((step) => ({
          name: step.name,
          failureKind: step.failureKind,
          exitCode: step.exitCode,
        })),
        stages: result.stages,
      },
    },
  });
  return result;
}

const order = (root: string) => readFileSync(join(root, "order.log"), "utf8").trim().split("\n");

describe("verify with an app", () => {
  test("a failing composed base skips every app phase with base-failed [3.5b#1]", async () => {
    const project = await composed();
    writeFileSync(join(project.root, "app-ready"), "");
    const result = failed(
      await verify(["--json"], { ...project, cwd: project.root }),
      ["base-test"],
      FIX,
    );
    expect(
      result.steps
        .filter((step) => step.name.startsWith("app-"))
        .map((step) => ({
          name: step.name,
          status: step.status,
          reason: step.reason,
          durationMs: step.durationMs,
        })),
    ).toEqual([
      { name: "app-setup", status: "skipped", reason: "base-failed", durationMs: 0 },
      { name: "app-test", status: "skipped", reason: "base-failed", durationMs: 0 },
      { name: "app-lint", status: "skipped", reason: "base-failed", durationMs: 0 },
      { name: "app-clean", status: "skipped", reason: "base-failed", durationMs: 0 },
    ]);
    expect(result).toMatchObject({
      stages: { base: "failed", app: null },
      totals: { passed: 3, failed: 1, skipped: 4 },
      firstGreen: false,
    });
    expect(order(project.root)).toEqual(["base-setup", "base-lint", "base-clean"]);
    expect(runRecords(project.root)).toMatchObject([
      { outcome: "failed", stages: { base: "failed", app: null } },
    ]);
    expect(readRecord(project.file).firstGreenAt).toBeNull();
  });

  test("an app failure keeps the base green in the result and record [3.5b#2]", async () => {
    const project = await composed();
    writeFileSync(join(project.root, "base-ready"), "");
    const result = failed(
      await verify(["--json"], { ...project, cwd: project.root }),
      ["app-test"],
      APP_FIX,
    );
    expect(order(project.root)).toEqual([
      "base-setup",
      "base-lint",
      "base-clean",
      "app-setup",
      "app-lint",
      "app-clean",
    ]);
    const statuses = [
      ["base-setup", "passed"],
      ["base-test", "passed"],
      ["base-lint", "passed"],
      ["base-clean", "passed"],
      ["app-setup", "passed"],
      ["app-test", "failed"],
      ["app-lint", "passed"],
      ["app-clean", "passed"],
    ];
    expect(result.steps.map((step) => [step.name, step.status])).toEqual(statuses);
    expect(result).toMatchObject({ stages: { base: "green", app: "failed" }, firstGreen: false });
    const records = runRecords(project.root);
    expect(records).toMatchObject([
      { outcome: "failed", stages: { base: "green", app: "failed" } },
    ]);
    expect(records[0]?.steps.map((step) => [step.name, step.status])).toEqual(statuses);
    expect(readRecord(project.file).firstGreenAt).toBeNull();
  });

  test.each([
    { audience: "human", host: terminal },
    { audience: "agent", host: { stdoutIsTTY: false } },
  ])(
    "$audience Next points at the application section after an app failure [3.5b#2]",
    async ({ audience, host }) => {
      const project = await composed();
      writeFileSync(join(project.root, "base-ready"), "");
      const run = await verify([], { ...project, cwd: project.root, host });
      expect(run.status).toBe(5);
      const started = [
        "base-setup",
        "base-test",
        "base-lint",
        "base-clean",
        "app-setup",
        "app-test",
        "app-lint",
        "app-clean",
      ].map((name) => `> ${name}\n`);
      if (audience === "human") expect(run.stderr.endsWith("Verify failed.\n")).toBe(true);
      else expect(run.stderr).toBe(`${started.join("")}Verify failed.\n`);
      expect(run.stdout).toContain("verify: failed");
      const next = lastLine(run.stdout);
      expect(next).toMatch(/^Next: .*application/i);
      expect(next).toContain(".stacks/BRIEF.md");
      if (audience === "human") {
        const lines = run.stdout.split("\n");
        const summary = lines.findIndex((line) => line.startsWith("verify:"));
        expect(summary).toBeGreaterThanOrEqual(0);
        const stages = lines.slice(0, summary);
        expect(stages.filter((line) => /\bbase\b.*\bgreen\b/i.test(line))).toHaveLength(1);
        expect(
          stages.filter((line) => /\bapp(?:lication)?\b.*\bfailed\b/i.test(line)),
        ).toHaveLength(1);
      }
    },
  );

  test("both stages green set firstGreenAt and persist stages at schema version 1 [3.5b#3]", async () => {
    const project = await composed();
    writeFileSync(join(project.root, "base-ready"), "");
    writeFileSync(join(project.root, "app-ready"), "");
    const result = passed(await verify(["--json"], { ...project, cwd: project.root }));
    expect(result).toMatchObject({
      outcome: "green",
      scope: "full",
      stages: { base: "green", app: "green" },
      firstGreen: true,
      stateRecord: true,
      tamperCheck: "full",
      totals: { passed: 8, failed: 0, skipped: 0 },
    });
    expect(runRecords(project.root)).toMatchObject([
      { schemaVersion: 1, outcome: "green", stages: { base: "green", app: "green" } },
    ]);
    const at = readRecord(project.file).firstGreenAt;
    expect(at).not.toBeNull();
    expect(Number.isFinite(Date.parse(at ?? ""))).toBe(true);
    expect(readManifestAt(project.root).schemaVersion).toBe(1);
  });

  test("skip-tag app makes the run partial but reports the completed base as green [3.5b#4]", async () => {
    const project = await composed();
    writeFileSync(join(project.root, "base-ready"), "");
    const result = passed(
      await verify(["--skip-tag", "app", "--json"], { ...project, cwd: project.root }),
    );
    expect(result).toMatchObject({
      outcome: "partial",
      scope: "partial",
      stages: { base: "green", app: null },
      firstGreen: false,
      totals: { passed: 4, failed: 0, skipped: 4 },
    });
    expect(
      result.steps.filter((step) => step.name.startsWith("app-")).map((step) => step.status),
    ).toEqual(["skipped", "skipped", "skipped", "skipped"]);
    expect(order(project.root)).toEqual(["base-setup", "base-lint", "base-clean"]);
    expect(runRecords(project.root)).toMatchObject([
      { outcome: "partial", stages: { base: "green", app: null } },
    ]);
    expect(readRecord(project.file).firstGreenAt).toBeNull();
  });

  test("without app-tagged steps neither the result nor the record gains stages [3.5b#5]", async () => {
    const project = recorded([
      { name: "test", run: "true", owner: "an-app-fragment", tags: ["App", "application"] },
    ]);
    const result = passed(await verify(["--json"], { ...project, cwd: project.root }));
    expect(result.outcome).toBe("green");
    expect(result).not.toHaveProperty("stages");
    const records = runRecords(project.root);
    expect(records).toHaveLength(1);
    expect(records[0]).not.toHaveProperty("stages");
  });

  test.each([false, true])(
    "removing app is VerifyChanged even with digest recomputed=%s [3.5b#6]",
    async (recompute) => {
      const project = await composed();
      const before = readManifestAt(project.root);
      const edited = {
        ...before,
        verify: before.verify.map((step) =>
          step.name === "app-test"
            ? { ...step, tags: step.tags?.filter((tag) => tag !== "app") }
            : step,
        ),
      };
      const changed = recompute ? { ...edited, verifyDigest: digestSteps(edited) } : edited;
      writeFileSync(join(project.root, MANIFEST_PATH), encodeManifest(changed));
      const run = await verify(["--json"], { ...project, cwd: project.root });
      expect(run.status).toBe(5);
      const result = decodeResult(run.stdout);
      const expected = {
        against: recompute ? "state-record" : "manifest",
        reason: "digest",
        removed: [],
        added: [],
        edited: ["app-test"],
        settings: false,
      };
      expect(result).toMatchObject({ outcome: "changed", changed: expected, firstGreen: false });
      expect(result.steps).toHaveLength(8);
      expect(result.steps.every((step) => step.status === "skipped")).toBe(true);
      expect(JSON.parse(run.stderr)).toEqual({
        error: {
          tag: "VerifyChanged",
          message: "Verify steps changed since they were recorded.",
          retryable: false,
          next: "the verify steps changed since they were recorded. Don't edit them back; ask the user to run stacks verify --accept-changes from their own terminal, or to undo the change.",
          details: expected,
        },
      });
      expect(existsSync(join(project.root, "order.log"))).toBe(false);
      expect(readFileSync(join(project.root, MANIFEST_PATH), "utf8")).toBe(encodeManifest(changed));
      expect(readRecord(project.file).firstGreenAt).toBeNull();
    },
  );
});

describe("stage boundaries on real projects", () => {
  test("each stage finishes all phases before the next stage begins [3.5b#7]", {
    timeout: 30_000,
  }, async () => {
    const port = await freePort();
    const serve = (name: string, tags: string[] = []): StepInput => ({
      name,
      phase: "serve",
      run: `node server.cjs ${name}`,
      tags,
      expect: { http: `http://127.0.0.1:${port}/`, within: "10s" },
    });
    const log = (
      name: string,
      phase: "setup" | "check" | "teardown",
      tags: string[] = [],
    ): StepInput => ({
      name,
      phase,
      run: `echo ${name} >> order.log`,
      tags,
    });
    const project = recorded([
      log("app-clean", "teardown", ["app"]),
      serve("app-serve", ["app"]),
      log("app-test", "check", ["app"]),
      log("start-application", "setup", ["test", "app"]),
      log("base-clean", "teardown"),
      serve("base-serve"),
      log("base-test", "check"),
      log("base-lint", "check"),
      log("app-named-base", "setup"),
    ]);
    writeFileSync(
      join(project.root, "server.cjs"),
      [
        'const { appendFileSync } = require("node:fs");',
        'const { createServer } = require("node:http");',
        'createServer((_req, res) => res.end("ok")).listen(Number(process.env.PORT_STAGE), "127.0.0.1", () => {',
        '  appendFileSync("order.log", process.argv[2] + "\\n");',
        "});",
      ].join("\n"),
    );
    const result = passed(
      await verify(["--json"], {
        ...project,
        cwd: project.root,
        env: { ...project.env, PORT_STAGE: String(port) },
      }),
    );
    const expected = [
      "app-named-base",
      "base-test",
      "base-lint",
      "base-serve",
      "base-clean",
      "start-application",
      "app-test",
      "app-serve",
      "app-clean",
    ];
    expect(order(project.root)).toEqual(expected);
    expect(result.steps.map((step) => step.name)).toEqual(expected);
    expect(result).toMatchObject({ outcome: "green", stages: { base: "green", app: "green" } });
    const records = runRecords(project.root);
    expect(records).toHaveLength(1);
    expect(records[0]?.steps.map((step) => step.name)).toEqual(expected);
    expect(await answers(port)).toBe(false);
  });

  test.each(["setup", "teardown"] as const)(
    "base %s failure blocks even app teardown [3.5b#8]",
    async (phase) => {
      const project = recorded([
        { name: "base-setup", phase: "setup", run: phase === "setup" ? "exit 3" : "true" },
        { name: "base-test", run: "touch tested" },
        {
          name: "base-clean",
          phase: "teardown",
          run: `echo base-clean >> order.log; ${phase === "teardown" ? "exit 4" : "true"}`,
        },
        { name: "app-setup", phase: "setup", tags: ["app"], run: "echo app-setup >> order.log" },
        { name: "app-test", tags: ["app"], run: "echo app-test >> order.log" },
        { name: "app-clean", phase: "teardown", tags: ["app"], run: "echo app-clean >> order.log" },
      ]);
      writeFileSync(join(project.root, "user.txt"), "keep\n");
      const result = failed(
        await verify(["--json"], { ...project, cwd: project.root }),
        [phase === "setup" ? "base-setup" : "base-clean"],
        FIX,
      );
      expect(order(project.root)).toEqual(["base-clean"]);
      expect(
        result.steps
          .filter((step) => step.name.startsWith("app-"))
          .map((step) => [step.status, step.reason]),
      ).toEqual([
        ["skipped", "base-failed"],
        ["skipped", "base-failed"],
        ["skipped", "base-failed"],
      ]);
      expect(stepNamed(result, "base-test").status).toBe(phase === "setup" ? "skipped" : "passed");
      expect(result).toMatchObject({ stages: { base: "failed", app: null } });
      expect(readFileSync(join(project.root, "user.txt"), "utf8")).toBe("keep\n");
    },
  );

  test("an app setup failure keeps base green and runs only the app cleanup afterward [3.5b#9]", async () => {
    const project = recorded([
      { name: "base-test", run: "true" },
      { name: "base-clean", phase: "teardown", run: "echo base-clean >> order.log" },
      {
        name: "app-setup",
        phase: "setup",
        tags: ["app"],
        run: "echo app-setup >> order.log; exit 3",
      },
      { name: "app-later-setup", phase: "setup", tags: ["app"], run: "echo later >> order.log" },
      { name: "app-test", tags: ["app"], run: "echo app-test >> order.log" },
      { name: "app-clean", phase: "teardown", tags: ["app"], run: "echo app-clean >> order.log" },
    ]);
    const result = failed(
      await verify(["--json"], { ...project, cwd: project.root }),
      ["app-setup"],
      APP_FIX,
    );
    expect(order(project.root)).toEqual(["base-clean", "app-setup", "app-clean"]);
    expect(
      result.steps.filter((step) => step.status === "skipped").map((step) => step.name),
    ).toEqual(["app-later-setup", "app-test"]);
    expect(result).toMatchObject({ stages: { base: "green", app: "failed" } });
    expect(runRecords(project.root)).toMatchObject([
      { outcome: "failed", stages: { base: "green", app: "failed" } },
    ]);
  });

  test("base-only, failed app and successful rerun keep distinct records and whole-project timing [3.5b#10]", async () => {
    const project = await composed();
    writeFileSync(join(project.root, "base-ready"), "");
    const base = passed(
      await verify(["--skip-tag", "app", "--json"], { ...project, cwd: project.root }),
    );
    expect(base).toMatchObject({ outcome: "partial", firstGreen: false });
    expect(readRecord(project.file).firstGreenAt).toBeNull();
    failed(await verify(["--json"], { ...project, cwd: project.root }), ["app-test"], APP_FIX);
    expect(readRecord(project.file).firstGreenAt).toBeNull();
    writeFileSync(join(project.root, "app-ready"), "");
    const green = passed(await verify(["--json"], { ...project, cwd: project.root }));
    expect(green).toMatchObject({ outcome: "green", firstGreen: true });
    const at = readRecord(project.file).firstGreenAt;
    expect(at).not.toBeNull();
    const again = passed(await verify(["--json"], { ...project, cwd: project.root }));
    expect(again.firstGreen).toBe(false);
    expect(readRecord(project.file).firstGreenAt).toBe(at);
    expect(runRecords(project.root)).toMatchObject([
      { outcome: "partial", stages: { base: "green", app: null } },
      { outcome: "failed", stages: { base: "green", app: "failed" } },
      { outcome: "green", stages: { base: "green", app: "green" } },
      { outcome: "green", stages: { base: "green", app: "green" } },
    ]);
  });

  test("nested cwd through a symlink and a spaced Unicode path runs both stages at the project [3.5b#11]", async () => {
    const home = space.dir();
    const root = join(space.dir(), "-projet été");
    mkdirSync(join(root, "nested"), { recursive: true });
    const written = writeRecordedProject(root, home, [
      { name: "base-test", run: "echo base > base.txt" },
      { name: "app-test", run: "echo app > app.txt", tags: ["app"] },
    ]);
    const alias = join(space.dir(), "project link");
    symlinkSync(root, alias);
    const result = passed(
      await verify(["--json"], { home, cwd: join(alias, "nested"), env: stateEnv(home) }),
    );
    expect(readFileSync(join(root, "base.txt"), "utf8")).toBe("base\n");
    expect(readFileSync(join(root, "app.txt"), "utf8")).toBe("app\n");
    expect(existsSync(join(root, "nested", ".stacks"))).toBe(false);
    expect(result).toMatchObject({ stages: { base: "green", app: "green" }, tamperCheck: "full" });
    expect(runRecords(root)).toMatchObject([{ stages: { base: "green", app: "green" } }]);
    expect(readRecord(recordPath(home, written.projectId)).firstGreenAt).not.toBeNull();
  });

  test("an agent's stages share captured env with markers stripped while the record retains the agent [3.5b#12]", async () => {
    const run = `test -z "\${CLAUDECODE+x}" && test "$STAGE_VALUE" = "from wrapper"`;
    const project = recorded([
      { name: "base-test", run: `${run} && echo base >> order.log` },
      { name: "app-test", run: `${run} && echo app >> order.log`, tags: ["app"] },
    ]);
    const result = passed(
      await verify(["--json"], {
        ...project,
        cwd: project.root,
        env: { ...project.env, CLAUDECODE: "1", STAGE_VALUE: "from wrapper" },
      }),
    );
    expect(order(project.root)).toEqual(["base", "app"]);
    expect(result).toMatchObject({ stages: { base: "green", app: "green" } });
    expect(runRecords(project.root)).toMatchObject([
      { agent: "claude", stages: { base: "green", app: "green" } },
    ]);
  });

  test.each(["base", "app"] as const)(
    "interrupting %s records stages and tears down only the started stages [3.5b#13]",
    { timeout: 30_000 },
    async (stage) => {
      const hang = "echo $$ > hang.pid; touch started; exec sleep 30";
      const project = recorded([
        { name: "base-test", run: stage === "base" ? hang : "true" },
        { name: "base-clean", phase: "teardown", run: "echo base-clean >> order.log" },
        { name: "app-setup", phase: "setup", tags: ["app"], run: "echo app-setup >> order.log" },
        {
          name: "app-test",
          tags: ["app"],
          run: stage === "app" ? hang : "echo app-test >> order.log",
        },
        { name: "app-clean", phase: "teardown", tags: ["app"], run: "echo app-clean >> order.log" },
      ]);
      const pidFile = space.trackPid(join(project.root, "hang.pid"));
      writeFileSync(join(project.root, "user.txt"), "keep\n");
      const controller = new AbortController();
      const running = verify(["--json"], {
        ...project,
        cwd: project.root,
        signal: controller.signal,
      });
      let run: CliRun;
      try {
        await vi.waitFor(() => expect(existsSync(join(project.root, "started"))).toBe(true), {
          timeout: 10_000,
        });
      } finally {
        controller.abort();
        run = await running;
      }
      expect(run.status).toBe(130);
      expect(run.stdout).toBe("");
      expect(JSON.parse(splitEvents(run.stderr).rest)).toEqual({
        error: {
          tag: "Interrupted",
          message: "Command interrupted.",
          retryable: false,
          next: "run the same command again when you're ready.",
        },
      });
      expect(startedSteps(run.stderr)).toEqual(
        stage === "base"
          ? ["base-test", "base-clean"]
          : ["base-test", "base-clean", "app-setup", "app-test", "app-clean"],
      );
      const pid = readPid(pidFile);
      if (pid === undefined) throw new Error("the hanging child did not write its pid");
      await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 2000 });
      expect(order(project.root)).toEqual(
        stage === "base" ? ["base-clean"] : ["base-clean", "app-setup", "app-clean"],
      );
      expect(readFileSync(join(project.root, "user.txt"), "utf8")).toBe("keep\n");
      const records = runRecords(project.root);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        outcome: "interrupted",
        stages:
          stage === "base"
            ? { base: "interrupted", app: null }
            : { base: "green", app: "interrupted" },
      });
      expect(records[0]?.steps.find((step) => step.name === `${stage}-test`)).toMatchObject({
        status: "failed",
        failureKind: "interrupted",
      });
      expect(readRecord(project.file).firstGreenAt).toBeNull();
    },
  );
});
