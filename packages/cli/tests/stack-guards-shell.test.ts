import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { describe, expect, test } from "vitest";
import { tempDir } from "./helpers/cli";

const registry = join(import.meta.dirname, "..", "registry", "stacks");
const recorded = Schema.decodeUnknownSync(
  Schema.Struct({
    "PreToolUse.Bash": Schema.Record(Schema.String, Schema.Unknown),
    "PreToolUse.Write": Schema.Record(Schema.String, Schema.Unknown),
  }),
)(
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "fixtures", "hook-input", "claude-code-2026-10-26.json"),
      "utf8",
    ),
  ),
);
const decision = Schema.decodeUnknownSync(
  Schema.Struct({
    hookSpecificOutput: Schema.Struct({
      hookEventName: Schema.Literal("PreToolUse"),
      permissionDecision: Schema.Literal("deny"),
      permissionDecisionReason: Schema.String,
    }),
  }),
);
const settings = Schema.decodeUnknownSync(
  Schema.Struct({
    hooks: Schema.Struct({
      PreToolUse: Schema.Array(
        Schema.Struct({ hooks: Schema.Array(Schema.Struct({ command: Schema.String })) }),
      ),
    }),
  }),
);

const guards = [
  {
    stack: "go-library",
    hook: "guard-library.sh",
    deny: "go test -fuzz FuzzParse",
    allow: "go test -fuzz FuzzParse -fuzztime 10s",
    convention: "go get -tool example.com/tool",
    file: "api/baseline.export",
    reason: "-fuzztime",
  },
  {
    stack: "go-mcp",
    hook: "guard-mcp.sh",
    deny: "npx @modelcontextprotocol/inspector ./bin/server",
    allow: "npx @modelcontextprotocol/inspector --cli ./bin/server",
    convention: "go get github.com/mark3labs/mcp-go",
    file: "go.mod",
    reason: "--cli",
  },
  {
    stack: "go-tui",
    hook: "guard-tui.sh",
    deny: "script -q /dev/null ./bin/app",
    allow: "go test ./...",
    convention: "make golden",
    file: "internal/ui/testdata/frame.golden",
    reason: "make test",
  },
  {
    stack: "java-library",
    hook: "guard-maven.sh",
    deny: "./mvnw deploy",
    allow: "./mvnw install",
    convention: "mvn test",
    file: "api/baseline.jar",
    reason: "ask the user first",
  },
  {
    stack: "python-data",
    hook: "guard-python-data.sh",
    deny: "uv run marimo edit notebooks/report.py",
    allow: "uv run marimo export html notebooks/report.py",
    convention: "pip install polars",
    file: "data/raw/orders.csv",
    reason: "make notebooks",
  },
  {
    stack: "quarkus-api",
    hook: "guard-maven.sh",
    deny: "./mvnw quarkus:dev",
    allow: "./mvnw test",
    convention: "mvn test",
    file: "target/output.txt",
    reason: "make test",
  },
  {
    stack: "rust-tui",
    hook: "guard-tui.sh",
    deny: "script -q /dev/null cargo run",
    allow: "cargo test",
    convention: "make snapshots",
    file: "src/snapshots/frame.snap",
    reason: "make test",
  },
  {
    stack: "rust-wasm",
    hook: "guard-rust-wasm.sh",
    deny: "wasm-pack publish",
    allow: "wasm-pack pack",
    convention: "wasm-pack login",
    file: "pkg/index.js",
    reason: "ask the user first",
  },
  {
    stack: "spring-boot-api",
    hook: "guard-maven.sh",
    deny: "./mvnw spring-boot:run",
    allow: "./mvnw test",
    convention: "mvn test",
    file: "target/output.txt",
    reason: "background",
  },
  {
    stack: "spring-boot-web",
    hook: "guard-spring-web.sh",
    deny: "./mvnw spring-boot:run",
    allow: "./mvnw test",
    convention: "bun install",
    file: "package.json",
    reason: "background",
  },
  {
    stack: "streamlit",
    hook: "guard-streamlit.sh",
    deny: "uv run streamlit run app.py",
    allow: "uv run streamlit cache clear",
    convention: "pip install polars",
    file: "uv.lock",
    reason: "make test",
  },
];

