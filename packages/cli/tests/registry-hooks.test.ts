// Behavior tests for the Claude Code hooks the bundled agent-ops fragment ships. Every hook runs as
// Claude Code runs it, `bash <script>` with the recorded payload on stdin, inside a project `new`
// actually wrote, under macOS's bash 3.2 where it is the system bash.
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism } from "node:os";
import { delimiter, join, relative } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type Entry, isRejected } from "../src/core/registry/entry";
import { Registry } from "../src/core/registry/registry";
import { quiet, runCli, tempDir } from "./helpers/cli";
import { gitShim, spawnGit } from "./helpers/git";

const registryRoot = join(import.meta.dirname, "..", "registry");
const agentOps = join(registryRoot, "fragments", "agent-ops", "adapters", "claude", ".claude");
const fixtures = join(import.meta.dirname, "fixtures", "hook-input");

const Payload = Schema.Record(Schema.String, Schema.Unknown);
const Recorded = Schema.Struct({
  recorded: Schema.String,
  "PreToolUse.Bash": Payload,
  "PreToolUse.Write": Payload,
  "PreToolUse.Edit": Payload,
  "PostToolUse.Write": Payload,
  Stop: Payload,
  SessionStart: Payload,
});
const Destructive = Schema.Struct({
  patterns: Schema.Array(
    Schema.Struct({
      pattern: Schema.String,
      blocked: Schema.Array(Schema.String),
      allowed: Schema.Array(Schema.String),
    }),
  ),
});
const Parts = Schema.Array(Schema.String);
const Secrets = Schema.Struct({
  shapes: Schema.Array(
    Schema.Struct({
      finding: Schema.String,
      blocked: Schema.Array(Parts),
      allowed: Schema.Array(Parts),
    }),
  ),
});
const Deny = Schema.Struct({
  hookSpecificOutput: Schema.Struct({
    hookEventName: Schema.Literals(["PreToolUse"]),
    permissionDecision: Schema.Literals(["deny"]),
    permissionDecisionReason: Schema.String,
  }),
});
const Context = Schema.Struct({
  hookSpecificOutput: Schema.Struct({
    hookEventName: Schema.Literals(["PostToolUse"]),
    additionalContext: Schema.String,
  }),
});
const HookGroup = Schema.Struct({
  matcher: Schema.optionalKey(Schema.String),
  hooks: Schema.Array(Schema.Struct({ type: Schema.String, command: Schema.String })),
});
const Settings = Schema.Struct({
  permissions: Schema.Struct({ deny: Schema.optionalKey(Schema.Array(Schema.String)) }),
  hooks: Schema.Record(Schema.String, Schema.Array(HookGroup)),
});

function fixture<S extends Schema.Top>(schema: S, name: string): S["Type"] {
  return Schema.decodeUnknownSync(schema as never)(
    JSON.parse(readFileSync(join(fixtures, name), "utf8")),
  ) as S["Type"];
}
const recorded = fixture(Recorded, "claude-code-2026-10-26.json");
const destructive = fixture(Destructive, "destructive-commands.json").patterns;
const secrets = fixture(Secrets, "secret-shapes.json").shapes;

const dirs: ReturnType<typeof tempDir>[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});
function temp() {
  const dir = tempDir();
  dirs.push(dir);
  return dir.path;
}

/** `new <stack> app --json` from the bundled registry, with only a git shim on PATH. */
async function scaffold(stack: string, withFragments: readonly string[] = []) {
  const home = temp();
  const bin = gitShim(
    home,
    [
      '  rev-parse) echo "fatal: not a git repository" >&2; exit 128 ;;',
      "  init) /bin/mkdir .git ;;",
      "  config) exit 0 ;;",
    ].join("\n"),
  );
  const result = await runCli(
    ["new", stack, "app", "--json", ...withFragments.flatMap((id) => ["--with", id])],
    { home, env: { ...quiet, PATH: bin }, host: { registry: registryRoot, cwd: home } },
  );
  expect({ stack, status: result.status, stderr: result.stderr }).toEqual({
    stack,
    status: 0,
    stderr: "",
  });
  return join(home, "app");
}

