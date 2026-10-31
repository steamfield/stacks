import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, FileSystem, PlatformError } from "effect";
import { afterEach, expect, test } from "vitest";
import { type ProjectState, replaceProjectState } from "../src/core/project-state";
import { openProject } from "../src/core/scaffold/write";
import { BadInput } from "../src/errors";
import { Invocation } from "../src/services/invocation";
import { quiet, runCli, tempDir, terminal } from "./helpers/cli";

const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});
function temp() {
  const dir = tempDir();
  dirs.push(dir);
  return realpathSync(dir.path);
}
const bytes = (text: string) => new TextEncoder().encode(text);
const failure = new BadInput({ details: { flag: "limit", value: "invalid" } });
const state: ProjectState = {
  schemaVersion: 1,
  projectId: "writer-rollback",
  manifestPath: "/unused/manifest.json",
  verifyDigest: "old-digest",
  stepDigests: {},
  settingsDigest: "old-settings",
  createdAt: "2026-10-31T00:00:00.000Z",
  firstGreenAt: null,
  firstTestPassAt: null,
};
const changedState: ProjectState = { ...state, verifyDigest: "new-digest" };

function rewriteThenFail(target: string, mutate: () => void, another = false) {
  return Effect.scoped(
    Effect.gen(function* () {
      const writer = yield* openProject(target);
      yield* writer.rewrite("locked/first.txt", bytes("changed first"));
      if (another) yield* writer.rewrite("locked/another.txt", bytes("changed another"));
      yield* writer.rewrite("second.txt", bytes("changed second"));
      yield* Effect.sync(mutate);
      return yield* failure;
    }),
  ).pipe(Effect.provide(NodeServices.layer));
}

// The first backup cannot be restored, but the later backup still can.
test.skipIf(process.getuid?.() === 0)(
  "a failed project restore reports its absolute path, keeps the primary error, and restores later files",
  async () => {
    const root = join(temp(), "ordered");
    mkdirSync(root);
    const locked = join(root, "locked");
    mkdirSync(locked);
    const first = join(locked, "first.txt");
    const another = join(locked, "another.txt");
    const second = join(root, "second.txt");
    writeFileSync(first, "original first");
    writeFileSync(another, "original another");
    writeFileSync(second, "original second");
    try {
      const result = await runCli(["--json"], {
        program: rewriteThenFail(root, () => chmodSync(locked, 0o555), true),
        env: quiet,
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: {
          tag: "BadInput",
          message: failure.message,
          details: { flag: "limit", value: "invalid" },
          rollback: { incomplete: [first, another] },
        },
      });
      expect(readFileSync(first, "utf8")).toBe("changed first");
      expect(readFileSync(another, "utf8")).toBe("changed another");
      expect(readFileSync(second, "utf8")).toBe("original second");
    } finally {
      chmodSync(locked, 0o755);
    }
  },
);

test.skipIf(process.getuid?.() === 0)(
  "agent and human errors name a failed restore before the final Next line",
  async () => {
    const root = temp();
    const locked = join(root, "locked");
    mkdirSync(locked);
    const first = join(locked, "first.txt");
    writeFileSync(first, "original first");
    writeFileSync(join(root, "second.txt"), "original second");
    try {
      for (const host of [{}, terminal]) {
        chmodSync(locked, 0o755);
        const result = await runCli([], {
          program: rewriteThenFail(root, () => chmodSync(locked, 0o555)),
          env: quiet,
          host,
        });
        expect(result.status).toBe(2);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(first);
        expect(result.stderr.trimEnd().split("\n").at(-1)).toMatch(/^\s*Next:/);
      }
    } finally {
      chmodSync(locked, 0o755);
    }
  },
);

