import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, type FileSystem, type Path } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import type { AppConfig } from "../src/config";
import { MANIFEST_PATH } from "../src/core/manifest";
import { recordRun } from "../src/core/verify/record";
import { type RunResult, runVerify } from "../src/core/verify/run";
import { checkTamper } from "../src/core/verify/tamper";
import { quiet, runCli } from "./helpers/cli";
import {
  decodeResult,
  lastLine,
  runRecords,
  type StepInput,
  splitEvents,
  startedSteps,
  stateEnv,
  workspace,
  writeRecordedProject,
} from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

function recorded(steps: StepInput[]) {
  const home = space.dir();
  const root = space.dir();
  const manifest = writeRecordedProject(root, home, steps);
  return { home, root, manifest, env: { PATH: process.env.PATH, ...quiet, ...stateEnv(home) } };
}

test.each(["human", "agent"])(
  "%s Next keeps environment advice for an env-only app failure [3.5b#2]",
  async (audience) => {
    const project = recorded([
      { name: "base-test", run: "true" },
      { name: "app-test", tags: ["app"], run: "./missing-app-command" },
    ]);
    const run = await runCli(["verify"], {
      ...project,
      host: { cwd: project.root, stdoutIsTTY: audience === "human" },
    });
    expect(run.status).toBe(5);
    const failure = "Verify failed.\n  Failed: app-test (env, exit 127)\n";
    if (audience === "human") {
      expect(run.stderr).toContain("> base-test: true\n> app-test: ./missing-app-command\n");
      expect(run.stderr.endsWith(failure)).toBe(true);
    } else expect(run.stderr).toBe(`> base-test\n> app-test\n${failure}`);
    expect(run.stdout).toContain("base: green\napp: failed\nverify: failed");
    const next = lastLine(run.stdout);
    expect(next).toContain("the machine is missing something these steps need");
    expect(next).toContain("install or start it");
    expect(next).toContain("application section");
    expect(next).toContain(".stacks/BRIEF.md");
    expect(runRecords(project.root)).toMatchObject([
      { outcome: "failed", stages: { base: "green", app: "failed" } },
    ]);
  },
);

test.each(["base", "app"] as const)(
  "interrupting %s teardown records that stage as interrupted in the result and record [3.5b#13]",
  { timeout: 30_000 },
  async (stage) => {
    const project = recorded([
      { name: "base-test", run: "true" },
      {
        name: "base-clean",
        phase: "teardown",
        run: stage === "base" ? "node cleanup.cjs base-clean" : "echo base-clean >> order.log",
        timeout: "10s",
      },
      { name: "app-test", tags: ["app"], run: "touch app-started" },
      {
        name: "app-clean",
        phase: "teardown",
        tags: ["app"],
        run: stage === "app" ? "node cleanup.cjs app-clean" : "echo app-clean >> order.log",
        timeout: "10s",
      },
    ]);
    writeFileSync(
      join(project.root, "cleanup.cjs"),
      [
        'const { appendFileSync, existsSync, watch, writeFileSync } = require("node:fs");',
        "let done = false;",
        "const finish = () => {",
        '  if (done || !existsSync("release-cleanup")) return;',
        "  done = true;",
        "  watcher.close();",
        "  clearInterval(poll);",
        '  appendFileSync("order.log", process.argv[2] + "\\n");',
        "};",
        'const watcher = watch(".", finish);',
        // A loaded macOS host can drop the watch event; polling keeps the release observable.
        "const poll = setInterval(finish, 50);",
        'writeFileSync("cleanup-started", "");',
        "finish();",
      ].join("\n"),
    );
    const finished: RunResult[] = [];
    const program = Effect.gen(function* () {
      const tamper = yield* checkTamper(project.manifest, join(project.root, MANIFEST_PATH));
      const services = yield* Effect.context<FileSystem.FileSystem | Path.Path | AppConfig>();
      yield* runVerify(
        { ...project, createdAt: project.manifest.createdAt },
        { only: [], skipTags: [], all: false },
        (result) =>
          recordRun({ ...project, tamper, acceptedChanges: false }, result).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                finished.push(result);
              }),
            ),
            Effect.asVoid,
            Effect.provideContext(services),
          ),
      );
    });
    const controller = new AbortController();
    const running = runCli(["--json"], {
      ...project,
      program,
      signal: controller.signal,
      host: { cwd: project.root },
    });
    let run: Awaited<typeof running>;
    try {
      await vi.waitFor(() => expect(existsSync(join(project.root, "cleanup-started"))).toBe(true), {
        timeout: 10_000,
      });
    } finally {
      controller.abort();
      writeFileSync(join(project.root, "release-cleanup"), "");
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
        : ["base-test", "base-clean", "app-test", "app-clean"],
    );
    const stages =
      stage === "base" ? { base: "interrupted", app: null } : { base: "green", app: "interrupted" };
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ outcome: "interrupted", stages });
    if (stage === "base")
      expect(finished[0]?.steps.filter((step) => step.name.startsWith("app-"))).toEqual([
        expect.objectContaining({ name: "app-test", status: "skipped", reason: "base-failed" }),
        expect.objectContaining({ name: "app-clean", status: "skipped", reason: "base-failed" }),
      ]);
    expect(runRecords(project.root)).toMatchObject([{ outcome: "interrupted", stages }]);
    expect(readFileSync(join(project.root, "order.log"), "utf8").trim().split("\n")).toEqual(
      stage === "base" ? ["base-clean"] : ["base-clean", "app-clean"],
    );
    expect(existsSync(join(project.root, "app-started"))).toBe(stage === "app");
  },
);

test.each([
  ["--only", "app-test"],
  ["--skip-tag", "base"],
])(
  "%s %s leaves the app waiting for a full base verify instead of reporting base-failed",
  async (...flags) => {
    const project = recorded([
      { name: "base-test", tags: ["base"], run: "true" },
      { name: "app-setup", phase: "setup", tags: ["app"], run: "touch app-started" },
      { name: "app-test", tags: ["app"], run: "touch app-started" },
      { name: "app-clean", phase: "teardown", tags: ["app"], run: "touch app-started" },
    ]);
    const run = await runCli(["verify", ...flags, "--json"], {
      ...project,
      host: { cwd: project.root },
    });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    const result = decodeResult(run.stdout);
    expect(result).toMatchObject({
      outcome: "partial",
      scope: "partial",
      stages: { base: "partial", app: null },
      totals: { passed: 0, failed: 0, skipped: 4 },
      firstGreen: false,
    });
    expect(
      result.steps
        .filter((step) => step.name.startsWith("app-"))
        .map((step) => ({
          name: step.name,
          status: step.status,
          reason: step.reason,
        })),
    ).toEqual(
      ["app-setup", "app-test", "app-clean"].map((name) => ({
        name,
        status: "skipped",
        reason: "the base did not fully run; the app stage waits for a full verify",
      })),
    );
    expect(existsSync(join(project.root, "app-started"))).toBe(false);
    expect(runRecords(project.root)).toMatchObject([
      { outcome: "partial", stages: { base: "partial", app: null } },
    ]);
  },
);