/** The bash the hooks are tested under: macOS's /bin/bash 3.x where it exists, else PATH's. */
function pickBash() {
  const system = spawnSync("/bin/bash", ["-c", 'echo "$BASH_VERSION"'], { encoding: "utf8" });
  if (system.status === 0 && system.stdout.startsWith("3.")) return "/bin/bash";
  return "bash";
}
const bash = pickBash();
const bashVersion = spawnSync(bash, ["-c", 'echo "$BASH_VERSION"'], {
  encoding: "utf8",
}).stdout.trim();

/** A PATH directory linking every command on this PATH except jq. */
function pathWithoutJq() {
  const bin = join(temp(), "no-jq-bin");
  mkdirSync(bin);
  // Tracked by name: existsSync follows links, so a dangling one on PATH would be linked twice.
  const linked = new Set<string>();
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name === "jq" || linked.has(name)) continue;
      linked.add(name);
      symlinkSync(join(dir, name), join(bin, name));
    }
  }
  return bin;
}
const withJq = process.env.PATH ?? "";
let withoutJq = "";

type Run = { status: number | null; stdout: string; stderr: string };
const hookEnv = (project: string, path: string) => ({
  PATH: path,
  HOME: project,
  CLAUDE_PROJECT_DIR: project,
  TMPDIR: join(project, "..", "tmp"),
});
function runHook(project: string, hook: string, payload: unknown, path = withJq): Run {
  const result = spawnSync(bash, [join(project, ".claude", "hooks", hook)], {
    cwd: project,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: hookEnv(project, path),
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
/** `runHook` without blocking, so independent hook calls can run side by side. */
function runHookAsync(project: string, hook: string, payload: unknown, path: string) {
  return new Promise<Run>((resolve, reject) => {
    const child = spawn(bash, [join(project, ".claude", "hooks", hook)], {
      cwd: project,
      env: hookEnv(project, path),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}
/** `work` over `items`, at most one per core at a time, results in input order. */
async function pooled<T, R>(items: readonly T[], work: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const at = next++;
      results[at] = await work(items[at] as T);
    }
  };
  await Promise.all(Array.from({ length: availableParallelism() }, worker));
  return results;
}

function bashPayload(project: string, command: string) {
  const base = recorded["PreToolUse.Bash"];
  return { ...base, cwd: project, tool_input: { ...(base.tool_input as object), command } };
}
function writePayload(project: string, file: string, content: string) {
  const base = recorded["PreToolUse.Write"];
  return { ...base, cwd: project, tool_input: { file_path: join(project, file), content } };
}
function editPayload(project: string, file: string, newString: string) {
  const base = recorded["PreToolUse.Edit"];
  return {
    ...base,
    cwd: project,
    tool_input: {
      ...(base.tool_input as object),
      file_path: join(project, file),
      new_string: newString,
    },
  };
}
function postWritePayload(project: string, file: string, session = "lint-session") {
  const base = recorded["PostToolUse.Write"];
  return {
    ...base,
    session_id: session,
    cwd: project,
    tool_input: { file_path: join(project, file), content: "" },
  };
}

/** The deny reason, after checking the response has Claude Code's documented shape. */
function denyReason(run: Run): string {
  expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 0, stderr: "" });
  return Schema.decodeUnknownSync(Deny)(JSON.parse(run.stdout)).hookSpecificOutput
    .permissionDecisionReason;
}
function allowed(run: Run) {
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}
const ALLOW = { status: 0, stdout: "", stderr: "" };

const secretLine = (secret: string) => `export const token = "${secret}";\n`;
const ENV_BLOCKED = [".env", ".env.local", ".env.production", "apps/web/.env"];
const ENV_ALLOWED = [".env.example"];

/** Every guard case as one hook call: the destructive commands, the secret shapes, .env writes. */
function guardCases(project: string) {
  return [
    ...destructive.flatMap(({ blocked, allowed }) =>
      [...blocked, ...allowed].map((command) => ({
        hook: "block-destructive.sh",
        payload: bashPayload(project, command),
      })),
    ),
    ...secrets.flatMap(({ blocked, allowed }) =>
      [...blocked, ...allowed].map((parts) => ({
        hook: "detect-secrets.sh",
        payload: writePayload(project, "src/config.ts", secretLine(parts.join(""))),
      })),
    ),
    ...[...ENV_BLOCKED, ...ENV_ALLOWED].map((file) => ({
      hook: "detect-secrets.sh",
      payload: writePayload(project, file, "API_KEY=\n"),
    })),
  ];
}

let astro = "";
beforeAll(async () => {
  console.info(`agent-ops hooks run under ${bash} (bash ${bashVersion})`);
  withoutJq = pathWithoutJq();
  astro = await scaffold("astro-blog");
}, 30_000);

describe("the guards block every listed pattern and allow its near miss [1.6d#1]", () => {
  // Concurrent: each case is its own bash process reading only its payload.
  test.concurrent.each(destructive)(
    "block-destructive.sh: $pattern [1.6d#1]",
    async ({ blocked, allowed: ok }) => {
      for (const command of blocked) {
        const reason = denyReason(
          await runHookAsync(astro, "block-destructive.sh", bashPayload(astro, command), withJq),
        );
        expect({ command, blocked: reason.startsWith("BLOCKED: ") }).toEqual({
          command,
          blocked: true,
        });
        expect(reason).toContain("Never work around this block.");
      }
      for (const command of ok)
        expect({
          command,
          ...allowed(
            await runHookAsync(astro, "block-destructive.sh", bashPayload(astro, command), withJq),
          ),
        }).toEqual({ command, ...ALLOW });
    },
  );

  test.concurrent.each(secrets)(
    "detect-secrets.sh: $finding, named without the matched text [1.6d#1]",
    async ({ finding, blocked, allowed: ok }) => {
      for (const parts of blocked) {
        const secret = parts.join("");
        for (const payload of [
          writePayload(astro, "src/config.ts", secretLine(secret)),
          editPayload(astro, "src/config.ts", secretLine(secret)),
        ]) {
          const reason = denyReason(
            await runHookAsync(astro, "detect-secrets.sh", payload, withJq),
          );
          expect(reason).toContain(`- ${finding}`);
          expect(reason).not.toContain(secret);
          expect(reason).not.toContain(parts[1]);
        }
      }
      for (const parts of ok)
        expect({
          parts,
          ...allowed(
            await runHookAsync(
              astro,
              "detect-secrets.sh",
              writePayload(astro, "src/config.ts", secretLine(parts.join(""))),
              withJq,
            ),
          ),
        }).toEqual({ parts, ...ALLOW });
    },
  );

  test("detect-secrets.sh denies writes and edits to .env files and allows .env.example [1.6d#1]", () => {
    for (const file of ENV_BLOCKED)
      for (const payload of [
        writePayload(astro, file, "API_KEY=live-value\n"),
        editPayload(astro, file, "API_KEY=live-value"),
      ]) {
        const reason = denyReason(runHook(astro, "detect-secrets.sh", payload));
        expect(reason).toContain("holds real credentials");
        expect(reason).not.toContain("live-value");
      }
    for (const file of ENV_ALLOWED)
      expect({
        file,
        ...allowed(runHook(astro, "detect-secrets.sh", writePayload(astro, file, "API_KEY=\n"))),
      }).toEqual({ file, ...ALLOW });
  });

  test("a guard's deny reason survives quotes, backslashes and newlines in the payload [1.6d#1]", () => {
    const command = 'echo "a\\b"\nrm -rf "$HOME"';
    const reason = denyReason(runHook(astro, "block-destructive.sh", bashPayload(astro, command)));
    expect(reason).toMatch(/^BLOCKED: rm targeting/);
  });
});

/**
 * Shell constructs bash 3.2 lacks. Commands and operators are matched against the script with its
 * comments and every quoted string removed (a regex in a string isn't code); expansions are
 * matched with double-quoted strings kept, since bash expands those.
 */
const BASH4 = [
  ["declare -A / -n", /\b(declare|typeset|local)\s+-[a-zA-Z]*[An]\b/, "code"],
  ["mapfile", /\bmapfile\b/, "code"],
  ["readarray", /\breadarray\b/, "code"],
  ["case modification", /\$\{[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?(,,?|\^\^?)[^}]*\}/, "expanded"],
  ["parameter transformation", /\$\{[^}]*@[QEPAaKk]\}/, "expanded"],
  ["|&", /\|&/, "code"],
  [";& or ;;&", /;;?&/, "code"],
  ["&>>", /&>>/, "code"],
  ["coproc", /\bcoproc\b/, "code"],
] as const;

type ShellText = { out: string; quote: string | undefined };

function quotedCharacter(source: string, i: number, text: ShellText, keepDouble: boolean) {
  const c = source[i];
  if (text.quote === "'") {
    if (c === "'") text.quote = undefined;
    return i;
  }
  if (keepDouble) text.out += c;
  if (c === "\\") {
    i++;
    if (keepDouble) text.out += source[i] ?? "";
  } else if (c === '"') text.quote = undefined;
  return i;
}

function unquotedCharacter(source: string, i: number, text: ShellText) {
  const c = source[i] as string;
  if (c === "\\") return i + 1;
  if (c === "'" || c === '"') {
    text.quote = c;
    text.out += " ";
    return i;
  }
  if (c === "#" && (i === 0 || /\s/.test(source[i - 1] as string))) {
    while (i < source.length && source[i] !== "\n") i++;
    text.out += "\n";
    return i;
  }
  text.out += c;
  return i;
}

/** The script without comments and single-quoted strings, and without double-quoted ones unless `keepDouble`. */
function unquoted(source: string, keepDouble: boolean): string {
  const text: ShellText = { out: "", quote: undefined };
  for (let i = 0; i < source.length; i++) {
    if (text.quote !== undefined) i = quotedCharacter(source, i, text, keepDouble);
    else i = unquotedCharacter(source, i, text);
  }
  return text.out;
}
function bash4Constructs(source: string): string[] {
  const views = { code: unquoted(source, false), expanded: unquoted(source, true) };
  return BASH4.filter(([, pattern, view]) => pattern.test(views[view])).map(([name]) => name);
}

function shippedScripts(): string[] {
  return readdirSync(registryRoot, { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile() && item.name.endsWith(".sh"))
    .map((item) => join(item.parentPath, item.name))
    .sort();
}

describe("the hooks run on bash 3.2 [1.6d#2]", () => {
  // macOS's /bin/bash is 3.2; elsewhere this runs under PATH's bash.
  test("every agent-ops hook runs clean under the system bash (macOS) [1.6d#2]", () => {
    if (process.platform === "darwin") {
      expect(bash).toBe("/bin/bash");
      expect(bashVersion).toMatch(/^3\./);
    }
    const project = astro;
    const runs = {
      "session-start.sh": runHook(project, "session-start.sh", recorded.SessionStart),
      "block-destructive.sh": runHook(project, "block-destructive.sh", bashPayload(project, "ls")),
      "detect-secrets.sh": runHook(
        project,
        "detect-secrets.sh",
        writePayload(project, "src/a.ts", "export const a = 1;\n"),
      ),
      "lint-on-write.sh": runHook(
        project,
        "lint-on-write.sh",
        postWritePayload(project, "README.md"),
      ),
      "format-changed.sh": runHook(project, "format-changed.sh", recorded.Stop),
    };
    for (const [hook, run] of Object.entries(runs))
      expect({ hook, status: run.status, stderr: run.stderr }).toEqual({
        hook,
        status: 0,
        stderr: "",
      });
  });

  test("no shipped shell script uses a bash 4 construct [1.6d#2]", () => {
    const scripts = shippedScripts();
    expect(scripts.length).toBeGreaterThanOrEqual(7);
    for (const script of scripts)
      expect({
        script: relative(registryRoot, script),
        found: bash4Constructs(readFileSync(script, "utf8")),
      }).toEqual({ script: relative(registryRoot, script), found: [] });
  });

  test("the bash 4 check finds each construct in code and ignores it in quotes and comments [1.6d#2]", () => {
    const probes = [
      "declare -A seen=()",
      "local -n ref=x",
      "mapfile -t lines < f",
      "readarray lines < f",
      `echo "\${name,,}"`,
      `echo \${name^^}`,
      `echo "\${name@Q}"`,
      "make |& tee log",
      "case $x in a) echo ;& b) echo ;; esac",
      "case $x in a) echo ;;& esac",
      "make &>> log",
      "coproc cat",
    ];
    for (const probe of probes)
      expect({ probe, found: bash4Constructs(probe).length > 0 }).toEqual({ probe, found: true });
    for (const quiet of ["# mapfile in a comment", "grep -E '(;|&|\\||$)' f", 'm "x|&y"'])
      expect({ quiet, found: bash4Constructs(quiet) }).toEqual({ quiet, found: [] });
  });
});

describe("the hooks decide the same with and without jq [1.6d#3]", () => {
  test("the PATH without jq has no jq and the default PATH has one [1.6d#3]", () => {
    const probe = (path: string) =>
      spawnSync("/bin/sh", ["-c", "command -v jq"], { env: { PATH: path } }).status;
    expect(probe(withJq)).toBe(0);
    expect(probe(withoutJq)).not.toBe(0);
  });

  test("every guard case gives the same response with and without jq [1.6d#3]", async () => {
    const cases = guardCases(astro);
    const runs = await pooled(
      cases.flatMap(({ hook, payload }) =>
        [withoutJq, withJq].map((path) => ({ hook, payload, path })),
      ),
      ({ hook, payload, path }) => runHookAsync(astro, hook, payload, path),
    );
    cases.forEach(({ payload }, at) => {
      const input = (payload.tool_input as Record<string, unknown>) ?? {};
      expect({ input, ...runs[2 * at] }).toEqual({ input, ...runs[2 * at + 1] });
    });
  }, 60_000);

  test("lint-on-write.sh, format-changed.sh and session-start.sh give the same output and record the same files [1.6d#3]", async () => {
    const outputs: Run[][] = [];
    for (const path of [withJq, withoutJq]) {
      const project = await scaffold("astro-blog");
      fakeBiome(project, 3);
      writeFileSync(join(project, "src.ts"), "export const a = 1;\n");
      const lint = runHook(project, "lint-on-write.sh", postWritePayload(project, "src.ts"), path);
      const stop = runHook(
        project,
        "format-changed.sh",
        { ...recorded.Stop, session_id: "lint-session" },
        path,
      );
      const start = runHook(project, "session-start.sh", recorded.SessionStart, path);
      // The project path differs between the two runs; the rest must not.
      const strip = (run: Run) => ({ ...run, stdout: run.stdout.replaceAll(project, "<project>") });
      outputs.push([lint, stop, start].map(strip));
      expect(readFileSync(join(project, "biome-calls"), "utf8").trim().split("\n")).toEqual([
        "lint",
        "check --write",
      ]);
    }
    expect(outputs[1]).toEqual(outputs[0]);
    const [lint, stop, start] = outputs[0] as Run[];
    expect(
      Schema.decodeUnknownSync(Context)(JSON.parse(lint?.stdout ?? "")).hookSpecificOutput
        .additionalContext,
    ).toContain("biome lint found issues in src.ts");
    expect(stop).toEqual(ALLOW);
    expect(start?.stdout).toContain("read .stacks/BRIEF.md");
  }, 30_000);

  test("the awk reader handles escapes, nesting and a key named like the one it wants inside a value [1.6d#3]", () => {
    const payload = {
      ...recorded["PreToolUse.Write"],
      tool_input: {
        file_path: join(astro, "src/config.ts"),
        content: `const note = "\\"command\\": \\"x\\"";\n\ttabbed\u0001 ${["AKIA", "Q3EGRZ7NB2KXMW4P"].join("")}\n`,
        nested: { content: "not this one" },
      },
    };
    const reasons = [withJq, withoutJq].map((path) =>
      denyReason(runHook(astro, "detect-secrets.sh", payload, path)),
    );
    expect(reasons[1]).toBe(reasons[0]);
    expect(reasons[0]).toContain("- AWS access key ID");
  });
});

/** Optional fragments of each bundled stack, so a composition takes in every settings merger. */
const catalog = (
  await Effect.runPromise(
    Effect.flatMap(Registry, (registry) => registry.all).pipe(
      Effect.provide(Registry.layer([{ origin: "bundled", path: registryRoot }])),
      Effect.provide(NodeServices.layer),
    ),
  )
).filter((item): item is Entry => !isRejected(item));
const stacks = catalog.flatMap((entry) =>
  entry.meta.kind === "stack" ? [{ id: entry.id, optional: entry.meta.fragments.optional }] : [],
);
const agentOpsSettings = Schema.decodeUnknownSync(Settings)(
  JSON.parse(readFileSync(join(agentOps, "settings.json"), "utf8")),
);
const agentOpsCommands = Object.values(agentOpsSettings.hooks).flatMap((groups) =>
  groups.flatMap((group) => group.hooks.map((hook) => hook.command)),
);
const SCRIPT = /\.claude\/hooks\/([^"/]+)"/;

describe("composed settings wire each hook once [1.6d#4] [1.6d#5]", () => {
  test("agent-ops wires its five hooks", () => {
    expect(agentOpsCommands.map((command) => SCRIPT.exec(command)?.[1]).sort()).toEqual([
      "block-destructive.sh",
      "detect-secrets.sh",
      "format-changed.sh",
      "lint-on-write.sh",
      "session-start.sh",
    ]);
  });

  test("agent-ops denies reading each real .env file and leaves the templates readable [1.6d#4]", () => {
    const reads = (agentOpsSettings.permissions.deny ?? []).filter((rule) =>
      rule.startsWith("Read("),
    );
    expect(reads.sort()).toEqual(
      [
        "Read(./.env)",
        "Read(./.env.local)",
        "Read(./.env.*.local)",
        "Read(./.env.development)",
        "Read(./.env.test)",
        "Read(./.env.staging)",
        "Read(./.env.production)",
        "Read(./.envrc)",
        "Read(./**/.env)",
        "Read(./**/.env.local)",
        "Read(./**/.env.*.local)",
        "Read(./**/.env.production)",
        "Read(./**/.envrc)",
      ].sort(),
    );
  });

  test.each(stacks)(
    "new $id with every optional fragment: each hook command and deny rule appears once, and every hook script is executable [1.6d#4] [1.6d#5]",
    async ({ id, optional }) => {
      const project = await scaffold(id, optional);
      const settings = Schema.decodeUnknownSync(Settings)(
        JSON.parse(readFileSync(join(project, ".claude", "settings.json"), "utf8")),
      );
      const commands = Object.values(settings.hooks).flatMap((groups) =>
        groups.flatMap((group) => group.hooks.map((hook) => hook.command)),
      );
      expect(commands).toEqual([...new Set(commands)]);
      for (const command of agentOpsCommands)
        expect({ command, count: commands.filter((item) => item === command).length }).toEqual({
          command,
          count: 1,
        });
      // Two fragments wiring the same hook in different languages (guard-x.sh and guard-x.ts).
      const stems = commands.map((command) => SCRIPT.exec(command)?.[1]?.replace(/\.[^.]+$/, ""));
      expect(stems).toEqual([...new Set(stems)]);
      const deny = settings.permissions.deny ?? [];
      expect(deny).toEqual([...new Set(deny)]);
      for (const rule of agentOpsSettings.permissions.deny ?? []) expect(deny).toContain(rule);
      // Every wired script was written, and every shell hook is executable.
      for (const command of commands) {
        const script = SCRIPT.exec(command)?.[1];
        expect({
          command,
          exists: script !== undefined && existsSync(join(project, ".claude", "hooks", script)),
        }).toEqual({ command, exists: true });
      }
      const hooksDir = join(project, ".claude", "hooks");
      for (const name of readdirSync(hooksDir).filter((item) => item.endsWith(".sh")))
        expect({
          name,
          executable: (statSync(join(hooksDir, name)).mode & 0o111) === 0o111,
        }).toEqual({
          name,
          executable: true,
        });
    },
    30_000,
  );

  // The modes live in the git index, so this needs a checkout: local runs and CI have one, a tree
  // rr synced to a test host (without .git) doesn't.
  const inCheckout =
    spawnGit(["rev-parse", "--is-inside-work-tree"], { cwd: registryRoot }).status === 0;
  test.skipIf(!inCheckout)("git records every shipped shell script as executable [1.6d#5]", () => {
    const listed = spawnGit(["ls-files", "-s", "--", "*.sh"], {
      cwd: registryRoot,
      encoding: "utf8",
    });
    expect(listed.status).toBe(0);
    const modes = String(listed.stdout)
      .trim()
      .split("\n")
      .map((line) => {
        const [mode = "", , , path = ""] = line.split(/\s+/);
        return { path, mode };
      });
    expect(modes.map(({ path }) => join(registryRoot, path)).sort()).toEqual(shippedScripts());
    for (const entry of modes) expect(entry).toEqual({ path: entry.path, mode: "100755" });
  });
});

/** A biome in the project's node_modules that logs each call and fails with `lines` of output. */
function fakeBiome(project: string, lines: number) {
  writeFileSync(join(project, "biome.json"), "{}\n");
  const bin = join(project, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "biome"),
    [
      "#!/bin/sh",
      `printf '%s\\n' "$1 $2" | sed 's/ $//; s/ --colors=off.*//; s/ ${"\\/"}.*//' >> "${join(project, "biome-calls")}"`,
      `i=0; while [ "$i" -lt ${lines} ]; do echo "src.ts:$i lint/style: issue $i"; i=$((i + 1)); done`,
      "exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "biome"), 0o755);
}

describe("advisory hooks never get in the way [1.6d#6]", () => {
  test("lint-on-write.sh with no linter for the file exits 0 silently [1.6d#6]", async () => {
    const project = await scaffold("astro-blog");
    for (const file of ["src/util.ts", "src/pages/index.astro", "README.md"]) {
      mkdirSync(join(project, file, ".."), { recursive: true });
      writeFileSync(join(project, file), "export const a = 1;\n");
      expect({
        file,
        ...allowed(runHook(project, "lint-on-write.sh", postWritePayload(project, file))),
      }).toEqual({ file, ...ALLOW });
    }
  });

  test("format-changed.sh exits 0 with no output when the formatter fails [1.6d#6]", async () => {
    const project = await scaffold("astro-blog");
    fakeBiome(project, 5);
    writeFileSync(join(project, "src.ts"), "export const a = 1;\n");
    runHook(project, "lint-on-write.sh", postWritePayload(project, "src.ts", "format-session"));
    const stop = runHook(project, "format-changed.sh", {
      ...recorded.Stop,
      session_id: "format-session",
    });
    expect(allowed(stop)).toEqual(ALLOW);
    // The formatter did run, and failed.
    expect(readFileSync(join(project, "biome-calls"), "utf8")).toContain("check --write");
  });

  test("lint-on-write.sh caps the diagnostics it returns at 60 lines [1.6d#6]", async () => {
    const project = await scaffold("astro-blog");
    // One line over the cap exercises truncation without encoding 200 lines in bash 3.2.
    fakeBiome(project, 61);
    writeFileSync(join(project, "src.ts"), "export const a = 1;\n");
    const run = runHook(project, "lint-on-write.sh", postWritePayload(project, "src.ts"));
    expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 0, stderr: "" });
    const context = Schema.decodeUnknownSync(Context)(JSON.parse(run.stdout)).hookSpecificOutput
      .additionalContext;
    const lines = context.split("\n");
    expect(lines.length).toBe(62);
    expect(lines.at(-1)).toContain("truncated");
  });

  test("session-start.sh prints at most 15 lines [1.6d#6]", () => {
    const run = runHook(astro, "session-start.sh", recorded.SessionStart);
    expect(run.status).toBe(0);
    expect(run.stdout.trim().split("\n").length).toBeLessThanOrEqual(15);
  });
});
