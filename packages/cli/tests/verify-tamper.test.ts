import {
  chmodSync,
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Manifest } from "@steamfield/stacks-format";
import { Deferred, Effect, Fiber, FileSystem, Schema } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import { AgentMarkers } from "../src/config";
import { digestStep, digestSteps, MANIFEST_PATH, readManifest } from "../src/core/manifest";
import { ProjectState, projectStateFor } from "../src/core/project-state";
import { acceptChanges, checkTamper } from "../src/core/verify/tamper";
import { runWith, succeed } from "./helpers/state";
import {
  decodeResult,
  envelope,
  manifest,
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

const has = (root: string, file: string) => existsSync(join(root, file));
const asRoot = process.getuid?.() === 0;
const CHANGED =
  "the verify steps changed since they were recorded. Don't edit them back; ask the user to run stacks verify --accept-changes from their own terminal, or to undo the change.";
const NEXT_CHANGED = `Next: ${CHANGED}`;

/** A recorded project (manifest plus state record), its home and the steps it was recorded with. */
function recorded(steps: StepInput[], overrides: Partial<Manifest> = {}) {
  const home = space.dir();
  const root = space.dir();
  const written = writeRecordedProject(root, home, steps, overrides);
  return { home, root, manifest: written, env: stateEnv(home) };
}

const BASE: StepInput[] = [
  { name: "install", phase: "setup", run: "touch installed" },
  { name: "lint", run: "touch linted", layer: "lint" },
  { name: "unit", run: "touch tested", layer: "test" },
];

/** Asserts a `VerifyChanged` exit: status 5, the changed result on stdout, the envelope last. */
function expectChanged(
  result: { status: number; stdout: string; stderr: string },
  change: Record<string, unknown>,
) {
  expect(result.status).toBe(5);
  const decoded = decodeResult(result.stdout);
  expect(decoded.outcome).toBe("changed");
  expect(decoded.changed).toMatchObject(change);
  expect(decoded.steps.every((step) => step.status === "skipped")).toBe(true);
  expect(envelope(result.stderr)).toEqual({
    error: {
      tag: "VerifyChanged",
      message: "Verify steps changed since they were recorded.",
      retryable: false,
      next: CHANGED,
      details: decoded.changed,
    },
  });
  return decoded;
}

describe("the tamper check", () => {
  test("a recorded, unchanged project runs with tamperCheck full", async () => {
    const { root, env } = recorded(BASE);
    const result = await verify(["--json"], { cwd: root, env });
    expect(splitEvents(result.stderr).rest).toBe("");
    expect(startedSteps(result.stderr)).toEqual(["install", "lint", "unit"]);
    expect(result.status).toBe(0);
    const decoded = decodeResult(result.stdout);
    expect(decoded).toMatchObject({ outcome: "green", tamperCheck: "full", stateRecord: true });
    expect(decoded.changed).toBeUndefined();
  });

  test("editing one step's run fails VerifyChanged naming that step, running nothing [1.3b#2]", async () => {
    const { root, env, manifest: before } = recorded(BASE);
    writeProject(
      root,
      BASE.map((step) => (step.name === "lint" ? { ...step, run: "true" } : step)),
      { verifyDigest: before.verifyDigest },
    );
    const result = await verify(["--json"], { cwd: root, env });
    expectChanged(result, {
      against: "manifest",
      reason: "digest",
      removed: [],
      added: [],
      edited: ["lint"],
      settings: false,
    });
    expect(has(root, "installed")).toBe(false);
    expect(has(root, "linted")).toBe(false);
    const records = runRecords(root);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ outcome: "changed", acceptedChanges: false });
  });

  test("editing the step and the stored digest together fails against the state record [1.3b#3]", async () => {
    const { root, env } = recorded(BASE);
    writeProject(
      root,
      BASE.map((step) => (step.name === "unit" ? { ...step, run: "true" } : step)),
    );
    const result = await verify(["--json"], { cwd: root, env });
    expectChanged(result, {
      against: "state-record",
      reason: "digest",
      edited: ["unit"],
      added: [],
      removed: [],
    });
    expect(has(root, "tested")).toBe(false);
  });

  test("an added and a removed step are listed by name", async () => {
    const { root, env } = recorded(BASE);
    writeProject(root, [
      ...BASE.filter((step) => step.name !== "unit"),
      { name: "e2e", run: "true" },
    ]);
    const result = await verify(["--json"], { cwd: root, env });
    expectChanged(result, { removed: ["unit"], added: ["e2e"], edited: [], settings: false });
  });

  test("the human result says changed, lists every step as skipped and ends with the changed Next line", async () => {
    const { root, env } = recorded(BASE);
    writeProject(
      root,
      BASE.map((step) => (step.name === "lint" ? { ...step, run: "true" } : step)),
    );
    const result = await verify([], { cwd: root, env });
    expect(result.status).toBe(5);
    expect(result.stdout).toMatch(/^verify: changed /);
    expect(result.stdout.trimEnd().endsWith(NEXT_CHANGED)).toBe(true);
    expect(result.stderr).toContain("Verify steps changed since they were recorded.");
    expect(result.stderr).toContain("Edited: lint");
  });

  const URL = `http://localhost:$${"{"}PORT_WEB}/`;
  const WEB: StepInput = {
    name: "web",
    phase: "serve",
    run: "node server.cjs",
    expect: { http: URL, within: "5s" },
    tags: ["app"],
    timeout: "1m",
  };
  const edits: Array<[string, StepInput[], Partial<Manifest>, Record<string, unknown>]> = [
    ["timeout", [{ ...WEB, timeout: "2m" }], {}, { edited: ["web"] }],
    ["skipByDefault", [{ ...WEB, skipByDefault: true }], {}, { edited: ["web"] }],
    ["tags (the app tag removed)", [{ ...WEB, tags: [] }], {}, { edited: ["web"] }],
    [
      "expect.http",
      [{ ...WEB, expect: { http: "http://localhost:9/", within: "5s" } }],
      {},
      { edited: ["web"] },
    ],
    ["expect.within", [{ ...WEB, expect: { http: URL, within: "1s" } }], {}, { edited: ["web"] }],
    ["the manifest env", [WEB], { env: { PORT_WEB: "1" } }, { edited: [], settings: true }],
    ["preset", [WEB], { preset: "sandbox" }, { edited: [], settings: true }],
  ];
  test.each(edits)(
    "editing %s fails VerifyChanged [1.3b#4]",
    async (_what, steps, overrides, change) => {
      const { root, env } = recorded([WEB], { env: { PORT_WEB: "4999" } });
      writeProject(root, steps, { env: { PORT_WEB: "4999" }, ...overrides });
      const result = await verify(["--json"], { cwd: root, env });
      expectChanged(result, { against: "state-record", reason: "digest", ...change });
    },
  );

  test("an owner change alone is not a change", async () => {
    const { root, env } = recorded(BASE);
    writeProject(
      root,
      BASE.map((step) => ({ ...step, owner: "another-entry" })),
    );
    const result = await verify(["--json"], { cwd: root, env });
    expect(result.status).toBe(0);
    expect(decodeResult(result.stdout).tamperCheck).toBe("full");
  });

  test("with the state record deleted, the run is manifest-only, green, and writes no record [1.3b#5]", async () => {
    const { root, env, home, manifest: written } = recorded(BASE);
    rmSync(recordPath(home, written.projectId));
    const result = await verify(["--json"], { cwd: root, env });
    expect(splitEvents(result.stderr).rest).toBe("");
    expect(startedSteps(result.stderr)).toEqual(["install", "lint", "unit"]);
    expect(result.status).toBe(0);
    expect(decodeResult(result.stdout)).toMatchObject({
      outcome: "green",
      tamperCheck: "manifest-only",
      firstGreen: false,
      stateRecord: false,
    });
    expect(existsSync(recordPath(home, written.projectId))).toBe(false);
    expect(runRecords(root)[0]).toMatchObject({ outcome: "green", tamperCheck: "manifest-only" });
  });

  test("a manifest-only project still fails VerifyChanged on its own digest, with nothing itemized", async () => {
    const root = space.dir();
    writeProject(root, BASE, {
      verifyDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    });
    const result = await verify(["--json"], { cwd: root, env: stateEnv(space.dir()) });
    const decoded = expectChanged(result, {
      against: "manifest",
      reason: "digest",
      removed: [],
      added: [],
      edited: [],
      settings: false,
    });
    expect(decoded.tamperCheck).toBe("manifest-only");
    const human = await verify([], { cwd: root, env: stateEnv(space.dir()) });
    expect(human.stderr).toContain("not itemized");
  });

  test("a changed projectId whose old record is found by path fails with reason project-id [1.3b#6]", async () => {
    const { root, env } = recorded(BASE);
    writeProject(root, BASE, { projectId: "11111111-2222-4333-8444-555555555555" });
    const result = await verify(["--json"], { cwd: root, env });
    expectChanged(result, { against: "state-record", reason: "project-id" });
    expect(has(root, "installed")).toBe(false);
  });

  test("the by-path lookup matches the real path, through a symlinked project directory", async () => {
    const { root, env } = recorded(BASE);
    writeProject(root, BASE, { projectId: "11111111-2222-4333-8444-555555555555" });
    const link = join(space.dir(), "linked");
    symlinkSync(root, link);
    const result = await verify(["--json"], { cwd: link, env });
    expectChanged(result, { reason: "project-id" });
  });

  test("a state record with schemaVersion 2 fails exit 3 naming the record [1.3b#7]", async () => {
    const { root, env, home, manifest: written } = recorded(BASE);
    const file = recordPath(home, written.projectId);
    writeFileSync(
      file,
      JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), schemaVersion: 2 }),
    );
    const result = await verify(["--json"], { cwd: root, env });
    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    expect(envelope(result.stderr)).toMatchObject({
      error: { tag: "InvalidConfig", details: { path: file, schemaVersion: 2 } },
    });
    expect(has(root, "installed")).toBe(false);
    expect(runRecords(root)).toEqual([]);
  });

  test("a state record that isn't JSON is treated as missing [1.3b#7]", async () => {
    const { root, env, home, manifest: written } = recorded(BASE);
    writeFileSync(recordPath(home, written.projectId), "{not json");
    const result = await verify(["--json"], { cwd: root, env });
    expect(result.status).toBe(0);
    expect(decodeResult(result.stdout).tamperCheck).toBe("manifest-only");
  });
});

