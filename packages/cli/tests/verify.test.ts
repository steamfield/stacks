import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AGENT_MARKER_NAMES } from "../src/config";
import { encodeManifest, MANIFEST_PATH } from "../src/core/manifest";
import { alive, writeError } from "./helpers/cli";
import {
  decodeResult,
  envelope,
  lastLine,
  manifest,
  readPid,
  splitEvents,
  startedSteps,
  stepNamed,
  verify,
  workspace,
  writeProject,
} from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

const has = (root: string, file: string) => existsSync(join(root, file));
const NOTE_PIPES = "the step left a process holding its output; it was stopped after 2 s";
const FIX =
  "fix the code or config these steps exercise, not the steps, then run stacks verify again.";
const ENV =
  "the machine is missing something these steps need (see each reason); install or start it, then run stacks verify again.";
const NEXT_FIX = `Next: ${FIX}`;
const NEXT_ENV = `Next: ${ENV}`;
const NEXT_PARTIAL =
  "Next: this was a partial run; done means a full stacks verify with outcome green.";

describe("phases", () => {
  test("passing setup, check and teardown steps are green with one result on stdout [1.3a#1]", async () => {
    const root = space.dir();
    writeProject(root, [
      { name: "install", phase: "setup", layer: "install", run: "echo installed" },
      { name: "lint", phase: "check", layer: "lint", run: "true" },
      { name: "clean", phase: "teardown", run: "touch torn" },
    ]);
    const result = await verify(["--json"], { cwd: root });
    expect(splitEvents(result.stderr).rest).toBe("");
    expect(startedSteps(result.stderr)).toEqual(["install", "lint", "clean"]);
    expect(result.status).toBe(0);
    const decoded = decodeResult(result.stdout);
    expect(decoded).toMatchObject({
      outcome: "green",
      scope: "full",
      totals: { passed: 3, failed: 0, skipped: 0 },
    });
    expect(decoded.steps.map((s) => [s.name, s.phase, s.status])).toEqual([
      ["install", "setup", "passed"],
      ["lint", "check", "passed"],
      ["clean", "teardown", "passed"],
    ]);
    expect(stepNamed(decoded, "install")).toMatchObject({
      command: "echo installed",
      layer: "install",
      exitCode: 0,
    });
    for (const s of decoded.steps) {
      expect(s.outputTail).toBeUndefined();
      expect(s.failureKind).toBeUndefined();
      expect(s.durationMs).toBeGreaterThanOrEqual(0);
    }
    expect(decoded.durationMs).toBeGreaterThanOrEqual(0);
    expect(decoded.secondsSinceCreated).toBeGreaterThan(0);
    expect(has(root, "torn")).toBe(true);
  });

  test("phases run setup, check, serve, teardown whatever the manifest order, manifest order within a phase", async () => {
    const root = space.dir();
    const log = (name: string) => `echo ${name} >> order.log`;
    writeProject(root, [
      { name: "down", phase: "teardown", run: log("down") },
      { name: "test", phase: "check", run: log("test") },
      { name: "install", phase: "setup", run: log("install") },
      { name: "lint", phase: "check", run: log("lint") },
      { name: "migrate", phase: "setup", run: log("migrate") },
    ]);
    const result = await verify(["--json"], { cwd: root });
    expect(result.status).toBe(0);
    expect(readFileSync(join(root, "order.log"), "utf8").trim().split("\n")).toEqual([
      "install",
      "migrate",
      "test",
      "lint",
      "down",
    ]);
  });

  test("two failing checks are both reported, the envelope names both, and teardown runs [1.3a#2]", async () => {
    const root = space.dir();
    writeProject(root, [
      { name: "lint", run: "echo lint-broke; exit 1" },
      { name: "types", run: "echo types-broke >&2; exit 2" },
      { name: "test", run: "true" },
      { name: "clean", phase: "teardown", run: "touch torn" },
    ]);
    const result = await verify(["--json"], { cwd: root });
    expect(result.status).toBe(5);
    const decoded = decodeResult(result.stdout);
    expect(decoded.outcome).toBe("failed");
    expect(decoded.totals).toEqual({ passed: 2, failed: 2, skipped: 0 });
    expect(stepNamed(decoded, "lint")).toMatchObject({
      status: "failed",
      failureKind: "step",
      exitCode: 1,
    });
    expect(stepNamed(decoded, "lint").outputTail).toContain("lint-broke");
    expect(stepNamed(decoded, "types")).toMatchObject({
      status: "failed",
      failureKind: "step",
      exitCode: 2,
    });
    expect(stepNamed(decoded, "types").outputTail).toContain("types-broke");
    expect(stepNamed(decoded, "test").status).toBe("passed");
    expect(stepNamed(decoded, "clean").status).toBe("passed");
    expect(has(root, "torn")).toBe(true);
    expect(envelope(result.stderr)).toEqual({
      error: {
        tag: "VerifyFailed",
        message: "Verify failed.",
        retryable: false,
        next: FIX,
        details: {
          failed: [
            { name: "lint", failureKind: "step", exitCode: 1 },
            { name: "types", failureKind: "step", exitCode: 2 },
          ],
        },
      },
    });
    expect(result.stderr).not.toContain("lint-broke");
    expect(result.stderr).not.toContain("types-broke");
  });

  test("a failing setup step skips the rest of setup, check and serve, and teardown still runs [1.3a#3]", async () => {
    const root = space.dir();
    writeProject(root, [
      { name: "install", phase: "setup", run: "exit 3" },
      { name: "migrate", phase: "setup", run: "touch migrated" },
      { name: "lint", run: "touch linted" },
      {
        name: "web",
        phase: "serve",
        run: "touch served",
        expect: { http: "http://127.0.0.1:9/", within: "1s" },
      },
      { name: "clean", phase: "teardown", run: "touch torn" },
    ]);
    const result = await verify(["--json"], { cwd: root });
    expect(result.status).toBe(5);
    const decoded = decodeResult(result.stdout);
    expect(decoded.outcome).toBe("failed");
    expect(decoded.totals).toEqual({ passed: 1, failed: 1, skipped: 3 });
    expect(stepNamed(decoded, "install")).toMatchObject({ status: "failed", exitCode: 3 });
    for (const name of ["migrate", "lint", "web"]) {
      const skipped = stepNamed(decoded, name);
      expect(skipped.status).toBe("skipped");
      expect(skipped.reason).toEqual(expect.any(String));
      expect(skipped.exitCode).toBeUndefined();
    }
    expect(stepNamed(decoded, "clean").status).toBe("passed");
    expect(["migrated", "linted", "served"].filter((f) => has(root, f))).toEqual([]);
    expect(has(root, "torn")).toBe(true);
    expect(envelope(result.stderr)).toMatchObject({
      error: {
        tag: "VerifyFailed",
        details: { failed: [{ name: "install", failureKind: "step", exitCode: 3 }] },
      },
    });
  });

  test("a failing teardown step fails the run", async () => {
    const root = space.dir();
    writeProject(root, [
      { name: "lint", run: "true" },
      { name: "clean", phase: "teardown", run: "exit 4" },
    ]);
    const result = await verify(["--json"], { cwd: root });
    expect(result.status).toBe(5);
    expect(decodeResult(result.stdout).outcome).toBe("failed");
    expect(envelope(result.stderr)).toMatchObject({
      error: { details: { failed: [{ name: "clean", failureKind: "step", exitCode: 4 }] } },
    });
  });

  test("an empty verify list is a green run with no steps", async () => {
    const root = space.dir();
    writeProject(root, []);
    const result = await verify(["--json"], { cwd: root });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(decodeResult(result.stdout)).toMatchObject({
      outcome: "green",
      scope: "full",
      steps: [],
      totals: { passed: 0, failed: 0, skipped: 0 },
    });
  });
});