test("a fully restored project leaves no rollback key in the error envelope", async () => {
  const root = temp();
  mkdirSync(join(root, "locked"));
  const first = join(root, "locked", "first.txt");
  const second = join(root, "second.txt");
  writeFileSync(first, "original first");
  writeFileSync(second, "original second");
  const result = await runCli(["--json"], {
    program: rewriteThenFail(root, () => {}),
    env: quiet,
  });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  const envelope = JSON.parse(result.stderr);
  expect(envelope.error.tag).toBe("BadInput");
  expect(envelope.error.details).toEqual({ flag: "limit", value: "invalid" });
  expect(envelope.error).not.toHaveProperty("rollback");
  expect(readFileSync(first, "utf8")).toBe("original first");
  expect(readFileSync(second, "utf8")).toBe("original second");
});

test.skipIf(process.getuid?.() === 0)(
  "a failed state-record restore reports the record path and keeps the primary error",
  async () => {
    const root = temp();
    const recordDir = join(root, "projects");
    mkdirSync(recordDir);
    const record = join(recordDir, "writer-rollback.json");
    writeFileSync(record, "original state bytes\n");
    try {
      const program = Effect.scoped(
        Effect.gen(function* () {
          yield* replaceProjectState(changedState, record);
          yield* Effect.sync(() => chmodSync(recordDir, 0o555));
          return yield* failure;
        }),
      ).pipe(Effect.provide(NodeServices.layer));
      const result = await runCli(["--json"], { program, env: quiet });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: {
          tag: "BadInput",
          message: failure.message,
          details: { flag: "limit", value: "invalid" },
          rollback: { incomplete: [record] },
        },
      });
      expect(readFileSync(record, "utf8")).toContain("new-digest");
    } finally {
      chmodSync(recordDir, 0o755);
    }
  },
);

test.skipIf(process.getuid?.() === 0)(
  "a newly created state record that cannot be removed is reported as incomplete rollback",
  async () => {
    const root = temp();
    const recordDir = join(root, "projects");
    mkdirSync(recordDir);
    const record = join(recordDir, "writer-rollback.json");
    try {
      const program = Effect.scoped(
        Effect.gen(function* () {
          yield* replaceProjectState(changedState, record);
          yield* Effect.sync(() => chmodSync(recordDir, 0o555));
          return yield* failure;
        }),
      ).pipe(Effect.provide(NodeServices.layer));
      const result = await runCli(["--json"], { program, env: quiet });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).error.rollback).toEqual({ incomplete: [record] });
      expect(readFileSync(record, "utf8")).toContain("new-digest");
    } finally {
      chmodSync(recordDir, 0o755);
    }
  },
);

test("state rollback replaces a planted symlink without changing its target", async () => {
  const root = temp();
  const record = join(root, "record.json");
  const outside = join(root, "outside.json");
  writeFileSync(record, "original state bytes\n");
  writeFileSync(outside, "outside stays\n");
  const program = Effect.scoped(
    Effect.gen(function* () {
      yield* replaceProjectState(changedState, record);
      yield* Effect.sync(() => {
        // The transaction saved its new record; another process replaces its directory entry.
        unlinkSync(record);
        symlinkSync(outside, record);
      });
      return yield* failure;
    }),
  ).pipe(Effect.provide(NodeServices.layer));
  const result = await runCli(["--json"], { program, env: quiet });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  const error = JSON.parse(result.stderr).error;
  expect(error.tag).toBe("BadInput");
  expect(error.details).toEqual({ flag: "limit", value: "invalid" });
  expect(error).not.toHaveProperty("rollback");
  expect(readFileSync(outside, "utf8")).toBe("outside stays\n");
  expect(lstatSync(record).isSymbolicLink()).toBe(false);
  expect(readFileSync(record, "utf8")).toBe("original state bytes\n");
});

test("schema error describes the optional rollback paths", async () => {
  const result = await runCli(["schema", "error", "--json"], { env: quiet });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  const schema = JSON.parse(result.stdout);
  expect(schema.properties.error.properties.rollback).toMatchObject({
    properties: { incomplete: { type: "array", items: { type: "string" } } },
  });
  expect(schema.properties.error.required).not.toContain("rollback");
});

