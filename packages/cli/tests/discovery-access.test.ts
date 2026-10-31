import { chmodSync, existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Cause, Effect, Exit, FileSystem, PlatformError, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { locateManifest, MANIFEST_PATH } from "../src/core/manifest";
import { projectRuns } from "../src/core/runs";
import { exitCode, PermissionDenied } from "../src/errors";
import { ProjectRuns } from "../src/schemas/runs";
import { quiet, runCli } from "./helpers/cli";
import { runRecord } from "./helpers/ledger";
import { runWith } from "./helpers/state";
import {
  envelope,
  splitEvents,
  stateEnv,
  verify,
  workspace,
  writeProject,
  writeRecordedProject,
} from "./helpers/verify";

const space = workspace();
const asRoot = process.getuid?.() === 0;
afterEach(() => space.release());

const projectDir = () => realpathSync(space.dir());
const runsPath = (root: string) => join(root, ".stacks", "state", "runs.jsonl");
const runHistory = (root: string, home: string) =>
  runCli(["runs", "--json"], {
    home,
    env: { ...quiet, ...stateEnv(home) },
    host: { cwd: root },
  });
const decodeRuns = (stdout: string) =>
  Schema.decodeUnknownSync(ProjectRuns, { onExcessProperty: "error" })(JSON.parse(stdout));
const unknownRead = (method: string, path: string) =>
  PlatformError.systemError({
    _tag: "Unknown",
    module: "FileSystem",
    method,
    pathOrDescriptor: path,
  });
const failedError = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit) ? exit.cause.reasons.find(Cause.isFailReason)?.error : undefined;

test.skipIf(asRoot)(
  "verify refuses an inaccessible child manifest without running the parent project",
  async () => {
    const parent = projectDir();
    const home = projectDir();
    const child = join(parent, "child");
    mkdirSync(child);
    writeRecordedProject(parent, home, [{ name: "parent-check", run: "touch parent-ran" }]);
    writeProject(child, [{ name: "child-check", run: "touch child-ran" }]);
    const metadata = join(child, ".stacks");
    chmodSync(metadata, 0o000);
    try {
      const result = await verify(["--json"], { cwd: child, home, env: stateEnv(home) });
      expect(result.status).toBe(6);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
      expect(envelope(result.stderr)).toMatchObject({
        error: {
          tag: "PermissionDenied",
          details: { reason: "read", path: join(child, MANIFEST_PATH) },
        },
      });
      expect(existsSync(join(parent, "parent-ran"))).toBe(false);
      expect(existsSync(join(child, "child-ran"))).toBe(false);
    } finally {
      chmodSync(metadata, 0o755);
    }
  },
);

test("project discovery refuses an unknown stat failure instead of selecting an ancestor", async () => {
  const parent = projectDir();
  const child = join(parent, "child");
  mkdirSync(child);
  writeProject(parent, []);
  writeProject(child, []);
  const candidate = join(child, MANIFEST_PATH);
  const exit = await runWith(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const faulty = FileSystem.make({
        ...fs,
        stat: (path) =>
          path === candidate ? Effect.fail(unknownRead("stat", path)) : fs.stat(path),
      });
      return yield* locateManifest(child).pipe(
        Effect.provideService(FileSystem.FileSystem, faulty),
      );
    }),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  const error = failedError(exit);
  expect(error).toMatchObject({
    _tag: "PermissionDenied",
    details: { reason: "read", path: candidate },
  });
  if (error instanceof PermissionDenied) expect(exitCode(error)).toBe(6);
});

test("verify finds the nearest project from a plain nested directory", async () => {
  const parent = projectDir();
  const home = projectDir();
  const child = join(parent, "child");
  const sub = join(child, "sub");
  mkdirSync(sub, { recursive: true });
  writeRecordedProject(child, home, [{ name: "child-check", run: "touch child-ran" }]);

  const result = await verify(["--json"], { cwd: sub, home, env: stateEnv(home) });
  expect(result.status).toBe(0);
  expect(splitEvents(result.stderr).rest).toBe("");
  expect(existsSync(join(child, "child-ran"))).toBe(true);
  expect(existsSync(join(parent, "child-ran"))).toBe(false);
});