describe("running a step", () => {
  test("a step past its timeout fails timeout in under 10 s and its process is gone [1.3a#4]", {
    timeout: 30_000,
  }, async () => {
    const root = space.dir();
    writeProject(root, [
      { name: "hang", run: "echo $$ > hang.pid; exec sleep 30", timeout: "1s" },
      { name: "clean", phase: "teardown", run: "touch torn" },
    ]);
    const started = Date.now();
    const result = await verify(["--json"], { cwd: root });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.status).toBe(5);
    const hang = stepNamed(decodeResult(result.stdout), "hang");
    expect(hang).toMatchObject({
      status: "failed",
      failureKind: "timeout",
      reason: "timed out after 1s",
    });
    const pid = readPid(join(root, "hang.pid"));
    expect(pid).toBeDefined();
    await vi.waitFor(() => expect(alive(pid as number)).toBe(false), { timeout: 2000 });
    expect(has(root, "torn")).toBe(true);
    expect(envelope(result.stderr)).toMatchObject({
      error: { details: { failed: [{ name: "hang", failureKind: "timeout" }] } },
    });
  });

  test("a command that isn't installed fails env, named by the step's first word [1.3a#5]", async () => {
    const root = space.dir();
    writeProject(root, [{ name: "tool", run: "nope-not-installed --x" }]);
    const result = await verify(["--json"], { cwd: root });
    expect(result.status).toBe(5);
    expect(stepNamed(decodeResult(result.stdout), "tool")).toMatchObject({
      status: "failed",
      failureKind: "env",
      exitCode: 127,
      reason: "command not found: nope-not-installed",
    });
    expect(envelope(result.stderr)).toEqual({
      error: {
        tag: "VerifyFailed",
        message: "Verify failed.",
        retryable: false,
        next: ENV,
        details: { failed: [{ name: "tool", failureKind: "env", exitCode: 127 }] },
      },
    });
  });

  test("agent markers never reach a step; manifest env fills gaps and the caller's value wins [1.3a#6]", async () => {
    const root = space.dir();
    writeProject(root, [{ name: "show-env", run: "env > env.txt" }], {
      env: { FROM_MANIFEST: "manifest-default", PORT_WEB: "5173" },
    });
    const markers = Object.fromEntries(
      AGENT_MARKER_NAMES.map((name) => {
        if (name === "CURSOR_EXTENSION_HOST_ROLE") return [name, "agent-exec"];
        if (name === "AI_AGENT") return [name, "claude"];
        return [name, "1"];
      }),
    );
    expect(markers.CLAUDECODE).toBe("1");
    const result = await verify(["--json"], {
      cwd: root,
      env: { ...markers, PORT_WEB: "5187" },
    });
    expect(result.status).toBe(0);
    const env = new Map(
      readFileSync(join(root, "env.txt"), "utf8")
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    expect(AGENT_MARKER_NAMES.filter((name) => env.has(name))).toEqual([]);
    expect(env.get("FROM_MANIFEST")).toBe("manifest-default");
    expect(env.get("PORT_WEB")).toBe("5187");
  });

  test("a step that leaves a process holding its output is stopped after the drain and passes with a note [1.3a#12]", {
    timeout: 30_000,
  }, async () => {
    const root = space.dir();
    const pidFile = space.trackPid(join(root, "held.pid"));
    const quietPid = space.trackPid(join(root, "quiet.pid"));
    writeProject(root, [
      {
        name: "detach",
        phase: "setup",
        run: "sh -c 'sleep 600 >/dev/null 2>&1 & echo $! > quiet.pid'",
      },
      { name: "leaky", run: "sleep 600 & echo $! > held.pid" },
    ]);
    const started = Date.now();
    const result = await verify(["--json"], { cwd: root });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.status).toBe(0);
    const decoded = decodeResult(result.stdout);
    expect(decoded.outcome).toBe("green");
    expect(stepNamed(decoded, "leaky")).toMatchObject({ status: "passed", note: NOTE_PIPES });
    expect(stepNamed(decoded, "detach").status).toBe("passed");
    expect(stepNamed(decoded, "detach").note).toBeUndefined();
    const pid = readPid(pidFile);
    expect(pid).toBeDefined();
    await vi.waitFor(() => expect(alive(pid as number)).toBe(false), { timeout: 2000 });
    expect(readPid(quietPid)).toBeDefined();
  });

  test("a failing step that leaves a process holding its output fails step with the drain reason [1.3a#12]", {
    timeout: 30_000,
  }, async () => {
    const root = space.dir();
    const pidFile = space.trackPid(join(root, "held.pid"));
    writeProject(root, [{ name: "leaky", run: "sleep 600 & echo $! > held.pid; exit 1" }]);
    const started = Date.now();
    const result = await verify(["--json"], { cwd: root });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.status).toBe(5);
    const leaky = stepNamed(decodeResult(result.stdout), "leaky");
    expect(leaky).toMatchObject({
      status: "failed",
      failureKind: "step",
      exitCode: 1,
      reason: NOTE_PIPES,
    });
    expect(leaky.note).toBeUndefined();
    const pid = readPid(pidFile);
    await vi.waitFor(() => expect(alive(pid as number)).toBe(false), { timeout: 2000 });
  });

  test("a step runs in the project root, even when the project is reached through a symlink", async () => {
    const real = space.dir();
    const project = join(real, "my project");
    mkdirSync(project);
    writeProject(project, [{ name: "where", run: "pwd -P > where.txt" }]);
    const link = join(space.dir(), "linked");
    symlinkSync(project, link);
    const result = await verify(["--json"], { cwd: link });
    expect(result.status).toBe(0);
    expect(readFileSync(join(project, "where.txt"), "utf8").trim()).toBe(realpathSync(project));
  });
});