describe("--accept-changes", () => {
  /** A recorded project whose lint step was then edited, with the bytes of both files. */
  function edited() {
    const project = recorded(BASE);
    const file = recordPath(project.home, project.manifest.projectId);
    const record = readRecord(file);
    writeFileSync(
      file,
      `${JSON.stringify(
        Schema.encodeSync(ProjectState)({
          ...record,
          firstGreenAt: "2026-10-26T09:05:00.000Z",
          firstTestPassAt: "2026-10-26T09:04:00.000Z",
        }),
        null,
        2,
      )}\n`,
    );
    const steps = BASE.map((step) =>
      step.name === "lint" ? { ...step, run: "touch linted-again" } : step,
    );
    writeProject(project.root, steps);
    return {
      ...project,
      file,
      steps,
      bytes: () => [
        readFileSync(join(project.root, MANIFEST_PATH), "utf8"),
        readFileSync(file, "utf8"),
      ],
    };
  }
  const tty = { stdinIsTTY: true, stdoutIsTTY: true };

  const markers = AgentMarkers.map((item) => [
    item.name,
    item.equals ?? (item.agent === "by-value" ? "foo" : "1"),
  ]);
  test.each(markers)(
    "refuses under the agent marker %s with reason agent, changing nothing [1.3b#8]",
    async (name, value) => {
      const project = edited();
      const before = project.bytes();
      const result = await verify(["--accept-changes", "--json"], {
        cwd: project.root,
        env: { ...project.env, [name]: value },
        host: tty,
      });
      expect(result.status).toBe(6);
      expect(result.stdout).toBe("");
      expect(envelope(result.stderr)).toEqual({
        error: {
          tag: "PermissionDenied",
          message: "Permission denied.",
          retryable: false,
          next: "ask the user to run this command from their own terminal.",
          details: { reason: "agent" },
        },
      });
      expect(project.bytes()).toEqual(before);
      expect(has(project.root, "installed")).toBe(false);
    },
  );

  test("refuses without a TTY on stdin with reason no-tty, changing nothing [1.3b#8]", async () => {
    const project = edited();
    const before = project.bytes();
    const result = await verify(["--accept-changes", "--json"], {
      cwd: project.root,
      env: project.env,
      host: { stdinIsTTY: false, stdoutIsTTY: true },
    });
    expect(result.status).toBe(6);
    expect(envelope(result.stderr)).toMatchObject({
      error: { tag: "PermissionDenied", details: { reason: "no-tty" } },
    });
    expect(project.bytes()).toEqual(before);
  });

  test("from a TTY with no agent: prints the diff, rewrites both digests, keeps the timing, runs the steps [1.3b#9]", async () => {
    const project = edited();
    const result = await verify(["--accept-changes"], {
      cwd: project.root,
      env: project.env,
      host: tty,
    });
    expect(result.status).toBe(0);
    // The accepted change is part of the report, so it reaches every text audience.
    expect(result.stdout).toMatch(/^verify: green .*\nAccepted the changed verify steps:\n/);
    expect(result.stdout).toContain("\n  Edited: lint\n");
    expect(result.stderr).not.toContain("Edited: lint");
    expect(has(project.root, "linted-again")).toBe(true);
    const written = readManifestAt(project.root);
    expect(written.verifyDigest).toBe(digestSteps(written));
    const record = readRecord(project.file);
    expect(record.verifyDigest).toBe(written.verifyDigest);
    expect(record.stepDigests.lint).toBe(
      digestStep(written.verify.find((step) => step.name === "lint") as Manifest["verify"][number]),
    );
    expect(record).toMatchObject({
      createdAt: project.manifest.createdAt,
      firstGreenAt: "2026-10-26T09:05:00.000Z",
      firstTestPassAt: "2026-10-26T09:04:00.000Z",
    });
    expect(runRecords(project.root).at(-1)).toMatchObject({
      acceptedChanges: true,
      outcome: "green",
      tamperCheck: "full",
    });
    const next = await verify(["--json"], { cwd: project.root, env: project.env });
    expect(next.status).toBe(0);
    expect(decodeResult(next.stdout)).toMatchObject({
      outcome: "green",
      tamperCheck: "full",
      firstGreen: false,
    });
    expect(runRecords(project.root).at(-1)?.acceptedChanges).toBe(false);
  });

  test("--json from a TTY carries the accepted change in the result and keeps stderr empty", async () => {
    const project = edited();
    const result = await verify(["--accept-changes", "--json"], {
      cwd: project.root,
      env: project.env,
      host: tty,
    });
    expect(splitEvents(result.stderr).rest).toBe("");
    expect(startedSteps(result.stderr)).toEqual(["install", "lint", "unit"]);
    expect(result.status).toBe(0);
    expect(decodeResult(result.stdout)).toMatchObject({
      outcome: "green",
      tamperCheck: "full",
      changed: { against: "state-record", edited: ["lint"] },
    });
  });

  test("on a fresh clone with no record, accepting creates the record so the next run is full", async () => {
    const home = space.dir();
    const root = space.dir();
    writeProject(root, BASE);
    const env = stateEnv(home);
    const result = await verify(["--accept-changes", "--json"], { cwd: root, env, host: tty });
    expect(result.status).toBe(0);
    expect(decodeResult(result.stdout)).toMatchObject({ tamperCheck: "full", stateRecord: true });
    const written = manifest(BASE);
    const record = readRecord(recordPath(home, written.projectId));
    expect(record).toEqual({
      ...projectStateFor(written, realpathSync(join(root, MANIFEST_PATH))),
      firstGreenAt: record.firstGreenAt,
      firstTestPassAt: record.firstTestPassAt,
    });
    expect(record.firstGreenAt).not.toBeNull();
    const next = await verify(["--json"], { cwd: root, env });
    expect(decodeResult(next.stdout).tamperCheck).toBe("full");
  });

  test("accepting a changed projectId moves the record to the new id and removes the old one", async () => {
    const { root, env, home, manifest: before } = recorded(BASE);
    const id = "11111111-2222-4333-8444-555555555555";
    writeProject(root, BASE, { projectId: id });
    const result = await verify(["--accept-changes", "--json"], { cwd: root, env, host: tty });
    expect(result.status).toBe(0);
    expect(existsSync(recordPath(home, before.projectId))).toBe(false);
    expect(readRecord(recordPath(home, id)).projectId).toBe(id);
    const next = await verify(["--json"], { cwd: root, env });
    expect(decodeResult(next.stdout).tamperCheck).toBe("full");
  });

  test("an unwritable state directory fails PermissionDenied state-unwritable and leaves the manifest as it was", async () => {
    const project = edited();
    const notDir = join(project.home, "a-file");
    writeFileSync(notDir, "");
    const before = readFileSync(join(project.root, MANIFEST_PATH), "utf8");
    const result = await verify(["--accept-changes", "--json"], {
      cwd: project.root,
      env: { XDG_STATE_HOME: notDir },
      host: tty,
    });
    expect(result.status).toBe(6);
    expect(envelope(result.stderr)).toMatchObject({
      error: {
        tag: "PermissionDenied",
        details: {
          reason: "state-unwritable",
          path: join(notDir, "stacks", "projects", `${project.manifest.projectId}.json`),
        },
      },
    });
    expect(readFileSync(join(project.root, MANIFEST_PATH), "utf8")).toBe(before);
    expect(has(project.root, "installed")).toBe(false);
  });

  test.skipIf(asRoot)(
    "an unwritable manifest fails PermissionDenied and leaves the state record as it was",
    async () => {
      const project = edited();
      // The manifest still holds the old digest, so accepting has to rewrite it.
      writeProject(project.root, project.steps, { verifyDigest: project.manifest.verifyDigest });
      const before = readFileSync(project.file, "utf8");
      const manifestFile = join(project.root, MANIFEST_PATH);
      chmodSync(manifestFile, 0o400);
      chmodSync(join(project.root, ".stacks"), 0o500);
      try {
        const result = await verify(["--accept-changes", "--json"], {
          cwd: project.root,
          env: project.env,
          host: tty,
        });
        expect(result.status).toBe(6);
        expect(envelope(result.stderr)).toMatchObject({ error: { tag: "PermissionDenied" } });
        expect(readFileSync(project.file, "utf8")).toBe(before);
      } finally {
        chmodSync(join(project.root, ".stacks"), 0o700);
        chmodSync(manifestFile, 0o600);
      }
    },
  );

  test("an interrupt while the manifest is being written still leaves both copies agreeing", async () => {
    const project = recorded(BASE);
    const file = recordPath(project.home, project.manifest.projectId);
    const steps = BASE.map((step) =>
      step.name === "lint" ? { ...step, run: "touch linted-again" } : step,
    );
    // The old digest stays in the manifest, so accepting has to rewrite it after the record.
    const path = writeProject(project.root, steps, { verifyDigest: project.manifest.verifyDigest });
    const program = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const reached = yield* Deferred.make<void>();
      // The real filesystem, with the manifest replacement held long enough to interrupt during it.
      const held: FileSystem.FileSystem = {
        ...fs,
        rename: (source, target) =>
          target === realpathSync(path)
            ? Deferred.succeed(reached, undefined).pipe(
                Effect.andThen(Effect.sleep("100 millis")),
                Effect.andThen(fs.rename(source, target)),
              )
            : fs.rename(source, target),
      };
      const manifest = yield* readManifest(path);
      const tamper = yield* checkTamper(manifest, path);
      const fiber = yield* acceptChanges(manifest, path, tamper).pipe(
        Effect.provideService(FileSystem.FileSystem, held),
        Effect.forkChild,
      );
      yield* Deferred.await(reached);
      yield* Fiber.interrupt(fiber);
    });
    await succeed(runWith(program, project.env));
    const accepted = digestSteps(manifest(steps));
    expect(readRecord(file).verifyDigest).toBe(accepted);
    expect(readManifestAt(project.root).verifyDigest).toBe(accepted);
  });
});

describe("a hand-edited manifest", () => {
  test("two steps with one name are InvalidConfig, and nothing runs", async () => {
    const { root, env } = recorded([{ name: "lint", run: "true" }]);
    // Written as plain JSON: encoding through `Manifest` refuses the duplicate.
    const edited = manifest([
      { name: "lint", run: "touch first" },
      { name: "lint", run: "touch second" },
    ]);
    writeFileSync(join(root, MANIFEST_PATH), JSON.stringify(edited));
    const result = await verify(["--json"], { cwd: root, env });
    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    expect(envelope(result.stderr)).toMatchObject({
      error: { tag: "InvalidConfig", details: { path: join(root, MANIFEST_PATH) } },
    });
    expect(has(root, "first") || has(root, "second")).toBe(false);
    expect(runRecords(root)).toEqual([]);
  });
});
