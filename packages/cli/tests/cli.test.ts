import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, expect, test } from "vitest";
import { hasFlag } from "../src/main";
import { VERSION } from "../src/version";
import { quiet, runCli, tempDir, terminal } from "./helpers/cli";

const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) d.cleanup();
});
function configFile(content: string) {
  const dir = tempDir();
  dirs.push(dir);
  const parent = join(dir.path, "config", "stacks");
  mkdirSync(parent, { recursive: true });
  writeFileSync(join(parent, "config.json"), content);
  return dir.path;
}
test("doctor runs under Node and respects human/JSON result contracts", async () => {
  const human = await runCli(["doctor"], { host: terminal });
  expect(human.status).toBe(0);
  expect(human.stdout).toContain(`stacks ${VERSION}`);
  expect(human.stderr).toBe("");
  const json = await runCli(["doctor", "--json"]);
  expect(json.status).toBe(0);
  expect(JSON.parse(json.stdout)).toMatchObject({
    version: VERSION,
    platform: "test-node",
    configErrors: [],
  });
});
test("the scoped npm package keeps the stacks command and config paths", async () => {
  const dir = tempDir();
  dirs.push(dir);
  const help = await runCli(["--help"], { home: dir.path });
  expect(help.status).toBe(0);
  expect(help.stderr).toBe("");
  expect(help.stdout).toContain("stacks <subcommand>");
  expect(help.stdout).not.toContain("@steamfield/stacks");
  const doctor = await runCli(["doctor", "--json"], { home: dir.path });
  expect(doctor.status).toBe(0);
  expect(doctor.stderr).toBe("");
  expect(JSON.parse(doctor.stdout).paths).toMatchObject({
    config: join(dir.path, "config/stacks/config.json"),
    data: join(dir.path, ".local/share/stacks"),
    cache: join(dir.path, ".cache/stacks"),
    user: join(dir.path, "config/stacks"),
  });
});
test.each([
  ["--help"],
  ["doctor", "--help"],
  ["--version"],
  ["--version", "--json"],
  ["--help", "--json"],
  ["--json", "doctor"],
])("successfully handles %j", async (...args) => {
  const result = await runCli(args);
  expect(result.status).toBe(0);
  expect(result.stdout).toBeTruthy();
  expect(result.stdout).not.toContain(String.fromCharCode(27));
  expect(result.stderr).toBe("");
  if (args.includes("--json")) expect(() => JSON.parse(result.stdout)).not.toThrow();
});
test.each([
  ["--unexpected", "--json"],
  ["doctor", "extra", "--json"],
])("Usage (no kept result) has empty stdout and exactly one JSON error for %j", async (...args) => {
  const result = await runCli(args);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr)).toEqual({
    error: {
      tag: "Usage",
      message: "Invalid command.",
      retryable: false,
      ...(args[0] === "--unexpected"
        ? {
            next: "run stacks --help to list the flags and arguments.",
            details: { flag: "--unexpected", command: "stacks", suggestions: [] },
          }
        : {
            next: "run stacks --help to list the commands, or stacks <command> --help for one.",
          }),
    },
  });
});
test.each([
  ["--log-level", "all | trace | debug | info | warn | warning | error | fatal | none"],
  ["--completions", "bash | zsh | fish | powershell | sh | pwsh"],
])("missing %s value is Usage with the parser's expectation", async (flag, expected) => {
  const result = await runCli([flag, "--json"]);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr)).toEqual({
    error: {
      tag: "Usage",
      message: "Invalid command.",
      retryable: false,
      next: "pass a value from Expected; stacks --help lists every flag.",
      details: { flag, value: "", expected, command: "stacks" },
    },
  });
});
test("a mistyped subcommand is Usage with the close match under the message", async () => {
  const result = await runCli(["doctr"], { env: quiet });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(
    "Invalid command.\n  Command: doctr\n  Did you mean: doctor?\n  Next: run stacks --help to list the commands, or stacks <command> --help for one.\n",
  );
});
test("a mistyped subcommand with --json is one envelope naming the suggestions", async () => {
  const result = await runCli(["doctr", "--json"]);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr.trimEnd().split("\n").at(-1) ?? "")).toEqual({
    error: {
      tag: "Usage",
      message: "Invalid command.",
      retryable: false,
      next: "run stacks --help to list the commands, or stacks <command> --help for one.",
      details: { command: "doctr", suggestions: ["doctor"] },
    },
  });
});
test("an unknown subcommand with no close match gets no suggestion", async () => {
  const human = await runCli(["zzzz"], { env: quiet, host: terminal });
  expect(human.status).toBe(2);
  expect(human.stdout).toBe("");
  expect(human.stderr).toBe(
    "Invalid command.\n  Command: zzzz\n  Next: run stacks --help to list the commands, or stacks <command> --help for one.\n",
  );
  const json = await runCli(["zzzz", "--json"]);
  expect(json.status).toBe(2);
  expect(json.stdout).toBe("");
  expect(JSON.parse(json.stderr).error.details).toEqual({ command: "zzzz", suggestions: [] });
});
test("broken optional config does not break doctor, help or version", async () => {
  const home = configFile("{broken");
  for (const args of [["doctor", "--json"], ["--help"], ["--version"]]) {
    const result = await runCli(args, { home });
    expect(result.status).toBe(0);
    if (args[0] === "doctor")
      expect(JSON.parse(result.stdout).configErrors).toEqual(["Configuration is invalid."]);
  }
});
test("closed config rejects unknown fields and env overrides valid file values", async () => {
  const bad = configFile('{"unknown":true}');
  expect(
    JSON.parse((await runCli(["doctor", "--json"], { home: bad })).stdout).configErrors,
  ).toHaveLength(1);
  const home = configFile('{"dataDir":"/file-data"}');
  expect(
    JSON.parse(
      (
        await runCli(["doctor", "--json"], {
          home,
          env: { STACKS_DATA_DIR: "/env-data" },
        })
      ).stdout,
    ).paths.data,
  ).toBe("/env-data");
});
test("empty env values mean absent and invalid log level falls back safely", async () => {
  const result = await runCli(["doctor", "--json"], {
    env: { LOG_LEVEL: "bogus", STACKS_DATA_DIR: "" },
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).paths.data).toContain(".local/share/stacks");
  expect(result.stderr).toBe("");
});
test("paths follow the XDG base directories, and an unset HOME means the user's home", async () => {
  const paths = async (env: Record<string, string>) =>
    JSON.parse((await runCli(["doctor", "--json"], { env })).stdout).paths;
  expect(await paths({ XDG_DATA_HOME: "/xdg/data", XDG_CACHE_HOME: "/xdg/cache" })).toMatchObject({
    data: "/xdg/data/stacks",
    cache: "/xdg/cache/stacks",
  });
  expect(await paths({ HOME: "", XDG_CONFIG_HOME: "" })).toMatchObject({
    config: join(homedir(), ".config", "stacks", "config.json"),
    cache: join(homedir(), ".cache", "stacks"),
  });
});
test("--json after -- belongs to the command, not stacks", async () => {
  expect(hasFlag(["doctor", "--json"], "--json")).toBe(true);
  expect(hasFlag(["doctor", "--", "--json"], "--json")).toBe(false);
  const result = await runCli(["doctor", "--", "--json"]);
  expect(result.status).toBe(2);
  expect(result.stderr).toMatch(/^Invalid command\.\n/);
});
test("a defect's class and stack frames are logged, but not its message", async () => {
  const result = await runCli([], {
    program: Effect.die(new TypeError("private detail")),
    env: { LOG_LEVEL: "error", STACKS_LOG_FORMAT: "json" },
    host: terminal,
  });
  const line = result.stderr.split("\n").find((l) => l.includes('"msg":"command"'));
  const record = JSON.parse(line ?? "") as { defect: string };
  expect(record.defect).toMatch(/^TypeError\nat /);
  expect(result.stderr).not.toContain("private detail");
});
test("main maps a defect once and never leaks its object", async () => {
  const result = await runCli([], {
    program: Effect.die({ token: "secret-value", message: "private" }),
    env: { LOG_LEVEL: "info", STACKS_LOG_FORMAT: "json" },
    host: terminal,
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr.match(/"msg":"command"/g)).toHaveLength(1);
  expect(result.stderr).not.toContain("secret-value");
  expect(result.stderr).toContain("An unexpected error occurred.");
});

// Parser failures must preserve enough context to repair the invocation.
test.each([
  ["agents", "gemini", "claude, codex, opencode or cursor", []],
  ["agents", "codx", "claude, codex, opencode or cursor", ["codex"]],
  ["launch", "codx", "claude, codex, opencode, cursor, copilot, codex-app", ["codex"]],
  ["preset", "other", '"default" | "sandbox" | "lean"', []],
])(
  "invalid --%s value %s names the input and expectation in every audience",
  async (flag, value, expected, suggestions) => {
    const args = ["new", "go-cli", "app", `--${flag}`, value];
    const details = { flag: `--${flag}`, value, expected, command: "new", suggestions };
    const json = await runCli([...args, "--json"], { env: quiet });
    expect(json.status).toBe(2);
    expect(json.stdout).toBe("");
    expect(JSON.parse(json.stderr)).toEqual({
      error: {
        tag: "Usage",
        message: "Invalid command.",
        retryable: false,
        next: "pass a value from Expected; stacks new --help lists every flag.",
        details,
      },
    });
    for (const host of [{}, terminal]) {
      const text = await runCli(args, { env: quiet, host });
      expect(text.status).toBe(2);
      expect(text.stdout).toBe("");
      expect(text.stderr).toBe(
        [
          "Invalid command.",
          `  Flag: --${flag}`,
          `  Value: ${value}`,
          `  Expected: ${expected}`,
          ...(suggestions?.length ? [`  Did you mean: ${suggestions.join(", ")}?`] : []),
          "  Next: pass a value from Expected; stacks new --help lists every flag.",
          "",
        ].join("\n"),
      );
    }
  },
);