function runHook(stack: string, hook: string, input: string, path = process.env.PATH) {
  const result = spawnSync(
    "/bin/bash",
    [join(registry, stack, "adapters", "claude", ".claude", "hooks", hook)],
    {
      input,
      encoding: "utf8",
      env: { PATH: path, CLAUDE_PROJECT_DIR: "/project" },
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  return { stdout: result.stdout, stderr: result.stderr };
}

function bashPayload(command: string) {
  return JSON.stringify({ ...recorded["PreToolUse.Bash"], tool_input: { command } });
}

describe.each(guards)("$stack/$hook", ({ stack, hook, deny, allow, convention, file, reason }) => {
  test("denies the unsafe command with an actionable alternative", () => {
    const result = runHook(stack, hook, bashPayload(deny));
    expect(result.stderr).toBe("");
    expect(
      decision(JSON.parse(result.stdout)).hookSpecificOutput.permissionDecisionReason,
    ).toContain(reason);
  });

  test("allows a nearby non-blocking command", () => {
    expect(runHook(stack, hook, bashPayload(allow))).toEqual({ stdout: "", stderr: "" });
  });

  test("allows convention commands and generated-file edits", () => {
    expect(runHook(stack, hook, bashPayload(convention))).toEqual({ stdout: "", stderr: "" });
    const input = JSON.stringify({
      ...recorded["PreToolUse.Write"],
      tool_input: { file_path: `/project/${file}`, content: "updated\n" },
    });
    expect(runHook(stack, hook, input)).toEqual({ stdout: "", stderr: "" });
  });

  test("allows malformed payloads with one note", () => {
    const result = runHook(stack, hook, "{invalid");
    expect(result.stdout).toBe("");
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr).toContain("allowing");
  });

  test("allows calls without jq with one note", () => {
    const result = runHook(stack, hook, bashPayload(deny), "");
    expect(result.stdout).toBe("");
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr).toContain("jq");
    expect(result.stderr).toContain("allowing");
  });

  test("allows an invalid command type with one note", () => {
    const result = runHook(stack, hook, JSON.stringify({ tool_input: { command: {} } }));
    expect(result.stdout).toBe("");
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr).toContain("allowing");
  });

  test("the wired wrapper allows calls when its script is missing", () => {
    const project = tempDir();
    try {
      const config = settings(
        JSON.parse(
          readFileSync(
            join(registry, stack, "adapters", "claude", ".claude", "settings.json"),
            "utf8",
          ),
        ),
      );
      expect(config.hooks.PreToolUse).toHaveLength(1);
      for (const group of config.hooks.PreToolUse) {
        expect(group.hooks).toHaveLength(1);
        for (const wired of group.hooks) {
          const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", wired.command], {
            input: bashPayload(deny),
            encoding: "utf8",
            env: { PATH: process.env.PATH, HOME: project.path, CLAUDE_PROJECT_DIR: project.path },
          });
          expect(result.status).toBe(0);
          expect(result.stdout).toBe("");
          expect(result.stderr.trim().split("\n"), result.stderr).toHaveLength(1);
          expect(result.stderr).toContain("allowing");
          expect(result.stderr.endsWith("\n")).toBe(true);
        }
      }
    } finally {
      project.cleanup();
    }
  });
});

test.each(guards.filter(({ stack }) => stack !== "java-library" && stack !== "rust-wasm"))(
  "$stack allows detached and time-limited commands",
  ({ stack, hook, deny }) => {
    for (const command of [
      `${deny} &`,
      `${deny} &  `,
      `timeout 5 ${deny}`,
      `timeout 0.5 ${deny}`,
    ]) {
      expect(runHook(stack, hook, bashPayload(command))).toEqual({ stdout: "", stderr: "" });
    }
  },
);

