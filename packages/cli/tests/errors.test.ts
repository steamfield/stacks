import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";
import {
  BadInput,
  BrokenPipe,
  ComposeConflict,
  EntryInvalid,
  ErrorEnvelope,
  ErrorTag,
  errorClasses,
  errorTable,
  exitCode,
  keepsResult,
  NotFound,
  PermissionDenied,
  PermissionDeniedDetails,
  retryable,
  ValidationFailed,
  VerifyChanged,
  VerifyFailed,
} from "../src/errors";
import { Output } from "../src/services/output";
import { ndjson, quiet, runCli, tempDir, terminal, writeError } from "./helpers/cli";

const reported = errorClasses.map((Class) => new Class()).filter((e) => !(e instanceof BrokenPipe));
const COMPOSE_NEXT =
  "change --with or --without so these entries fit, or pick another stack; stacks show <id> lists what each entry requires and conflicts with.";
test("the published error table, written out row by row", () => {
  expect(errorTable).toEqual({
    Usage: { exit: 2, retryable: false, keepsResult: false },
    BadInput: { exit: 2, retryable: false, keepsResult: false },
    NotFound: { exit: 2, retryable: false, keepsResult: false },
    NotConfigured: { exit: 3, retryable: false, keepsResult: false },
    InvalidConfig: { exit: 3, retryable: false, keepsResult: false },
    UpstreamUnavailable: { exit: 4, retryable: true, keepsResult: false },
    UpdateFailed: { exit: 6, retryable: false, keepsResult: false },
    VerifyFailed: { exit: 5, retryable: false, keepsResult: true },
    VerifyChanged: { exit: 5, retryable: false, keepsResult: true },
    PermissionDenied: { exit: 6, retryable: false, keepsResult: false },
    EntryInvalid: { exit: 2, retryable: false, keepsResult: false },
    ComposeConflict: { exit: 2, retryable: false, keepsResult: false },
    TargetNotEmpty: { exit: 2, retryable: false, keepsResult: false },
    ValidationFailed: { exit: 2, retryable: false, keepsResult: true },
    Interrupted: { exit: 130, retryable: false, keepsResult: false },
    Defect: { exit: 1, retryable: false, keepsResult: false },
    BrokenPipe: { exit: 0, retryable: false, keepsResult: false },
  });
});
test("the class list, the envelope's tag literals and the table's keys are the same set", () => {
  expect(new Set(errorClasses.map((Class) => new Class()._tag))).toEqual(
    new Set(Object.keys(errorTable)),
  );
  expect(new Set(ErrorTag.literals)).toEqual(new Set(Object.keys(errorTable)));
});
test.each(reported.map((error) => [error._tag, error] as const))(
  "a program failing %s exits with its row's code, retryable from its row, no result and a next action",
  async (_tag, error) => {
    const row = errorTable[error._tag];
    expect(exitCode(error)).toBe(row.exit);
    expect(retryable(error)).toBe(row.retryable);
    const result = await runCli(["--json"], { program: Effect.fail(error) });
    expect(result.status).toBe(row.exit);
    expect(result.stdout).toBe("");
    const envelope = Schema.decodeUnknownSync(ErrorEnvelope)(JSON.parse(result.stderr), {
      onExcessProperty: "error",
    });
    expect(envelope).toEqual({
      error: {
        tag: error._tag,
        message: error.message,
        retryable: row.retryable,
        next: expect.stringMatching(/\S/),
      },
    });
  },
);
test.each(
  reported.filter((error) => !keepsResult(error)).map((error) => [error._tag, error] as const),
)("a %s failure in text mode ends with the envelope's next action", async (_tag, error) => {
  const json = await runCli(["--json"], { program: Effect.fail(error), env: quiet });
  const next: unknown = JSON.parse(json.stderr).error.next;
  const text = await runCli([], { program: Effect.fail(error), env: quiet });
  expect(text.stderr.trimEnd().split("\n").at(-1)).toBe(`  Next: ${String(next)}`);
});
test("an unknown command names the CLI as invoked in its next action", async () => {
  const result = await runCli(["lst"], { env: quiet, host: { invocation: "npx stacks" } });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(
    "Invalid command.\n  Command: lst\n  Did you mean: list?\n  Next: run npx stacks --help to list the commands, or npx stacks <command> --help for one.\n",
  );
});
test("VerifyFailed and VerifyChanged exit 5 and keep their result", () => {
  for (const error of [new VerifyFailed(), new VerifyChanged()])
    expect(errorTable[error._tag]).toEqual({ exit: 5, retryable: false, keepsResult: true });
});
test("an observed cancellation returns 130 and disposes its scope", async () => {
  let released = false;
  const controller = new AbortController();
  const program = Effect.acquireRelease(
    Effect.sync(() => {
      controller.abort();
    }),
    () =>
      Effect.sync(() => {
        released = true;
      }),
  ).pipe(Effect.andThen(Effect.never), Effect.scoped);
  const result = await runCli(["--json"], { program, signal: controller.signal });
  expect(result.status).toBe(130);
  expect(released).toBe(true);
  expect(result.stdout).toBe("");
});

