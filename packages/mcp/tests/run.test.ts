import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";
import { CliRunner } from "../src/run";
import { digest, fakeCli, fixture, outputCli, runnerLayer, tempDir } from "./helpers/cli";

it.effect(
  "a CLI writing 512 KiB to stderr before stdout drains both streams within five seconds",
  () =>
    Effect.gen(function* () {
      const root = tempDir();
      const stdout = fixture("list.json");
      const entry = fakeCli(
        root,
        `process.stderr.write("x".repeat(512 * 1024), () => process.stdout.write(${JSON.stringify(stdout)}));`,
      );
      const output = yield* Effect.gen(function* () {
        return yield* (yield* CliRunner).run(["list", "--json"]);
      }).pipe(Effect.provide(runnerLayer(entry)));
      expect(output.exit).toBe(0);
      expect(digest(output.stdout)).toBe(digest(stdout));
      expect(digest(output.stderr)).toBe(digest("x".repeat(512 * 1024)));
    }),
  5_000,
);

it.effect(
  "the runner uses the configured Node, exact arguments and environment without extending it",
  () =>
    Effect.gen(function* () {
      const root = tempDir();
      const record = join(root, "record.json");
      const entry = outputCli(root, { stdout: "raw output", record });
      const env = { ONLY_CAPTURED: "yes", PATH: "" };
      const output = yield* Effect.gen(function* () {
        return yield* (yield* CliRunner).run(["guide", "literal argument"]);
      }).pipe(Effect.provide(runnerLayer(entry, { env })));
      expect(output).toEqual({ exit: 0, stdout: "raw output", stderr: "" });
      expect(JSON.parse(readFileSync(record, "utf8"))).toMatchObject({
        args: ["guide", "literal argument"],
        env,
        node: process.execPath,
        bun: null,
      });
      // macOS adds __CF_USER_TEXT_ENCODING to every child's environment, even an explicit one.
      const { __CF_USER_TEXT_ENCODING: _, ...childEnv } = JSON.parse(
        readFileSync(record, "utf8"),
      ).env;
      expect(childEnv).toEqual(env);
    }),
);

it.effect("the CLI receives EOF on stdin without waiting for input", () =>
  Effect.gen(function* () {
    const entry = fakeCli(
      tempDir(),
      `import { fstatSync, readSync } from "node:fs"; const characterDevice = fstatSync(0).isCharacterDevice(); const bytes = readSync(0, Buffer.alloc(1), 0, 1, null); process.stdout.write(JSON.stringify({ characterDevice, bytes }));`,
    );
    const output = yield* Effect.gen(function* () {
      return yield* (yield* CliRunner).run([]);
    }).pipe(Effect.provide(runnerLayer(entry)));
    expect(output.exit).toBe(0);
    expect(output.stderr).toBe("");
    expect(JSON.parse(output.stdout)).toEqual({ characterDevice: true, bytes: 0 });
  }),
);

it.effect("stderr callbacks receive complete lines across chunks before the CLI finishes", () =>
  Effect.gen(function* () {
    const root = tempDir();
    const release = join(root, "release");
    const continueFile = join(root, "continue");
    const lines: string[] = [];
    const entry = fakeCli(
      root,
      `
import { existsSync } from "node:fs";
process.stderr.write(${JSON.stringify("first\nsec")});
const first = setInterval(() => {
  if (!existsSync(${JSON.stringify(continueFile)})) return;
  clearInterval(first);
  process.stderr.write(${JSON.stringify("ond\n")});
  const last = setInterval(() => { if (existsSync(${JSON.stringify(release)})) { clearInterval(last); process.stdout.write("done"); } }, 5);
}, 5);`,
    );
    const fiber = yield* Effect.gen(function* () {
      return yield* (yield* CliRunner).run([], {
        onStderrLine: (line: string) =>
          Effect.sync(() => {
            lines.push(line);
          }),
      });
    }).pipe(Effect.provide(runnerLayer(entry)), Effect.forkChild);
    yield* Effect.promise(() =>
      vi.waitFor(() => expect(lines).toEqual(["first"]), { timeout: 2000 }),
    );
    writeFileSync(continueFile, "");
    yield* Effect.promise(() =>
      vi.waitFor(() => expect(lines).toEqual(["first", "second"]), { timeout: 2000 }),
    );
    writeFileSync(release, "");
    expect(yield* Fiber.join(fiber)).toEqual({
      exit: 0,
      stdout: "done",
      stderr: "first\nsecond\n",
    });
  }),
);

it.effect("a nonexistent CLI entry fails without running the recording fake", () =>
  Effect.gen(function* () {
    const root = tempDir();
    const record = join(root, "record.json");
    outputCli(root, { record });
    const output = yield* Effect.gen(function* () {
      return yield* (yield* CliRunner).run([]);
    }).pipe(Effect.provide(runnerLayer(join(root, "missing.mjs"))));
    // Node itself starts: a missing JS entry is a nonzero CLI result, not a spawn failure.
    expect(output.exit).not.toBe(0);
    expect(output.stdout).toBe("");
    expect(output.stderr).toContain("MODULE_NOT_FOUND");
    expect(existsSync(record)).toBe(false);
  }),
);

it.effect("an unspawnable Node path returns CliUnavailable with the system code and command", () =>
  Effect.gen(function* () {
    const root = tempDir();
    const node = join(root, "missing-node");
    const entry = fakeCli(root, "");
    const error = yield* Effect.gen(function* () {
      return yield* Effect.flip((yield* CliRunner).run([]));
    }).pipe(Effect.provide(runnerLayer(entry, { node })));
    expect(error.tag).toBe("CliUnavailable");
    expect(error.cliMessage).toContain("ENOENT");
    expect(error.cliMessage).toContain(node);
    expect(error.retryable).toBe(false);
    expect(error.exitCode).toBeUndefined();
    expect(error.next).toContain("STACKS_MCP_CLI");
  }),
);

it.effect("a timed out CLI is killed after it has written its PID", () =>
  Effect.gen(function* () {
    const root = tempDir();
    const pidFile = join(root, "pid");
    const entry = fakeCli(
      root,
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`,
    );
    const fiber = yield* Effect.gen(function* () {
      return yield* Effect.flip((yield* CliRunner).run([]));
    }).pipe(Effect.provide(runnerLayer(entry, { timeout: Duration.seconds(2) })), Effect.forkChild);
    yield* Effect.promise(() =>
      vi.waitFor(() => expect(existsSync(pidFile)).toBe(true), { timeout: 2000 }),
    );
    const pid = Number(readFileSync(pidFile, "utf8"));
    yield* TestClock.adjust("2 seconds");
    const error = yield* Fiber.join(fiber);
    expect(error.tag).toBe("CliTimedOut");
    expect(error.retryable).toBe(false);
    expect(error.exitCode).toBeUndefined();
    expect(error.next).toContain("STACKS_MCP_TIMEOUT_SECONDS");
    yield* Effect.promise(() =>
      vi.waitFor(
        () => {
          expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
        },
        { timeout: 2000 },
      ),
    );
  }),
);