test("verify walks past a regular .stacks file to find the parent project", async () => {
  const root = projectDir();
  const home = projectDir();
  const nested = join(root, "nested");
  mkdirSync(nested);
  writeFileSync(join(nested, ".stacks"), "ordinary file");
  writeRecordedProject(root, home, [{ name: "root-check", run: "touch root-ran" }]);

  const result = await verify(["--json"], { cwd: nested, home, env: stateEnv(home) });
  expect(result.status).toBe(0);
  expect(splitEvents(result.stderr).rest).toBe("");
  expect(existsSync(join(root, "root-ran"))).toBe(true);
});

test.skipIf(asRoot)(
  "runs refuses an inaccessible child manifest instead of reporting parent history",
  async () => {
    const parent = projectDir();
    const home = projectDir();
    const child = join(parent, "child");
    mkdirSync(child);
    writeProject(parent, []);
    mkdirSync(join(parent, ".stacks", "state"));
    writeFileSync(runsPath(parent), `${JSON.stringify(runRecord())}\n`);
    writeProject(child, []);
    const metadata = join(child, ".stacks");
    chmodSync(metadata, 0o000);
    try {
      const result = await runHistory(child, home);
      expect(result.status).toBe(6);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
      expect(envelope(result.stderr)).toMatchObject({
        error: {
          tag: "PermissionDenied",
          details: { reason: "read", path: join(child, MANIFEST_PATH) },
        },
      });
    } finally {
      chmodSync(metadata, 0o755);
    }
  },
);

test("runs reports zero verify runs when history is absent", async () => {
  const root = projectDir();
  const home = projectDir();
  writeProject(root, []);

  const result = await runHistory(root, home);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(decodeRuns(result.stdout)).toMatchObject({ verifyRuns: 0, skippedLines: 0 });
});

test("runs rejects a directory at the history path", async () => {
  const root = projectDir();
  const home = projectDir();
  writeProject(root, []);
  mkdirSync(join(root, ".stacks", "state"));
  const history = runsPath(root);
  mkdirSync(history);

  const result = await runHistory(root, home);
  expect(result.status).toBe(6);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim().split("\n")).toHaveLength(1);
  expect(envelope(result.stderr)).toMatchObject({
    error: { tag: "PermissionDenied", details: { reason: "read", path: history } },
  });
});

test.skipIf(asRoot)("runs rejects an unreadable history file", async () => {
  const root = projectDir();
  const home = projectDir();
  writeProject(root, []);
  mkdirSync(join(root, ".stacks", "state"));
  const history = runsPath(root);
  writeFileSync(history, `${JSON.stringify(runRecord())}\n`);
  chmodSync(history, 0o000);
  try {
    const result = await runHistory(root, home);
    expect(result.status).toBe(6);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(envelope(result.stderr)).toMatchObject({
      error: { tag: "PermissionDenied", details: { reason: "read", path: history } },
    });
  } finally {
    chmodSync(history, 0o644);
  }
});

test("runs refuses an unknown history read failure instead of reporting zero runs", async () => {
  const root = projectDir();
  const home = projectDir();
  writeProject(root, []);
  const history = runsPath(root);
  const exit = await runWith(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const faulty = {
        ...fs,
        readFileString: (...params: Parameters<typeof fs.readFileString>) =>
          params[0] === history
            ? Effect.fail(unknownRead("readFileString", params[0]))
            : fs.readFileString(...params),
      };
      return yield* projectRuns(root).pipe(Effect.provideService(FileSystem.FileSystem, faulty));
    }),
    { HOME: home, ...stateEnv(home) },
  );
  expect(Exit.isFailure(exit)).toBe(true);
  const error = failedError(exit);
  expect(error).toMatchObject({
    _tag: "PermissionDenied",
    details: { reason: "read", path: history },
  });
  if (error instanceof PermissionDenied) expect(exitCode(error)).toBe(6);
});

test("runs counts malformed history lines while retaining valid runs", async () => {
  const root = projectDir();
  const home = projectDir();
  writeProject(root, []);
  mkdirSync(join(root, ".stacks", "state"));
  writeFileSync(runsPath(root), `${JSON.stringify(runRecord())}\n{ malformed\n`);

  const result = await runHistory(root, home);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(decodeRuns(result.stdout)).toMatchObject({ verifyRuns: 1, skippedLines: 1 });
});