const denied = () =>
  new PermissionDenied({ details: { reason: "write", path: "/private/target" } });
test("details go into the JSON envelope and as indented lines in human mode", async () => {
  const json = await runCli(["--json"], { program: Effect.fail(denied()) });
  expect(json.status).toBe(6);
  expect(JSON.parse(json.stderr)).toEqual({
    error: {
      tag: "PermissionDenied",
      message: "Permission denied.",
      retryable: false,
      details: { reason: "write", path: "/private/target" },
    },
  });
  const human = await runCli([], {
    program: Effect.fail(denied()),
    env: quiet,
    host: terminal,
  });
  expect(human.status).toBe(6);
  expect(human.stderr).toBe("Permission denied.\n  Path: /private/target\n");
});
test.each([
  [
    "escape",
    "The path resolves outside the project directory, through a symlink or `..`.\n  Next: remove that symlink from the project directory, or pick another directory.",
  ],
  [
    "unwritable",
    "The project directory or a file in it can't be written. Nothing was left behind.\n  Next: pick a directory you can write to, or fix this one's permissions.",
  ],
] as const)("PermissionDenied %s ends with a Next line", async (reason, lines) => {
  const error = new PermissionDenied({ details: { reason, path: "/work/app" } });
  const human = await runCli([], { program: Effect.fail(error), env: quiet, host: terminal });
  expect(human.status).toBe(6);
  expect(human.stdout).toBe("");
  expect(human.stderr).toBe(`Permission denied.\n  Path: /work/app\n  ${lines}\n`);
});
test("a Next line names the CLI the way it was invoked", async () => {
  const human = await runCli([], {
    program: Effect.fail(new NotFound({ details: { suggestions: [] } })),
    env: quiet,
    host: { ...terminal, invocation: "npx stacks" },
  });
  expect(human.status).toBe(2);
  expect(human.stdout).toBe("");
  expect(human.stderr).toBe(
    "Not found.\n  Next: run npx stacks list to see every stack and fragment id.\n",
  );
});
test("a details object mutated to carry an extra property is a defect, not a leak", async () => {
  const dir = tempDir();
  try {
    const file = join(dir.path, "cli.jsonl");
    const error = denied();
    Object.assign(error.details ?? {}, { extra: "leaked" });
    const result = await runCli(["--json"], {
      program: Effect.fail(error),
      env: { LOG_LEVEL: "info", STACKS_LOG_FILE: file },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error.tag).toBe("Defect");
    expect(result.stderr).not.toContain("leaked");
    const log = readFileSync(file, "utf8");
    expect(ndjson(log)).toHaveLength(1);
    expect(log).not.toContain("leaked");
  } finally {
    dir.cleanup();
  }
});
test("EntryInvalid details name the entry in the envelope and in human mode", async () => {
  const error = new EntryInvalid({
    details: { id: "bun-web", origin: "user", reason: "symlink", path: "files/link" },
  });
  const json = await runCli(["--json"], { program: Effect.fail(error) });
  expect(json.status).toBe(2);
  const next = "fix that entry or leave it out; stacks validate lists every problem in a registry.";
  expect(JSON.parse(json.stderr)).toEqual({
    error: {
      tag: "EntryInvalid",
      message: "Entry is invalid.",
      retryable: false,
      next,
      details: { id: "bun-web", origin: "user", reason: "symlink", path: "files/link" },
    },
  });
  const human = await runCli([], { program: Effect.fail(error), env: quiet, host: terminal });
  expect(human.stderr).toBe(
    `Entry is invalid.\n  Entry: bun-web (user, symlink)\n  Path: files/link\n  Next: ${next}\n`,
  );
});
test.each([
  [
    "ComposeConflict with every key",
    new ComposeConflict({
      details: {
        reason: "env",
        stack: "web-stack",
        ids: ["port-clash"],
        path: "a.json",
        step: "web",
        key: "PORT_WEB",
      },
    }),
    `These entries can't be composed.\n  Reason: env\n  Stack: web-stack\n  Fragments: port-clash\n  Path: a.json\n  Step: web\n  Key: PORT_WEB\n  Next: ${COMPOSE_NEXT}\n`,
  ],
  [
    "ComposeConflict between fragments",
    new ComposeConflict({ details: { reason: "cycle", ids: ["cycle-a", "cycle-b"] } }),
    `These entries can't be composed.\n  Reason: cycle\n  Fragments: cycle-a, cycle-b\n  Next: ${COMPOSE_NEXT}\n`,
  ],
  [
    "BadInput for an id in --with and --without",
    new BadInput({ details: { id: "ci", flag: "with_without" } }),
    "Invalid input.\n  Id: ci\n  Flags: --with and --without\n  Next: name ci in only one of --with and --without.\n",
  ],
  [
    "BadInput for --scope",
    new BadInput({ details: { id: "Acme/x", flag: "scope" } }),
    "Invalid input.\n  Flag: --scope Acme/x\n  Next: pass an npm scope such as acme or @acme: lowercase, URL-safe, no /.\n",
  ],
  [
    "BadInput for a directory name",
    new BadInput({ details: { id: "a\u0007b", flag: "dir" } }),
    "Invalid input.\n  Directory name: a\\u0007b\n  Next: pick a project directory whose name has no control characters.\n",
  ],
  [
    "BadInput for a flag that needs --brief",
    new BadInput({ details: { id: "--with", flag: "brief" } }),
    "Invalid input.\n  Flag: --with\n  Next: --with, --without and --sandbox need --brief <stack>; add it, or drop the flag.\n",
  ],
  [
    "NotFound for an id in a registry root list doesn't read",
    new NotFound({ details: { suggestions: ["web"], root: "/work/my registry" } }),
    "Not found.\n  Did you mean: web?\n  Next: stacks validate '/work/my registry' lists the ids under that root.\n",
  ],
  [
    "NotFound naming the fragment id it didn't find",
    new NotFound({ details: { suggestions: ["lint"], id: "lnt\u001b", kind: "fragment" } }),
    "Not found.\n  Fragment: lnt\\u001b\n  Did you mean: lint?\n  Next: run stacks list to see every stack and fragment id.\n",
  ],
  [
    "EntryInvalid for an unknown template variable",
    new EntryInvalid({
      details: { id: "web", origin: "user", reason: "template", path: "files/a.tmpl", line: 2 },
    }),
    "Entry is invalid.\n  Entry: web (user, template)\n  Path: files/a.tmpl:2\n  Next: use only project_name, project_slug, env_prefix, package_scope, author, year in that file's {{ }} tokens, or drop its .tmpl suffix to copy it as is.\n",
  ],
  [
    "EntryInvalid with a line and a problem",
    new EntryInvalid({
      details: {
        id: "bad-when",
        origin: "user",
        reason: "conditional",
        path: "FRAGMENT.md",
        line: 11,
        problem: "unclosed",
      },
    }),
    "Entry is invalid.\n  Entry: bad-when (user, conditional)\n  Path: FRAGMENT.md:11\n  Problem: unclosed\n  Next: fix that entry or leave it out; stacks validate lists every problem in a registry.\n",
  ],
  [
    "NotFound with the path it looked for",
    new NotFound({ details: { suggestions: [], looked: "/work/regsitry" } }),
    "Not found.\n  Looked for: /work/regsitry\n  Next: pass a registry root (a directory holding stacks/ or fragments/) or an entry directory inside one.\n",
  ],
  [
    // The report on stdout already ends with the counts, so the text modes don't repeat them.
    "ValidationFailed with its counts in the envelope only",
    new ValidationFailed({ details: { errors: 3, warnings: 1 } }),
    "Validation failed.\n",
  ],
] as const)(
  "%s: details in the envelope, detail lines in human mode",
  async (_case, error, human) => {
    const json = await runCli(["--json"], { program: Effect.fail(error), env: quiet });
    expect(json.status).toBe(2);
    expect(json.stdout).toBe("");
    // The text modes print the envelope's `next` as their last line, except after a kept report.
    const next = /\n {2}Next: (.*)\n$/.exec(human)?.[1];
    expect(JSON.parse(json.stderr)).toEqual({
      error: {
        tag: error._tag,
        message: error.message,
        retryable: false,
        next: next ?? expect.stringMatching(/\S/),
        details: error.details,
      },
    });
    for (const host of [terminal, {}]) {
      const text = await runCli([], { program: Effect.fail(error), env: quiet, host });
      expect(text.status).toBe(2);
      expect(text.stdout).toBe("");
      expect(text.stderr).toBe(human);
    }
  },
);
test.each([
  ["ComposeConflict", () => new ComposeConflict({ details: { reason: "cycle", ids: ["a"] } })],
  ["BadInput", () => new BadInput({ details: { id: "ci", flag: "with_without" } })],
  ["ValidationFailed", () => new ValidationFailed({ details: { errors: 1, warnings: 0 } })],
] as const)(
  "%s details mutated to carry an extra key are a defect, not a leak",
  async (_tag, make) => {
    const error = make();
    Object.assign(error.details ?? {}, { extra: "leaked" });
    const result = await runCli(["--json"], { program: Effect.fail(error), env: quiet });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error.tag).toBe("Defect");
    expect(result.stderr).not.toContain("leaked");
  },
);
test("construction drops keys the details schema doesn't name", () => {
  const error = new PermissionDenied({ details: { reason: "write", extra: 1 } as never });
  expect(error.details).toEqual({ reason: "write" });
});
test("encoding PermissionDenied details with an extra property fails", () => {
  const encode = Schema.encodeUnknownSync(PermissionDeniedDetails);
  expect(encode({ reason: "write" }, { onExcessProperty: "error" })).toEqual({ reason: "write" });
  expect(() => encode({ reason: "write", extra: 1 }, { onExcessProperty: "error" })).toThrow();
});
test("the JSONL log record of a failure contains no detail value", async () => {
  const dir = tempDir();
  try {
    const file = join(dir.path, "cli.jsonl");
    const result = await runCli(["--json"], {
      program: Effect.fail(denied()),
      env: { LOG_LEVEL: "info", STACKS_LOG_FILE: file },
    });
    expect(result.stderr).toContain("/private/target");
    const records = ndjson(readFileSync(file, "utf8"));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ msg: "command", status: 6 });
    expect(JSON.stringify(records)).not.toContain("/private/target");
  } finally {
    dir.cleanup();
  }
});