describe("step cwd", () => {
  test("a step cwd that escapes the project fails env without running [1.3a#13]", async () => {
    const parent = space.dir();
    const root = join(parent, "app");
    mkdirSync(join(parent, "outside"), { recursive: true });
    mkdirSync(root);
    writeProject(root, [{ name: "escape", run: "touch ran", cwd: "../outside" }]);
    const result = await verify(["--json"], { cwd: root });
    expect(result.status).toBe(5);
    const escaped = stepNamed(decodeResult(result.stdout), "escape");
    expect(escaped).toMatchObject({ status: "failed", failureKind: "env" });
    expect(escaped.reason).toContain("outside the project");
    expect(escaped.exitCode).toBeUndefined();
    expect(has(join(parent, "outside"), "ran")).toBe(false);
    expect(envelope(result.stderr)).toEqual({
      error: {
        tag: "VerifyFailed",
        message: "Verify failed.",
        retryable: false,
        next: ENV,
        details: { failed: [{ name: "escape", failureKind: "env" }] },
      },
    });
  });

  test("a step cwd that is a symlink pointing outside the project fails env without running [1.3a#13]", async () => {
    const root = space.dir();
    const outside = space.dir();
    symlinkSync(outside, join(root, "vendor"));
    writeProject(root, [{ name: "escape", run: "touch ran", cwd: "vendor" }]);
    const result = await verify(["--json"], { cwd: root });
    expect(result.status).toBe(5);
    const escaped = stepNamed(decodeResult(result.stdout), "escape");
    expect(escaped).toMatchObject({ status: "failed", failureKind: "env" });
    expect(escaped.reason).toContain("outside the project");
    expect(has(outside, "ran")).toBe(false);
  });

  test("a step cwd inside the project runs there, including through an internal symlink", async () => {
    const root = space.dir();
    mkdirSync(join(root, "packages", "web"), { recursive: true });
    symlinkSync(join(root, "packages", "web"), join(root, "web"));
    writeProject(root, [
      { name: "direct", run: "pwd -P > direct.txt", cwd: "packages/web" },
      { name: "aliased", run: "touch aliased", cwd: "web" },
    ]);
    const result = await verify(["--json"], { cwd: root });
    expect(result.status).toBe(0);
    expect(readFileSync(join(root, "packages/web/direct.txt"), "utf8").trim()).toBe(
      realpathSync(join(root, "packages/web")),
    );
    expect(has(join(root, "packages/web"), "aliased")).toBe(true);
  });

  test("a step cwd that doesn't exist fails env", async () => {
    const root = space.dir();
    writeProject(root, [{ name: "missing", run: "true", cwd: "not-there" }]);
    const result = await verify(["--json"], { cwd: root });
    expect(result.status).toBe(5);
    expect(stepNamed(decodeResult(result.stdout), "missing")).toMatchObject({
      status: "failed",
      failureKind: "env",
    });
  });
});

