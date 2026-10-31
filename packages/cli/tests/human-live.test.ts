import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, expect, test } from "vitest";
import { AppConfig } from "../src/config";
import { Host } from "../src/services/host";
import { Output, type Writer } from "../src/services/output";
import { quiet, runCli, terminal, writeError } from "./helpers/cli";
import { workspace, writeProject } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());
const ESC = "\u001b";
const clearLine = `(?:\\r${ESC}\\[(?:0|2)?K\\r?|${ESC}\\[(?:0|2)?K\\r)`;
const erase = new RegExp(`${clearLine}$`);
const frames = (writes: readonly string[]) =>
  writes.join("").match(/\r[^\r\n]*compile[^\r\n]*/g) ?? [];

function capture(options: { json?: boolean; tty?: boolean; stderr?: Writer } = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const layer = Output.layer(
    options.json ?? false,
    async (s) => {
      stdout.push(s);
    },
    async (s) => {
      await options.stderr?.(s);
      stderr.push(s);
    },
  ).pipe(
    Layer.provide(AppConfig.memory({ NO_COLOR: "", LOG_LEVEL: "none" })),
    Layer.provide(Host.memory({ stdoutIsTTY: options.tty ?? true })),
    Layer.provide(NodeServices.layer),
  );
  return { stdout, stderr, layer };
}

it.effect("350 ms draws three live frames, clears before the final row, and stops [4.4a#4]", () => {
  const memory = capture();
  return Effect.gen(function* () {
    const output = yield* Output;
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* output.live("compile");
        yield* TestClock.adjust("350 millis");
        const drawn = frames(memory.stderr);
        expect(drawn).toHaveLength(3);
        expect(drawn[0]).toMatch(/0\.1\s*s|100\s*ms/);
        expect(drawn[1]).toMatch(/0\.2\s*s|200\s*ms/);
        expect(drawn[2]).toMatch(/0\.3\s*s|300\s*ms/);
      }),
    );
    expect(memory.stderr.join("")).toMatch(erase);
    // Completion text comes from the caller's normal output path, after the scope clears.
    yield* output.progress("passed compile");
    expect(memory.stderr.join("").match(/passed compile\n/g)).toHaveLength(1);
    const closed = memory.stderr.join("");
    yield* TestClock.adjust("500 millis");
    expect(memory.stderr.join("")).toBe(closed);
    expect(memory.stdout).toEqual([]);
  }).pipe(Effect.provide(memory.layer));
});

it.effect(
  "EPIPE stops redraws without failing, and a fresh invocation still draws [4.4a#4] [4.4a#11]",
  () => {
    let attempts = 0;
    const broken = capture({
      stderr: async () => {
        attempts++;
        throw writeError("EPIPE");
      },
    });
    const fresh = capture();
    const exercise = Effect.gen(function* () {
      const output = yield* Output;
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* output.live("compile");
          yield* TestClock.adjust("350 millis");
        }),
      );
      yield* output.result({ ok: true }, "done");
      yield* output.flush;
    });
    return Effect.gen(function* () {
      yield* exercise.pipe(Effect.provide(broken.layer));
      expect(attempts).toBe(1);
      expect(broken.stdout.join("")).toBe("done\n");
      expect(broken.stderr).toEqual([]);
      yield* exercise.pipe(Effect.provide(fresh.layer));
      expect(frames(fresh.stderr)).toHaveLength(3);
      expect(fresh.stdout.join("")).toBe("done\n");
    });
  },
);

it.effect(
  "non-terminal and JSON live scopes emit no frames or cleanup bytes [4.4a#1] [4.4a#3]",
  () =>
    Effect.gen(function* () {
      for (const options of [{ tty: false }, { json: true }]) {
        const memory = capture(options);
        yield* Effect.gen(function* () {
          const output = yield* Output;
          yield* Effect.scoped(
            Effect.gen(function* () {
              yield* output.live("compile");
              yield* TestClock.adjust("350 millis");
            }),
          );
        }).pipe(Effect.provide(memory.layer));
        expect(memory.stdout).toEqual([]);
        expect(memory.stderr).toEqual([]);
      }
    }),
);

