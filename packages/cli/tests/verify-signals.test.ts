import { existsSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import { locateManifest, readManifest } from "../src/core/manifest";
import type { RunResult } from "../src/core/verify/result";
import { runVerify } from "../src/core/verify/run";
import { alive, quiet, runCli } from "./helpers/cli";
import { envelope, readPid, verify, workspace, writeProject } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

const has = (root: string, file: string) => existsSync(join(root, file));

/** A project whose `hang` check writes its pid and a marker, then sleeps; later steps leave markers. */
function hangingProject() {
  const root = space.dir();
  space.trackPid(join(root, "hang.pid"));
  writeProject(root, [
    { name: "install", phase: "setup", run: "true" },
    { name: "hang", run: "echo $$ > hang.pid; touch started; exec sleep 30" },
    { name: "lint", run: "touch linted" },
    { name: "clean", phase: "teardown", run: "touch torn" },
  ]);
  return root;
}
/** Aborts `controller` once the hang step has visibly started. */
function abortWhenStarted(root: string, controller: AbortController) {
  return vi
    .waitFor(() => expect(has(root, "started")).toBe(true), { timeout: 10_000 })
    .then(() => controller.abort());
}

test("interrupting verify during a step exits 130, kills the step and runs teardown [1.3a#16]", {
  timeout: 30_000,
}, async () => {
  const root = hangingProject();
  const controller = new AbortController();
  const aborted = abortWhenStarted(root, controller);
  const result = await verify(["--json"], { cwd: root, signal: controller.signal });
  await aborted;
  expect(result.status).toBe(130);
  expect(result.stdout).toBe("");
  expect(envelope(result.stderr)).toMatchObject({
    error: { tag: "Interrupted", retryable: false },
  });
  expect(has(root, "torn")).toBe(true);
  expect(has(root, "linted")).toBe(false);
  const pid = readPid(join(root, "hang.pid"));
  expect(pid).toBeDefined();
  await vi.waitFor(() => expect(alive(pid as number)).toBe(false), { timeout: 2000 });
});

test("an interrupted run hands onFinished outcome interrupted with the step interrupted [1.3a#16]", {
  timeout: 30_000,
}, async () => {
  const root = hangingProject();
  const finished: RunResult[] = [];
  const program = Effect.gen(function* () {
    const project = yield* locateManifest(root);
    const manifest = yield* readManifest(project.path);
    yield* runVerify(
      { root: project.root, manifest, createdAt: manifest.createdAt },
      { only: [], skipTags: [], all: false },
      (result) =>
        Effect.sync(() => {
          finished.push(result);
        }),
    );
  });
  const controller = new AbortController();
  const aborted = abortWhenStarted(root, controller);
  const home = space.dir();
  const result = await runCli([], {
    home,
    program,
    signal: controller.signal,
    host: { cwd: root },
    env: { PATH: process.env.PATH, ...quiet },
  });
  await aborted;
  expect(result.status).toBe(130);
  expect(has(root, "torn")).toBe(true);
  const pid = readPid(join(root, "hang.pid"));
  await vi.waitFor(() => expect(alive(pid as number)).toBe(false), { timeout: 2000 });
  expect(finished).toHaveLength(1);
  const [run] = finished;
  expect(run?.outcome).toBe("interrupted");
  const byName = new Map(run?.steps.map((item) => [item.name, item]));
  expect(byName.get("install")?.status).toBe("passed");
  expect(byName.get("hang")).toMatchObject({ status: "failed", failureKind: "interrupted" });
  expect(byName.get("lint")?.status).toBe("skipped");
  expect(byName.get("clean")?.status).toBe("passed");
});
