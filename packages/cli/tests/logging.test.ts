import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Clock, Effect, Schema } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "vitest";
import { ErrorEnvelope } from "../src/errors";
import { entry } from "../src/logging";
import { DoctorReport } from "../src/schemas/doctor";
import { Output } from "../src/services/output";
import { ndjson, runCli, tempDir, terminal } from "./helpers/cli";

const decodeError = Schema.decodeUnknownSync(ErrorEnvelope, { onExcessProperty: "error" });

const record = () =>
  entry({
    date: new Date("2026-01-01T00:00:00Z"),
    level: "Info",
    message: ["command", { private: "hidden" }],
    annotations: { msg: "collision", token: "hidden", object: { secret: "hidden" } },
  });
test("logging has stable UTC shape and safe annotations", () => {
  expect(record()).toEqual({
    time: "2026-01-01T00:00:00.000Z",
    level: "info",
    msg: "command",
    detail: ["[redacted]"],
    annotation_msg: "collision",
    token: "[redacted]",
    object: "[redacted]",
  });
});
test("command logs include duration, outcome and shared invocation id", async () => {
  const result = await runCli(["doctor"], {
    env: { LOG_LEVEL: "info", STACKS_LOG_FORMAT: "json" },
    program: Effect.logInfo("child"),
    host: terminal,
  });
  const records = ndjson(result.stderr);
  expect(records).toHaveLength(2);
  expect(records[0]).toMatchObject({ msg: "child" });
  expect(records[1]).toMatchObject({ msg: "command", outcome: "success", status: 0 });
  expect((records[0] as { invocationId: string }).invocationId).toBe(
    (records[1] as { invocationId: string }).invocationId,
  );
});
test("JSON mode preserves its error envelope and sends command logs to the optional file", async () => {
  const dir = tempDir();
  try {
    const file = join(dir.path, "cli.jsonl");
    const result = await runCli(["unknown", "--json"], {
      env: { LOG_LEVEL: "info", STACKS_LOG_FILE: file },
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(decodeError(JSON.parse(result.stderr))).toEqual({
      error: {
        tag: "Usage",
        message: "Invalid command.",
        retryable: false,
        next: "run stacks --help to list the commands, or stacks <command> --help for one.",
        details: { command: "unknown", suggestions: [] },
      },
    });
    const command = commandRecord(file, ["cause"], {
      level: "error",
      outcome: "failure",
      status: 2,
    });
    assert("cause" in command);
    expectCause(command.cause, { name: "Usage", message: "Invalid command.", status: 2 });
  } finally {
    dir.cleanup();
  }
});

const summaryKeys = [
  "time",
  "level",
  "msg",
  "detail",
  "invocationId",
  "duration",
  "outcome",
  "status",
];
function commandRecord(
  file: string,
  extraKeys: readonly string[],
  outcome: { level: string; outcome: string; status: number },
) {
  const rows = ndjson(readFileSync(file, "utf8"));
  expect(rows).toHaveLength(1);
  const [record] = rows;
  assert(record && typeof record === "object" && !Array.isArray(record));
  expect(Object.keys(record)).toEqual([...summaryKeys, ...extraKeys]);
  expect(record).toMatchObject({
    time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    msg: "command",
    detail: [],
    invocationId: expect.stringMatching(/^\d+-[a-z0-9]+$/),
    ...outcome,
  });
  assert("duration" in record && typeof record.duration === "number");
  expect(Number.isInteger(record.duration)).toBe(true);
  expect(record.duration).toBeGreaterThanOrEqual(0);
  return record;
}

function expectCause(value: unknown, cause: { name: string; message: string; status: number }) {
  assert(value && typeof value === "object");
  expect(Object.keys(value)).toEqual(["name", "message", "status", "stack"]);
  expect(value).toEqual({ ...cause, stack: expect.stringMatching(/^\w+: .+\n\s+at /) });
}

it.effect("a successful JSON command appends one ordered summary record with elapsed time", () =>
  Effect.gen(function* () {
    const dir = tempDir();
    try {
      const clock = yield* Clock.Clock;
      const file = join(dir.path, "cli.jsonl");
      const result = yield* Effect.promise(() =>
        runCli(["doctor", "--json"], {
          clock,
          env: { LOG_LEVEL: "info", STACKS_LOG_FILE: file },
          stdout: () =>
            Effect.runPromise(TestClock.adjust(37).pipe(Effect.provideService(Clock.Clock, clock))),
        }),
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const report = Schema.decodeUnknownSync(DoctorReport)(JSON.parse(result.stdout));
      expect(report.configErrors).toEqual([]);
      const command = commandRecord(file, [], { level: "info", outcome: "success", status: 0 });
      expect(command.duration).toBe(37);
    } finally {
      dir.cleanup();
    }
  }),
);

test("a defect appends one ordered summary with its class and frames but without private data", async () => {
  const dir = tempDir();
  try {
    const file = join(dir.path, "cli.jsonl");
    const result = await runCli(["--json"], {
      program: Effect.die(new TypeError("private details")),
      env: { LOG_LEVEL: "info", STACKS_LOG_FILE: file },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(decodeError(JSON.parse(result.stderr))).toEqual({
      error: {
        tag: "Defect",
        message: "An unexpected error occurred.",
        retryable: false,
        next: "set STACKS_LOG_FILE to a file path and run the command again; the file records where it failed. Report it if it repeats.",
      },
    });
    const command = commandRecord(file, ["defect", "cause"], {
      level: "error",
      outcome: "failure",
      status: 1,
    });
    assert("defect" in command && "cause" in command);
    expect(command.defect).toMatch(/^TypeError\nat /);
    expectCause(command.cause, {
      name: "Defect",
      message: "An unexpected error occurred.",
      status: 1,
    });
    expect(readFileSync(file, "utf8")).not.toContain("private details");
  } finally {
    dir.cleanup();
  }
});

test("the log sink recreates its directory between writing command logs and the summary", async () => {
  const dir = tempDir();
  const logDir = join(dir.path, "logs");
  const file = join(logDir, "cli.jsonl");
  try {
    let before: unknown[] = [];
    const result = await runCli(["--json"], {
      env: { LOG_LEVEL: "info", STACKS_LOG_FILE: file },
      program: Effect.gen(function* () {
        yield* Effect.logInfo("before result");
        yield* (yield* Output).result({ ok: true }, "done");
      }),
      stdout: async () => {
        before = ndjson(readFileSync(file, "utf8"));
        rmSync(logDir, { recursive: true });
      },
    });
    expect(result).toEqual({ status: 0, stdout: '{"ok":true}\n', stderr: "" });
    expect(before).toEqual([expect.objectContaining({ msg: "before result" })]);
    expect(ndjson(readFileSync(file, "utf8"))).toEqual([
      expect.objectContaining({ msg: "command" }),
    ]);
  } finally {
    dir.cleanup();
  }
});

test("the human log sink warns once when multiple records cannot be written", async () => {
  const dir = tempDir();
  const logDir = join(dir.path, "logs");
  try {
    writeFileSync(logDir, "blocked");
    const result = await runCli([], {
      env: {
        LOG_LEVEL: "info",
        STACKS_LOG_FILE: join(logDir, "cli.jsonl"),
        STACKS_LOG_FORMAT: "json",
      },
      host: terminal,
      program: Effect.logInfo("first").pipe(Effect.andThen(Effect.logInfo("second"))),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    const lines = result.stderr.trimEnd().split("\n");
    expect(lines).toHaveLength(4);
    const [first, warning, second, summary] = lines;
    expect(warning).toBe("Log file unavailable; continuing with stderr.");
    expect(ndjson([first, second, summary].join("\n"))).toEqual([
      expect.objectContaining({ msg: "first" }),
      expect.objectContaining({ msg: "second" }),
      expect.objectContaining({ msg: "command" }),
    ]);
    expect(readFileSync(logDir, "utf8")).toBe("blocked");
  } finally {
    dir.cleanup();
  }
});
