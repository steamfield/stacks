import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Exit, Layer } from "effect";
import { expect, test } from "vitest";
import { BadInput } from "../src/errors";
import { Host } from "../src/services/host";
import { Output } from "../src/services/output";
import { quiet, runCli, terminal, writeError } from "./helpers/cli";

/** Waits for the test to see a write; a buffered write would time out and fail the command. */
const awaitWrite = (seen: Deferred.Deferred<void>) =>
  Deferred.await(seen).pipe(Effect.timeout("2 seconds"), Effect.orDie);
const markSeen = (seen: Deferred.Deferred<void>, needle: string) => async (text: string) => {
  if (text.includes(needle)) Deferred.doneUnsafe(seen, Exit.void);
};

test("in human mode a progress line reaches stderr before the program finishes", async () => {
  const seen = Deferred.makeUnsafe<void>();
  const program = Effect.gen(function* () {
    const output = yield* Output;
    yield* output.progress("Running step: test");
    yield* awaitWrite(seen);
    yield* output.result({ ok: true }, "done");
  });
  const result = await runCli([], {
    program,
    host: terminal,
    stderr: markSeen(seen, "Running step"),
  });
  expect(result).toEqual({ status: 0, stdout: "done\n", stderr: "Running step: test\n" });
});
test("in JSON mode progress writes nothing, so stderr holds only the envelope", async () => {
  const program = Effect.gen(function* () {
    const output = yield* Output;
    yield* output.progress("Running step: test");
    return yield* Effect.fail(new BadInput());
  });
  const result = await runCli(["--json"], { program });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr)).toEqual({
    error: {
      tag: "BadInput",
      message: "Invalid input.",
      retryable: false,
      next: "run stacks --help for the command's flags.",
    },
  });
});
test("in JSON mode an event is one JSON line on stderr, before the envelope", async () => {
  const program = Effect.gen(function* () {
    const output = yield* Output;
    yield* output.event({ event: "step-started", name: "test" }, "> test");
    return yield* Effect.fail(new BadInput());
  });
  const result = await runCli(["--json"], { program });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr.split("\n").map((line) => (line ? JSON.parse(line) : line))).toEqual([
    { event: "step-started", name: "test" },
    {
      error: {
        tag: "BadInput",
        message: "Invalid input.",
        retryable: false,
        next: "run stacks --help for the command's flags.",
      },
    },
    "",
  ]);
});
test("for an agent an event writes its agent text, and nothing without one", async () => {
  const program = Effect.gen(function* () {
    const output = yield* Output;
    yield* output.event({ event: "step-started", name: "test" }, "> test");
    yield* output.event({ event: "step-finished", name: "test" });
    yield* output.result({ ok: true }, "done");
  });
  const result = await runCli([], { program, env: quiet });
  expect(result).toEqual({ status: 0, stdout: "done\n", stderr: "> test\n" });
});
test("for a human an event writes nothing; progress carries the live lines", async () => {
  const program = Effect.gen(function* () {
    const output = yield* Output;
    yield* output.event({ event: "step-started", name: "test" }, "> test");
    yield* output.progress("Running step: test");
    yield* output.result({ ok: true }, "done");
  });
  const result = await runCli([], { program, host: terminal, env: quiet });
  expect(result).toEqual({ status: 0, stdout: "done\n", stderr: "Running step: test\n" });
});
test.each(["EPIPE", "EACCES"] as const)(
  "an event write failing with %s stops later events and never fails the command",
  async (code) => {
    let attempts = 0;
    const program = Effect.gen(function* () {
      const output = yield* Output;
      yield* output.event({ n: 1 }, "> one");
      yield* output.event({ n: 2 }, "> two");
      yield* output.result({ ok: true }, "done");
    });
    const result = await runCli([], {
      program,
      env: quiet,
      stderr: async () => {
        attempts++;
        throw writeError(code);
      },
    });
    expect(result).toEqual({ status: 0, stdout: "done\n", stderr: "" });
    expect(attempts).toBe(1);
  },
);
test("progress swallows EPIPE then EACCES, stops writing, and leaves the exit code alone", async () => {
  const codes = ["EPIPE", "EACCES"] as const;
  let attempts = 0;
  const program = Effect.gen(function* () {
    const output = yield* Output;
    for (const _ of codes) yield* output.progress("step");
    yield* output.result({ ok: true }, "done");
  });
  const result = await runCli([], {
    program,
    host: terminal,
    stderr: async () => {
      throw writeError(codes[attempts++] ?? "EACCES");
    },
  });
  expect(result).toEqual({ status: 0, stdout: "done\n", stderr: "" });
  expect(attempts).toBe(1);
});
test.each(["EPIPE", "EACCES"] as const)(
  "a progress write failing with %s never fails the command",
  async (code) => {
    const program = Effect.gen(function* () {
      const output = yield* Output;
      yield* output.progress("step");
      yield* output.result({ ok: true }, "done");
    });
    const result = await runCli([], {
      program,
      host: terminal,
      stderr: async (text) => {
        if (text === "step\n") throw writeError(code);
      },
    });
    expect(result).toEqual({ status: 0, stdout: "done\n", stderr: "" });
  },
);