test("a filesystem defect during exclusive create remains a Die cause", async () => {
  const root = temp();
  const target = join(root, "created.txt");
  const invocation = Invocation.make();
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const fault = FileSystem.make({
        ...fs,
        writeFile: (path, data, options) =>
          path === target
            ? Effect.die(new TypeError("injected exclusive write defect"))
            : fs.writeFile(path, data, options),
      });
      yield* Effect.scoped(
        Effect.flatMap(openProject(root), (writer) => writer.write("created.txt", bytes("new"))),
      ).pipe(Effect.provideService(FileSystem.FileSystem, fault));
    }).pipe(Effect.provide(invocation.layer), Effect.provide(NodeServices.layer)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(exit.cause.reasons.some(Cause.isDieReason)).toBe(true);
    expect(exit.cause.reasons.some(Cause.isFailReason)).toBe(false);
  }
});

test("an AlreadyExists failure combined with a defect keeps the Die cause", async () => {
  const root = temp();
  const target = join(root, "created.txt");
  const invocation = Invocation.make();
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const fault = FileSystem.make({
        ...fs,
        writeFile: (path, data, options) =>
          path === target
            ? Effect.failCause(
                Cause.combine(
                  Cause.fail(
                    PlatformError.systemError({
                      _tag: "AlreadyExists",
                      module: "FileSystem",
                      method: "writeFile",
                      pathOrDescriptor: path,
                    }),
                  ),
                  Cause.die(new TypeError("injected mixed cause")),
                ),
              )
            : fs.writeFile(path, data, options),
      });
      yield* Effect.scoped(
        Effect.flatMap(openProject(root), (writer) => writer.write("created.txt", bytes("new"))),
      ).pipe(Effect.provideService(FileSystem.FileSystem, fault));
    }).pipe(Effect.provide(invocation.layer), Effect.provide(NodeServices.layer)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) expect(exit.cause.reasons.some(Cause.isDieReason)).toBe(true);
});

test("an interrupted exclusive write remains an interrupt", async () => {
  const root = temp();
  const target = join(root, "created.txt");
  const invocation = Invocation.make();
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const fault = FileSystem.make({
        ...fs,
        writeFile: (path, data, options) =>
          path === target ? Effect.failCause(Cause.interrupt()) : fs.writeFile(path, data, options),
      });
      yield* Effect.scoped(
        Effect.flatMap(openProject(root), (writer) => writer.write("created.txt", bytes("new"))),
      ).pipe(Effect.provideService(FileSystem.FileSystem, fault));
    }).pipe(Effect.provide(invocation.layer), Effect.provide(NodeServices.layer)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
});

test("an existing exclusive-create target still yields TargetNotEmpty", async () => {
  const root = temp();
  writeFileSync(join(root, "created.txt"), "existing");
  const invocation = Invocation.make();
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      Effect.flatMap(openProject(root), (writer) => writer.write("created.txt", bytes("new"))),
    ).pipe(Effect.provide(invocation.layer), Effect.provide(NodeServices.layer)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit))
    expect(exit.cause.reasons.find(Cause.isFailReason)?.error).toMatchObject({
      _tag: "TargetNotEmpty",
    });
  expect(readFileSync(join(root, "created.txt"), "utf8")).toBe("existing");
});

test.skipIf(process.getuid?.() === 0)(
  "a read-only directory still yields PermissionDenied for exclusive create",
  async () => {
    const root = temp();
    chmodSync(root, 0o555);
    try {
      const invocation = Invocation.make();
      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.flatMap(openProject(root), (writer) => writer.write("created.txt", bytes("new"))),
        ).pipe(Effect.provide(invocation.layer), Effect.provide(NodeServices.layer)),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit))
        expect(exit.cause.reasons.find(Cause.isFailReason)?.error).toMatchObject({
          _tag: "PermissionDenied",
          details: { reason: "unwritable", path: join(root, "created.txt") },
        });
    } finally {
      chmodSync(root, 0o755);
    }
  },
);