it.effect("failure closes the live scope and leaves no drawing fiber [4.4a#11]", () => {
  const memory = capture();
  return Effect.gen(function* () {
    const output = yield* Output;
    expect(typeof output.live).toBe("function");
    const exit = yield* Effect.scoped(
      Effect.gen(function* () {
        yield* output.live("compile");
        yield* TestClock.adjust("150 millis");
        return yield* Effect.fail("step-failed");
      }),
    ).pipe(Effect.exit);
    expect(Exit.isFailure(exit)).toBe(true);
    expect(frames(memory.stderr)).toHaveLength(1);
    expect(memory.stderr.join("")).toMatch(erase);
    const closed = memory.stderr.join("");
    yield* TestClock.adjust("1 second");
    expect(memory.stderr.join("")).toBe(closed);
    expect(memory.stdout).toEqual([]);
  }).pipe(Effect.provide(memory.layer));
});

it.effect("interruption clears the live line before the parent continues [4.4a#11]", () => {
  const memory = capture();
  return Effect.gen(function* () {
    const output = yield* Output;
    expect(typeof output.live).toBe("function");
    const ready = yield* Deferred.make<void>();
    const fiber = yield* Effect.scoped(
      Effect.gen(function* () {
        yield* output.live("compile");
        yield* Deferred.succeed(ready, undefined);
        yield* Effect.never;
      }),
    ).pipe(Effect.forkChild);
    yield* Deferred.await(ready);
    yield* TestClock.adjust("150 millis");
    yield* Fiber.interrupt(fiber);
    expect(frames(memory.stderr)).toHaveLength(1);
    expect(memory.stderr.join("")).toMatch(erase);
    const closed = memory.stderr.join("");
    yield* TestClock.adjust("1 second");
    expect(memory.stderr.join("")).toBe(closed);
    expect(memory.stdout).toEqual([]);
  }).pipe(Effect.provide(memory.layer));
});

test("verify clears live frames around complete child lines and a split last line [4.4a#5]", async () => {
  const root = realpathSync(space.dir());
  const release = join(root, "release-first");
  const finish = join(root, "release-second");
  writeFileSync(
    join(root, "child.cjs"),
    `
const fs = require("node:fs");
let stage = 0;
function advance() {
  if (stage === 0 && fs.existsSync("release-first")) {
    stage = 1;
    process.stdout.write("second\\nmiddle\\nlast-");
    fs.writeFileSync("middle-ready", "");
  }
  if (stage === 1 && fs.existsSync("release-second")) {
    stage = 2;
    watcher.close();
    clearInterval(poll);
    process.stdout.write("without-newline");
  }
}
const watcher = fs.watch(".", advance);
// A loaded macOS host can drop watch events; poll for the release files too.
const poll = setInterval(advance, 50);
process.stdout.write("ready\\nfirst-");
fs.writeFileSync("ready", "");
advance();
`,
  );
  writeProject(root, [{ name: "noisy", run: "node child.cjs", timeout: "5s" }]);
  let liveSeen = false;
  let resumed = false;
  let transcript = "";
  const result = await runCli(["verify"], {
    home: space.dir(),
    host: { ...terminal, cwd: root },
    env: { ...quiet, NO_COLOR: "", PATH: process.env.PATH },
    stderr: async (text) => {
      transcript += text;
      const tail = transcript.slice(transcript.lastIndexOf("\r"));
      if (!tail.includes("noisy") || tail.includes(" | ") || tail.includes("\n")) return;
      if (existsSync(join(root, "ready"))) {
        liveSeen = true;
        if (!existsSync(release)) writeFileSync(release, "");
      }
      if (existsSync(join(root, "middle-ready")) && transcript.includes("  noisy | middle\n")) {
        resumed = true;
        if (!existsSync(finish)) writeFileSync(finish, "");
      }
    },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("verify: green");
  expect(liveSeen).toBe(true);
  expect(resumed).toBe(true);
  for (const line of ["ready", "first-second", "middle", "last-without-newline"]) {
    expect(result.stderr.match(new RegExp(`  noisy \\| ${line}\\n`, "g"))).toHaveLength(1);
    expect(result.stderr).toMatch(new RegExp(`(?:^|\\n|${clearLine})  noisy \\| ${line}\\n`));
  }
  const childRows = result.stderr.split("\n").filter((line) => line.includes("noisy |"));
  for (const row of childRows) {
    // Clearing may precede a child row; no redraw can split its prefix or payload.
    expect(row.slice(row.indexOf("noisy |"))).not.toContain("\r");
    expect(row.slice(row.indexOf("noisy |"))).not.toContain(ESC);
  }
}, 15_000); // A staged child waits for observed redraws; 5 s is its failure watchdog.