const report = (error: VerifyFailed | BadInput) =>
  Effect.gen(function* () {
    const output = yield* Output;
    yield* output.result({ passed: false }, "Verify: 1 step failed");
    return yield* Effect.fail(error);
  });
test.each([
  [["--json"], '{"passed":false}\n'],
  [[], "Verify: 1 step failed\n"],
])("VerifyFailed keeps its result on stdout with %j", async (args, stdout) => {
  const result = await runCli(args, { program: report(new VerifyFailed()), env: quiet });
  expect(result.status).toBe(5);
  expect(result.stdout).toBe(stdout);
  const last = result.stderr.trimEnd().split("\n").at(-1);
  if (args.length)
    expect(JSON.parse(last ?? "")).toEqual({
      error: {
        tag: "VerifyFailed",
        message: "Verify failed.",
        retryable: false,
        next: "fix the code or config these steps exercise, not the steps, then run stacks verify again.",
      },
    });
  else expect(result.stderr.trimEnd().split("\n").at(-1)).toBe("Verify failed.");
});
test.each([[["--json"]], [[]]])(
  "BadInput (no kept result) leaves stdout empty after a result was written, with %j",
  async (args) => {
    const result = await runCli(args, { program: report(new BadInput()) });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Invalid input.");
  },
);
test("VerifyFailed keeps exit 5 when stdout is closed, and still writes the envelope", async () => {
  const result = await runCli(["--json"], {
    program: report(new VerifyFailed()),
    stdout: async () => {
      throw writeError("EPIPE");
    },
  });
  expect(result.status).toBe(5);
  expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr).error.tag).toBe("VerifyFailed");
});
test("VerifyFailed keeps exit 5 when both streams are closed", async () => {
  const closed = async () => {
    throw writeError("EPIPE");
  };
  const result = await runCli(["--json"], {
    program: report(new VerifyFailed()),
    stdout: closed,
    stderr: closed,
  });
  expect(result).toEqual({ status: 5, stdout: "", stderr: "" });
});
test("a successful command whose stdout is closed exits 0", async () => {
  const result = await runCli(["doctor", "--json"], {
    stdout: async () => {
      throw writeError("EPIPE");
    },
  });
  expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
});
test("BadInput with a closed stderr is quiet and exits 0, as before", async () => {
  const result = await runCli(["--json"], {
    program: Effect.fail(new BadInput()),
    stderr: async () => {
      throw writeError("EPIPE");
    },
  });
  expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
});
test("a non-EPIPE write error is PermissionDenied with reason write", async () => {
  const result = await runCli(["doctor", "--json"], {
    stdout: async () => {
      throw writeError("EACCES");
    },
  });
  expect(result.status).toBe(6);
  expect(JSON.parse(result.stderr)).toEqual({
    error: {
      tag: "PermissionDenied",
      message: "Permission denied.",
      retryable: false,
      details: { reason: "write" },
    },
  });
});
test("a kept result that can't be written still exits 5 and is noted in the log", async () => {
  const dir = tempDir();
  try {
    const file = join(dir.path, "cli.jsonl");
    const result = await runCli(["--json"], {
      program: report(new VerifyFailed()),
      env: { LOG_LEVEL: "info", STACKS_LOG_FILE: file },
      stdout: async () => {
        throw writeError("EACCES");
      },
    });
    expect(result.status).toBe(5);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error.tag).toBe("VerifyFailed");
    const records = ndjson(readFileSync(file, "utf8"));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      msg: "command",
      status: 5,
      result: "unwritten",
      resultError: "PermissionDenied",
    });
  } finally {
    dir.cleanup();
  }
});
test("a kept result that was written carries no unwritten note", async () => {
  const dir = tempDir();
  try {
    const file = join(dir.path, "cli.jsonl");
    await runCli(["--json"], {
      program: report(new VerifyFailed()),
      env: { LOG_LEVEL: "info", STACKS_LOG_FILE: file },
    });
    const [record] = ndjson(readFileSync(file, "utf8"));
    expect(record).not.toHaveProperty("result");
  } finally {
    dir.cleanup();
  }
});