describe("selection", () => {
  const steps = [
    { name: "install", phase: "setup" as const, run: "touch installed" },
    { name: "lint", run: "touch linted" },
    { name: "test", run: "touch tested", tags: ["slow"] },
    { name: "clean", phase: "teardown" as const, run: "touch torn" },
  ];

  test("--only runs just those checks, with setup and teardown, as a partial run that exits 0 [1.3a#14]", async () => {
    const root = space.dir();
    writeProject(root, steps);
    const result = await verify(["--only", "lint", "--json"], { cwd: root });
    expect(splitEvents(result.stderr).rest).toBe("");
    expect(startedSteps(result.stderr)).toEqual(["install", "lint", "clean"]);
    expect(result.status).toBe(0);
    const decoded = decodeResult(result.stdout);
    expect(decoded).toMatchObject({ outcome: "partial", scope: "partial" });
    expect(stepNamed(decoded, "test").status).toBe("skipped");
    expect(stepNamed(decoded, "lint").status).toBe("passed");
    expect(["installed", "linted", "tested", "torn"].filter((f) => has(root, f))).toEqual([
      "installed",
      "linted",
      "torn",
    ]);
  });

  test.each(["agent", "human"])(
    "a failed setup explains why it ran under --only in %s output",
    async (audience) => {
      const root = space.dir();
      writeProject(root, [
        { name: "install", phase: "setup", run: "exit 1" },
        { name: "lint", run: "touch linted" },
      ]);
      const result = await verify(["--only", "lint"], {
        cwd: root,
        host: { stdoutIsTTY: audience === "human" },
      });
      expect(result.status).toBe(5);
      expect(result.stdout).toMatch(/verify: failed \(partial run; 0 passed, 1 failed, 1 skipped;/);
      expect(result.stdout).toMatch(
        /failed\s+setup\s+install.*setup always runs, even in a partial run/,
      );
      expect(result.stdout).toMatch(/skipped\s+check\s+lint.*an earlier setup step failed/);
      expect(result.stderr).not.toContain("Failed:");
      expect(lastLine(result.stdout)).toBe(NEXT_FIX);
      expect(has(root, "linted")).toBe(false);
    },
  );

  test("a failed setup in a full run doesn't mention partial runs", async () => {
    const root = space.dir();
    writeProject(root, [
      { name: "install", phase: "setup", run: "exit 1" },
      { name: "lint", run: "touch linted" },
    ]);
    const result = await verify([], { cwd: root });
    expect(result.status).toBe(5);
    expect(result.stdout).toMatch(/verify: failed \(full run;/);
    expect(result.stdout).toMatch(/failed\s+setup\s+install/);
    expect(result.stdout).not.toContain("partial run");
    expect(result.stderr).not.toContain("Failed:");
  });

  test("--only takes a comma list and repeats", async () => {
    const root = space.dir();
    writeProject(root, [...steps, { name: "build", run: "touch built" }]);
    const comma = await verify(["--only", "lint,build", "--json"], { cwd: root });
    expect(comma.status).toBe(0);
    expect(stepNamed(decodeResult(comma.stdout), "test").status).toBe("skipped");
    expect(stepNamed(decodeResult(comma.stdout), "build").status).toBe("passed");
    const repeated = await verify(["--only", "lint", "--only", "test", "--json"], { cwd: root });
    expect(repeated.status).toBe(0);
    const decoded = decodeResult(repeated.stdout);
    expect(stepNamed(decoded, "test").status).toBe("passed");
    expect(stepNamed(decoded, "build").status).toBe("skipped");
  });

  test("an unknown --only name exits 2 listing the known check and serve names, running nothing [1.3a#14]", async () => {
    const root = space.dir();
    writeProject(root, [
      ...steps,
      {
        name: "web",
        phase: "serve",
        run: "true",
        expect: { http: "http://127.0.0.1:9/" },
      },
    ]);
    const result = await verify(["--only", "nope", "--json"], { cwd: root });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(envelope(result.stderr)).toEqual({
      error: {
        tag: "BadInput",
        message: "Invalid input.",
        retryable: false,
        next: "pass --only names from that list; setup and teardown steps always run.",
        details: { id: "nope", flag: "only", known: ["lint", "test", "web"] },
      },
    });
    expect(["installed", "torn"].filter((f) => has(root, f))).toEqual([]);
  });

  test("--skip-tag skips tagged steps as a partial run [1.3a#14]", async () => {
    const root = space.dir();
    writeProject(root, steps);
    const result = await verify(["--skip-tag", "slow", "--json"], { cwd: root });
    expect(result.status).toBe(0);
    const decoded = decodeResult(result.stdout);
    expect(decoded).toMatchObject({ outcome: "partial", scope: "partial" });
    expect(stepNamed(decoded, "test")).toMatchObject({ status: "skipped" });
    expect(stepNamed(decoded, "test").reason).toEqual(expect.any(String));
    expect(has(root, "tested")).toBe(false);
    expect(has(root, "linted")).toBe(true);
  });

  test("a partial run with a failing step is failed, not partial", async () => {
    const root = space.dir();
    writeProject(root, [
      { name: "lint", run: "exit 1" },
      { name: "test", run: "true", tags: ["slow"] },
    ]);
    const result = await verify(["--skip-tag", "slow", "--json"], { cwd: root });
    expect(result.status).toBe(5);
    expect(decodeResult(result.stdout)).toMatchObject({ outcome: "failed", scope: "partial" });
  });

  test("a sandbox project skips its prod step by default and --all runs it, both full runs [1.3a#15]", async () => {
    const root = space.dir();
    writeProject(
      root,
      [
        { name: "lint", run: "true" },
        { name: "deploy-check", run: "touch prod-ran", tags: ["prod"], skipByDefault: true },
      ],
      { preset: "sandbox" },
    );
    const plain = await verify(["--json"], { cwd: root });
    expect(plain.status).toBe(0);
    const skipped = decodeResult(plain.stdout);
    expect(skipped).toMatchObject({ outcome: "green", scope: "full" });
    expect(stepNamed(skipped, "deploy-check").status).toBe("skipped");
    expect(stepNamed(skipped, "deploy-check").reason).toEqual(expect.any(String));
    expect(has(root, "prod-ran")).toBe(false);
    const all = await verify(["--all", "--json"], { cwd: root });
    expect(all.status).toBe(0);
    const ran = decodeResult(all.stdout);
    expect(ran).toMatchObject({ outcome: "green", scope: "full" });
    expect(stepNamed(ran, "deploy-check").status).toBe("passed");
    expect(has(root, "prod-ran")).toBe(true);
  });
});

describe("finding the project", () => {
  test("verify run from a subdirectory finds the manifest and runs steps in the root [1.3a#17]", async () => {
    const root = space.dir();
    mkdirSync(join(root, "src", "deep"), { recursive: true });
    writeProject(root, [{ name: "where", run: "pwd -P > where.txt" }]);
    const result = await verify(["--json"], { cwd: join(root, "src", "deep") });
    expect(result.status).toBe(0);
    expect(readFileSync(join(root, "where.txt"), "utf8").trim()).toBe(realpathSync(root));
  });

  test("outside any project exits 2 NotFound naming where the walk started [1.3a#17]", async () => {
    const outside = space.dir();
    const start = join(outside, "not a project");
    mkdirSync(start);
    const result = await verify(["--json"], { cwd: start });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(envelope(result.stderr)).toMatchObject({
      error: {
        tag: "NotFound",
        retryable: false,
        details: { suggestions: [], kind: "project", looked: start },
      },
    });
    const human = await verify([], { cwd: start });
    expect(human.status).toBe(2);
    expect(human.stdout).toBe("");
    expect(human.stderr).toContain("Not found.");
  });

  test("a manifest a newer stacks wrote exits 3 InvalidConfig with its schema version [1.3a#17]", async () => {
    const root = space.dir();
    mkdirSync(join(root, ".stacks"));
    const v1 = JSON.parse(encodeManifest(manifest([{ name: "lint", run: "touch ran" }])));
    writeFileSync(join(root, MANIFEST_PATH), JSON.stringify({ ...v1, schemaVersion: 2 }));
    const result = await verify(["--json"], { cwd: root });
    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    const error = (envelope(result.stderr) as { error: Record<string, unknown> }).error;
    expect(error).toMatchObject({ tag: "InvalidConfig", retryable: false });
    expect(error.details).toEqual({
      path: expect.stringMatching(/\.stacks\/manifest\.json$/),
      schemaVersion: 2,
    });
    expect([join(root, MANIFEST_PATH), join(realpathSync(root), MANIFEST_PATH)]).toContain(
      (error.details as { path: string }).path,
    );
    expect(has(root, "ran")).toBe(false);
  });

  test("a manifest that isn't JSON exits 3 InvalidConfig and runs nothing", async () => {
    const root = space.dir();
    mkdirSync(join(root, ".stacks"));
    writeFileSync(join(root, MANIFEST_PATH), "{ not json");
    const result = await verify(["--json"], { cwd: root });
    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    expect(envelope(result.stderr)).toMatchObject({ error: { tag: "InvalidConfig" } });
  });
});

describe("output", () => {
  test("a closed stdout after a failing run keeps exit 5 and still writes the envelope [1.3a#18]", async () => {
    const root = space.dir();
    writeProject(root, [{ name: "lint", run: "exit 1" }]);
    const result = await verify(["--json"], {
      cwd: root,
      stdout: async () => {
        throw writeError("EPIPE");
      },
    });
    expect(result.status).toBe(5);
    expect(result.stdout).toBe("");
    expect(envelope(result.stderr)).toMatchObject({
      error: { tag: "VerifyFailed", details: { failed: [{ name: "lint", failureKind: "step" }] } },
    });
  });

  test("human mode prints each command before it runs, on stderr", async () => {
    const root = space.dir();
    writeProject(root, [
      { name: "install", phase: "setup", run: "echo installing" },
      { name: "lint", run: "true" },
    ]);
    const result = await verify([], { cwd: root, host: { stdoutIsTTY: true } });
    expect(result.status).toBe(0);
    const install = result.stderr.indexOf("> install: echo installing\n");
    const lint = result.stderr.indexOf("> lint: true\n");
    expect(install).toBeGreaterThanOrEqual(0);
    expect(lint).toBeGreaterThan(install);
    expect(result.stdout).not.toContain("> lint:");
  });

  test("a failing step run ends with the fix-the-code Next line [1.3a#19]", async () => {
    const root = space.dir();
    writeProject(root, [
      { name: "lint", run: "exit 1" },
      { name: "tool", run: "nope-not-installed" },
    ]);
    const result = await verify([], { cwd: root });
    expect(result.status).toBe(5);
    expect(lastLine(result.stdout)).toBe(NEXT_FIX);
    expect(result.stdout.split("Next:")).toHaveLength(2);
    expect(result.stderr).toContain("Verify failed.");
  });

  test("a timeout-only failure also ends with the fix-the-code Next line [1.3a#19]", {
    timeout: 30_000,
  }, async () => {
    const root = space.dir();
    writeProject(root, [{ name: "hang", run: "exec sleep 30", timeout: "500ms" }]);
    const result = await verify([], { cwd: root });
    expect(result.status).toBe(5);
    expect(lastLine(result.stdout)).toBe(NEXT_FIX);
  });

  test("an all-env failure ends with the machine-is-missing Next line [1.3a#19]", async () => {
    const root = space.dir();
    writeProject(root, [{ name: "tool", run: "nope-not-installed --x" }]);
    const result = await verify([], { cwd: root });
    expect(result.status).toBe(5);
    expect(lastLine(result.stdout)).toBe(NEXT_ENV);
  });

  test("a passing --only run ends with the partial Next line; a green run has none [1.3a#19]", async () => {
    const root = space.dir();
    writeProject(root, [
      { name: "lint", run: "true" },
      { name: "test", run: "true" },
    ]);
    const partial = await verify(["--only", "lint"], { cwd: root });
    expect(partial.status).toBe(0);
    expect(lastLine(partial.stdout)).toBe(NEXT_PARTIAL);
    const green = await verify([], { cwd: root });
    expect(green.status).toBe(0);
    expect(green.stdout).not.toContain("Next:");
    expect(green.stderr).not.toContain("Next:");
  });

  test("--json output never contains a Next line [1.3a#19]", async () => {
    const root = space.dir();
    writeProject(root, [
      { name: "lint", run: "exit 1" },
      { name: "test", run: "true" },
    ]);
    for (const args of [["--json"], ["--only", "test", "--json"]]) {
      const result = await verify(args, { cwd: root });
      expect(result.stdout).not.toContain("Next:");
      expect(result.stderr).not.toContain("Next:");
    }
    const json = await verify(["--json"], { cwd: root });
    expect(startedSteps(json.stderr)).toEqual(["lint", "test"]);
    expect(splitEvents(json.stderr).rest.trim().split("\n")).toHaveLength(1);
  });
});