test.each(guards.filter(({ stack }) => stack !== "java-library" && stack !== "rust-wasm"))(
  "$stack still denies an unbounded timeout",
  ({ stack, hook, deny }) => {
    for (const limit of ["0", "0s", "0.0"]) {
      const result = runHook(stack, hook, bashPayload(`timeout ${limit} ${deny}`));
      expect(result.stderr).toBe("");
      expect(decision(JSON.parse(result.stdout)).hookSpecificOutput.permissionDecision).toBe(
        "deny",
      );
    }
  },
);

test.each([
  { stack: "java-library", hook: "guard-maven.sh", command: "echo './mvnw deploy'" },
  { stack: "java-library", hook: "guard-maven.sh", command: "./mvnw gpg:sign" },
  { stack: "rust-wasm", hook: "guard-rust-wasm.sh", command: "git commit -m 'wasm-pack publish'" },
  { stack: "rust-wasm", hook: "guard-rust-wasm.sh", command: "bun test" },
  { stack: "go-mcp", hook: "guard-mcp.sh", command: "cat request.json | ./bin/server" },
  { stack: "go-library", hook: "guard-library.sh", command: "make api-baseline" },
  { stack: "go-tui", hook: "guard-tui.sh", command: "tmux list-sessions" },
  { stack: "go-tui", hook: "guard-tui.sh", command: "unbuffer go test ./..." },
  { stack: "go-tui", hook: "guard-tui.sh", command: "script -q /dev/null ./bin/app --no-tui" },
  { stack: "rust-tui", hook: "guard-tui.sh", command: "tmux list-sessions" },
  { stack: "rust-tui", hook: "guard-tui.sh", command: "unbuffer cargo test" },
  { stack: "rust-tui", hook: "guard-tui.sh", command: "script -q /dev/null cargo run -- --json" },
  { stack: "go-mcp", hook: "guard-mcp.sh", command: "echo '@modelcontextprotocol/inspector'" },
  { stack: "go-mcp", hook: "guard-mcp.sh", command: "npx @modelcontextprotocol/inspector --help" },
])("$stack permits $command", ({ stack, hook, command }) => {
  expect(runHook(stack, hook, bashPayload(command))).toEqual({ stdout: "", stderr: "" });
});

test.each([
  {
    stack: "go-library",
    hook: "guard-library.sh",
    command: "echo 'example; go test -fuzz FuzzParse'",
  },
  { stack: "go-tui", hook: "guard-tui.sh", command: "script -q /dev/null ./bin/app --json=true" },
  { stack: "go-tui", hook: "guard-tui.sh", command: "tmux new-session -d ./bin/app" },
  { stack: "rust-tui", hook: "guard-tui.sh", command: "tmux new-session -d cargo run" },
  { stack: "rust-tui", hook: "guard-tui.sh", command: "script -q /dev/null 'cargo run -- --json'" },
  {
    stack: "python-data",
    hook: "guard-python-data.sh",
    command: "uv run marimo edit notebooks/report.py --help",
  },
  { stack: "streamlit", hook: "guard-streamlit.sh", command: "uv run streamlit run --help" },
  { stack: "quarkus-api", hook: "guard-maven.sh", command: "grep quarkus:dev README.md" },
  { stack: "spring-boot-api", hook: "guard-maven.sh", command: "grep spring-boot:run README.md" },
  {
    stack: "spring-boot-web",
    hook: "guard-spring-web.sh",
    command: "grep spring-boot:run README.md",
  },
])("$stack allows the review near miss $command", ({ stack, hook, command }) => {
  expect(runHook(stack, hook, bashPayload(command))).toEqual({ stdout: "", stderr: "" });
});

test.each(guards.filter(({ stack }) => stack !== "java-library" && stack !== "rust-wasm"))(
  "$stack checks deadlines and backgrounding on the corresponding command",
  ({ stack, hook, deny }) => {
    for (const command of [`${deny}; true &`, `timeout 5 true; ${deny}`]) {
      const result = runHook(stack, hook, bashPayload(command));
      expect(result.stderr).toBe("");
      expect(decision(JSON.parse(result.stdout)).hookSpecificOutput.permissionDecision).toBe(
        "deny",
      );
    }
  },
);