test("in human mode flushNow puts the result on stdout before the program finishes", async () => {
  const seen = Deferred.makeUnsafe<void>();
  const program = Effect.gen(function* () {
    const output = yield* Output;
    yield* output.result({ ok: true }, "handing off");
    yield* output.flushNow;
    yield* awaitWrite(seen);
  });
  const result = await runCli([], {
    program,
    host: terminal,
    stdout: markSeen(seen, "handing off"),
  });
  expect(result).toEqual({ status: 0, stdout: "handing off\n", stderr: "" });
});
test("flushNow then BadInput keeps the flushed text on stdout and writes the envelope", async () => {
  const program = Effect.gen(function* () {
    const output = yield* Output;
    yield* output.result({ ok: true }, "handing off");
    yield* output.flushNow;
    return yield* Effect.fail(new BadInput());
  });
  const result = await runCli([], { program, env: quiet });
  expect(result).toEqual({
    status: 2,
    stdout: "handing off\n",
    stderr: "Invalid input.\n  Next: run stacks --help for the command's flags.\n",
  });
});
test("in JSON mode flushNow writes nothing until the command ends", async () => {
  let finished = false;
  let early = 0;
  const program = Effect.gen(function* () {
    const output = yield* Output;
    yield* output.result({ ok: true }, "handing off");
    yield* output.flushNow;
    finished = true;
  });
  const result = await runCli(["--json"], {
    program,
    stdout: async () => {
      if (!finished) early++;
    },
  });
  expect(early).toBe(0);
  expect(result).toEqual({ status: 0, stdout: '{"ok":true}\n', stderr: "" });
});

test("flushing a null JSON result leaves the telemetry notice pending", async () => {
  const { layer, stdout, stderr } = Output.memory("json");
  const delivered = await Effect.runPromise(
    Effect.gen(function* () {
      const output = yield* Output;
      yield* output.showNotice("Telemetry notice");
      yield* output.result(null, "");
      yield* output.flush;
      return yield* output.didDeliverNotice;
    }).pipe(Effect.provide(layer)),
  );

  expect(JSON.parse(stdout.join(""))).toBeNull();
  expect(stderr).toEqual([]);
  expect(delivered).toBe(false);
});

test("flushing a JSON object includes the telemetry notice and marks it delivered", async () => {
  const { layer, stdout, stderr } = Output.memory("json");
  const delivered = await Effect.runPromise(
    Effect.gen(function* () {
      const output = yield* Output;
      yield* output.showNotice("Telemetry notice");
      yield* output.result({ ok: true }, "");
      expect(yield* output.didDeliverNotice).toBe(false);
      yield* output.flush;
      return yield* output.didDeliverNotice;
    }).pipe(Effect.provide(layer)),
  );

  expect(JSON.parse(stdout.join(""))).toEqual({ ok: true, notice: "Telemetry notice" });
  expect(stderr).toEqual([]);
  expect(delivered).toBe(true);
});

test.each([
  { name: "drops the notice", expected: null, delivered: false },
  { name: "retains the notice", expected: { notice: "Telemetry notice" }, delivered: true },
])("a custom JSON serializer $name", async ({ expected, delivered }) => {
  const { layer, stdout, stderr } = Output.memory("json");
  const actual = await Effect.runPromise(
    Effect.gen(function* () {
      const output = yield* Output;
      yield* output.showNotice("Telemetry notice");
      yield* output.result(
        {
          toJSON(this: { notice?: string }) {
            return delivered ? { notice: this.notice } : null;
          },
        },
        "",
      );
      yield* output.flush;
      return yield* output.didDeliverNotice;
    }).pipe(Effect.provide(layer)),
  );

  expect(JSON.parse(stdout.join(""))).toEqual(expected);
  expect(stderr).toEqual([]);
  expect(actual).toBe(delivered);
});

test("Host.memory reports no terminal on either stream", async () => {
  const host = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Host;
    }).pipe(Effect.provide(Layer.merge(NodeServices.layer, Host.memory()))),
  );
  expect(host).toMatchObject({ stdinIsTTY: false, stdoutIsTTY: false });
});
test("a command reading Host sees the TTY flags the helper passed", async () => {
  const program = Effect.gen(function* () {
    const host = yield* Host;
    const output = yield* Output;
    yield* output.result({ stdin: host.stdinIsTTY, stdout: host.stdoutIsTTY }, "");
  });
  const run = async (host: { stdinIsTTY: boolean; stdoutIsTTY: boolean }) =>
    JSON.parse((await runCli(["--json"], { program, host })).stdout);
  expect(await run({ stdinIsTTY: true, stdoutIsTTY: false })).toEqual({
    stdin: true,
    stdout: false,
  });
  expect(await run({ stdinIsTTY: false, stdoutIsTTY: true })).toEqual({
    stdin: false,
    stdout: true,
  });
});
