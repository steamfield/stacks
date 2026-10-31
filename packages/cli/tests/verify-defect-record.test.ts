import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { Effect, FileSystem } from "effect";
import { Command } from "effect/cli";
import { afterEach, beforeEach, expect, test } from "vitest";
import { cli } from "../src/cli";
import { VERSION } from "../src/version";
import { quiet, runCli } from "./helpers/cli";
import { notified, spooled, type TelemetryServer, telemetryServer } from "./helpers/telemetry";
import {
  decodeResult,
  envelope,
  readRecord,
  recordPath,
  runRecords,
  type StepInput,
  splitEvents,
  startedSteps,
  stateEnv,
  workspace,
  writeRecordedProject,
} from "./helpers/verify";

const space = workspace();
let server: TelemetryServer;
beforeEach(async () => {
  server = await telemetryServer();
});
afterEach(async () => {
  try {
    await server.close();
    expect(server.errors).toEqual([]);
  } finally {
    space.release();
  }
});

function project(steps: StepInput[]) {
  const home = realpathSync(space.dir());
  const root = realpathSync(space.dir());
  const manifest = writeRecordedProject(root, home, steps);
  return {
    home,
    root,
    file: recordPath(home, manifest.projectId),
    env: {
      PATH: process.env.PATH,
      ...quiet,
      ...stateEnv(home),
      STACKS_TELEMETRY_URL: server.url,
    },
  };
}

function defectAt(target: string, args: readonly string[]) {
  return Effect.gen(function* () {
    const live = yield* FileSystem.FileSystem;
    let injected = false;
    const faulty = FileSystem.make({
      ...live,
      realPath: (path) => {
        if (path !== target || injected) return live.realPath(path);
        injected = true;
        return Effect.die(new TypeError("injected verify defect"));
      },
    });
    yield* Command.runWith(cli, { version: VERSION, renderErrors: false })(args).pipe(
      Effect.provideService(FileSystem.FileSystem, faulty),
    );
  });
}

test.each(["setup", "check", "teardown"] as const)(
  "a defect during %s exits as Defect without recording a run, timings, or verify telemetry",
  async (phase) => {
    const cwd = `fault-${phase}`;
    const steps: StepInput[] = [
      { name: "prepare", phase: "setup", run: "true", ...(phase === "setup" ? { cwd } : {}) },
      {
        name: "unit",
        phase: "check",
        layer: "test",
        run: "true",
        ...(phase === "check" ? { cwd } : {}),
      },
      { name: "clean", phase: "teardown", run: "true", ...(phase === "teardown" ? { cwd } : {}) },
    ];
    const fixture = project(steps);
    const target = join(fixture.root, cwd);
    mkdirSync(target);
    await notified(fixture.home, server.url);

    const args = ["verify", "--json"];
    const result = await runCli(args, {
      home: fixture.home,
      env: fixture.env,
      releaseBuild: true,
      host: { cwd: fixture.root },
      program: defectAt(target, args),
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    const expectedStarted = {
      setup: ["prepare", "clean"],
      check: ["prepare", "unit", "clean"],
      teardown: ["prepare", "unit", "clean"],
    };
    expect(startedSteps(result.stderr)).toEqual(expectedStarted[phase]);
    const { events, rest } = splitEvents(result.stderr);
    const expectedFinished = {
      setup: ["clean"],
      check: ["prepare", "clean"],
      teardown: ["prepare", "unit"],
    };
    expect(
      events.flatMap((event) => (event.event === "step-finished" ? [event.name] : [])),
    ).toEqual(expectedFinished[phase]);
    expect(rest.trim().split("\n")).toHaveLength(1);
    expect(envelope(rest)).toMatchObject({
      error: { tag: "Defect", message: "An unexpected error occurred.", retryable: false },
    });
    expect(result.stderr).not.toContain("injected verify defect");
    expect.soft(runRecords(fixture.root)).toEqual([]);
    expect.soft(readRecord(fixture.file)).toMatchObject({
      firstGreenAt: null,
      firstTestPassAt: null,
    });
    expect.soft(spooled(fixture.home).filter((event) => event.type === "verify")).toEqual([]);
  },
);

test.each([
  { name: "green", command: "true", status: 0, outcome: "green" },
  { name: "failed", command: "exit 7", status: 5, outcome: "failed" },
])("a normal $name run still appends one $outcome record", async (case_) => {
  const fixture = project([{ name: "unit", layer: "test", run: case_.command }]);
  const result = await runCli(["verify", "--json"], {
    home: fixture.home,
    env: fixture.env,
    host: { cwd: fixture.root },
  });

  expect(result.status).toBe(case_.status);
  expect(decodeResult(result.stdout).outcome).toBe(case_.outcome);
  const { rest } = splitEvents(result.stderr);
  if (case_.outcome === "failed")
    expect(envelope(rest)).toMatchObject({ error: { tag: "VerifyFailed" } });
  else expect(rest).toBe("");
  expect(runRecords(fixture.root)).toMatchObject([{ outcome: case_.outcome }]);
  expect(runRecords(fixture.root)).toHaveLength(1);
});
