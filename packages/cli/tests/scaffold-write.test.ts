import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit } from "effect";
import { afterEach, expect, test } from "vitest";
import { openProject, type ProjectWriter } from "../src/core/project/writer";
import { tempDir } from "./helpers/cli";

const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});
const temp = () => {
  const dir = tempDir();
  dirs.push(dir);
  return dir.path;
};
const bytes = (text: string) => new TextEncoder().encode(text);

/** Opens `dir` with the real writer and runs `use` in its scope, as `new` does. */
function run<E>(dir: string, use: (writer: ProjectWriter) => Effect.Effect<void, E>) {
  return Effect.runPromiseExit(
    Effect.scoped(Effect.flatMap(openProject(dir), use)).pipe(Effect.provide(NodeServices.layer)),
  );
}
const failure = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? exit.cause.reasons.find(Cause.isFailReason)?.error : undefined;

test("a planned path with .. or an absolute path is an escape, and nothing lands outside [1.2a#4]", async () => {
  const parent = temp();
  const target = join(parent, "app");
  for (const rel of ["../outside.txt", "a/../../outside.txt", "/tmp/outside.txt", "a//b"]) {
    const exit = await run(target, (writer) => writer.write(rel, bytes("x")));
    expect(failure(exit)).toMatchObject({
      _tag: "PermissionDenied",
      details: { reason: "escape", path: rel },
    });
    // The target was created for this run, so the rollback removed it too.
    expect(readdirSync(parent)).toEqual([]);
  }
});

test("a directory on the way that is a symlink out of the project is an escape", async () => {
  const parent = temp();
  const outside = join(parent, "outside");
  mkdirSync(outside);
  const target = join(parent, "app");
  mkdirSync(target);
  symlinkSync(outside, join(target, "linked"));
  const exit = await run(target, (writer) => writer.write("linked/evil.txt", bytes("x")));
  expect(failure(exit)).toMatchObject({
    _tag: "PermissionDenied",
    details: { reason: "escape", path: join(realpathSync(target), "linked/evil.txt") },
  });
  expect(readdirSync(outside)).toEqual([]);
  expect(readdirSync(target)).toEqual(["linked"]);
});

test("a symlinked directory on the way out of the project is refused before anything is made through it", async () => {
  const parent = temp();
  const outside = join(parent, "outside");
  mkdirSync(outside);
  const target = join(parent, "app");
  mkdirSync(target);
  symlinkSync(outside, join(target, "linked"));
  for (const rel of ["linked/sub/evil.txt", "linked/sub/deeper/evil.txt"]) {
    const exit = await run(target, (writer) => writer.write(rel, bytes("x")));
    expect(failure(exit)).toMatchObject({
      _tag: "PermissionDenied",
      details: { reason: "escape", path: join(realpathSync(target), rel) },
    });
    expect(readdirSync(outside)).toEqual([]);
  }
  const exit = await run(target, (writer) => writer.directory("linked/made"));
  expect(failure(exit)).toMatchObject({ _tag: "PermissionDenied", details: { reason: "escape" } });
  expect(readdirSync(outside)).toEqual([]);
  expect(readdirSync(target)).toEqual(["linked"]);
});

test("rollback leaves a directory alone once its parent resolves outside the project", async () => {
  const parent = temp();
  const outside = join(parent, "outside");
  mkdirSync(join(outside, "b"), { recursive: true });
  const target = join(parent, "app");
  mkdirSync(target);
  const exit = await run(target, (writer) =>
    Effect.gen(function* () {
      yield* writer.write("a/b/f.txt", bytes("1"));
      // Another process swaps `a` for a link out of the project before the rollback runs.
      yield* Effect.sync(() => {
        renameSync(join(target, "a"), join(target, "moved"));
        symlinkSync(outside, join(target, "a"));
      });
      return yield* Effect.fail("later failure");
    }),
  );
  expect(failure(exit)).toBe("later failure");
  expect(readdirSync(outside)).toEqual(["b"]);
  expect(readdirSync(join(target, "moved", "b"))).toEqual(["f.txt"]);
});

test("a final-segment symlink is never written through", async () => {
  const parent = temp();
  const outside = join(parent, "outside.txt");
  const target = join(parent, "app");
  mkdirSync(target);
  symlinkSync(outside, join(target, "file.txt"));
  const exit = await run(target, (writer) => writer.write("file.txt", bytes("x")));
  expect(failure(exit)).toMatchObject({ _tag: "TargetNotEmpty" });
  expect(existsSync(outside)).toBe(false);
});