test.each([
  {
    stack: "go-mcp",
    hook: "guard-mcp.sh",
    command: "command npx @modelcontextprotocol/inspector ./bin/server",
  },
  {
    stack: "go-mcp",
    hook: "guard-mcp.sh",
    command: "npx @modelcontextprotocol/inspector ./bin/server; echo --cli",
  },
  {
    stack: "go-tui",
    hook: "guard-tui.sh",
    command: "go run . --help; script -q /dev/null ./bin/app",
  },
  { stack: "rust-tui", hook: "guard-tui.sh", command: "script -q /dev/null cargo +nightly run" },
  {
    stack: "java-library",
    hook: "guard-maven.sh",
    command: './mvnw deploy -DaltDeploymentRepository="releases::https://repo.invalid"',
  },
  { stack: "java-library", hook: "guard-maven.sh", command: "command ./mvnw deploy" },
  { stack: "java-library", hook: "guard-maven.sh", command: "./m\\vnw deploy" },
  { stack: "rust-wasm", hook: "guard-rust-wasm.sh", command: 'wasm-pack publish --tag "beta"' },
  { stack: "rust-wasm", hook: "guard-rust-wasm.sh", command: 'echo "starting"; wasm-pack publish' },
  {
    stack: "rust-wasm",
    hook: "guard-rust-wasm.sh",
    command: "command /usr/local/bin/wasm-pack publish",
  },
  { stack: "quarkus-api", hook: "guard-maven.sh", command: "sh -c './mvnw quarkus:dev'" },
  { stack: "spring-boot-api", hook: "guard-maven.sh", command: "sh -c './mvnw spring-boot:run'" },
  {
    stack: "spring-boot-web",
    hook: "guard-spring-web.sh",
    command: "sh -c './mvnw spring-boot:run'",
  },
])("$stack denies the review command $command", ({ stack, hook, command }) => {
  const result = runHook(stack, hook, bashPayload(command));
  expect(result.stderr).toBe("");
  expect(decision(JSON.parse(result.stdout)).hookSpecificOutput.permissionDecision).toBe("deny");
});

test.each(guards)("$stack recognizes wrapped executable commands", ({ stack, hook, deny }) => {
  const [program, ...args] = deny.split(" ");
  if (program === undefined) throw new Error("The deny fixture must name a program.");
  for (const command of [
    `command ${deny}`,
    `env FOO=1 ${deny}`,
    `exec ${deny}`,
    `nice -n 5 ${deny}`,
    `sudo ${deny}`,
    `busybox ${deny}`,
    `bash -c '${deny}'`,
    `"${program}" ${args.join(" ")}`,
    `$'${program}' ${args.join(" ")}`,
    `${program.slice(0, 1)}\\${program.slice(1)} ${args.join(" ")}`,
  ]) {
    const result = runHook(stack, hook, bashPayload(command));
    expect(result.stderr, command).toBe("");
    expect(decision(JSON.parse(result.stdout)).hookSpecificOutput.permissionDecision, command).toBe(
      "deny",
    );
  }
});

test.each(guards.filter(({ stack }) => stack === "java-library" || stack === "rust-wasm"))(
  "$stack publishing remains irreversible when detached or time-limited",
  ({ stack, hook, deny }) => {
    for (const command of [`${deny} &`, `timeout 5 ${deny}`]) {
      const result = runHook(stack, hook, bashPayload(command));
      expect(result.stderr).toBe("");
      expect(decision(JSON.parse(result.stdout)).hookSpecificOutput.permissionDecision).toBe(
        "deny",
      );
    }
  },
);

test.each(guards)("$stack permits multiline quoted examples", ({ stack, hook, deny }) => {
  expect(runHook(stack, hook, bashPayload(`git commit -m 'example:\n${deny}\nend'`))).toEqual({
    stdout: "",
    stderr: "",
  });
});