test("a target reached through a symlinked parent writes normally [1.2a#4]", async () => {
  const parent = temp();
  mkdirSync(join(parent, "real"));
  symlinkSync(join(parent, "real"), join(parent, "link"));
  const exit = await run(join(parent, "link", "app"), (writer) =>
    writer.write("src/main.ts", bytes("ok\n")),
  );
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(readFileSync(join(parent, "real", "app", "src", "main.ts"), "utf8")).toBe("ok\n");
});

test("only the executable bit is taken: an executable file gains x where it has r", async () => {
  const target = join(temp(), "app");
  const exit = await run(target, (writer) =>
    Effect.andThen(
      writer.write("hook", bytes("#!/bin/sh\n"), true),
      writer.write("plain", bytes("x"), false),
    ),
  );
  expect(Exit.isSuccess(exit)).toBe(true);
  const hook = statSync(join(target, "hook")).mode & 0o777;
  expect(hook & 0o111).not.toBe(0);
  expect(hook & 0o111).toBe((hook & 0o444) >> 2);
  expect(statSync(join(target, "plain")).mode & 0o111).toBe(0);
});

test.skipIf(process.getuid?.() === 0)(
  "a failed write rolls back every earlier write and the directories it made, keeping what was there [1.2a#6]",
  async () => {
    const target = temp();
    mkdirSync(join(target, "locked"));
    chmodSync(join(target, "locked"), 0o555);
    try {
      const exit = await run(target, (writer) =>
        Effect.gen(function* () {
          yield* writer.write("a/b/first.txt", bytes("1"));
          yield* writer.write("second.txt", bytes("2"));
          yield* writer.write("locked/third.txt", bytes("3"));
        }),
      );
      expect(failure(exit)).toMatchObject({
        _tag: "PermissionDenied",
        details: { reason: "unwritable", path: join(realpathSync(target), "locked/third.txt") },
      });
      expect(readdirSync(target)).toEqual(["locked"]);
      expect(readdirSync(join(target, "locked"))).toEqual([]);
    } finally {
      chmodSync(join(target, "locked"), 0o755);
    }
  },
);

test("an interrupt after the first write rolls it back [1.2a#7]", async () => {
  const parent = temp();
  const target = join(parent, "app");
  const controller = new AbortController();
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const writer = yield* openProject(target);
        yield* writer.write("first.txt", bytes("1"));
        controller.abort();
        yield* Effect.never;
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
    { signal: controller.signal },
  );
  expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
  expect(readdirSync(parent)).toEqual([]);
});

test("replace rewrites only a file this writer created", async () => {
  const target = join(temp(), "app");
  const exit = await run(target, (writer) =>
    Effect.gen(function* () {
      yield* writer.write("brief.md", bytes("old"));
      yield* writer.replace("brief.md", bytes("new"));
      return yield* writer.replace("other.md", bytes("x"));
    }),
  );
  expect(failure(exit)).toMatchObject({ _tag: "PermissionDenied", details: { reason: "escape" } });
  // The failure rolled back the whole project.
  expect(existsSync(target)).toBe(false);
});

test("an interrupt after rewriting a parked file restores its bytes and mode and removes new files [3.0#7]", async () => {
  const target = temp();
  const parked = join(target, ".stacks/incoming/.claude/settings.json");
  mkdirSync(join(target, ".stacks/incoming/.claude"), { recursive: true });
  writeFileSync(parked, '{"keep":true}\n', { mode: 0o640 });
  const controller = new AbortController();
  let rewritten: string | undefined;
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const writer = yield* openProject(target);
        yield* writer.write("a-created.txt", bytes("new"));
        yield* writer.rewrite(".stacks/incoming/.claude/settings.json", bytes('{"merged":1}'));
        rewritten = readFileSync(parked, "utf8");
        controller.abort();
        yield* Effect.never;
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
    { signal: controller.signal },
  );
  expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
  expect(rewritten).toBe('{"merged":1}');
  expect(readFileSync(parked, "utf8")).toBe('{"keep":true}\n');
  expect(statSync(parked).mode & 0o777).toBe(0o640);
  expect(existsSync(join(target, "a-created.txt"))).toBe(false);
  expect(readdirSync(join(target, ".stacks/incoming/.claude"))).toEqual(["settings.json"]);
});
