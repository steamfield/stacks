import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { compose } from "../src/core/compose/compose";
import { composeFiles, NEUTRAL_VARS } from "../src/core/compose/files";
import { Registry } from "../src/core/registry/registry";

const registry = join(import.meta.dirname, "../registry");
const agents = ["claude", "codex", "cursor", "opencode"] as const;
type Agent = (typeof agents)[number];
const Command = Schema.Struct({ command: Schema.String });
const Settings = Schema.Struct({
  hooks: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Array(Schema.Struct({ hooks: Schema.Array(Command) }))),
  ),
});
const CursorSettings = Schema.Struct({
  hooks: Schema.Record(Schema.String, Schema.Array(Command)),
});
type Hook = {
  owner: string;
  agent: Agent;
  event: string;
  command: string;
  script: string;
  name: string;
  body: string;
};
const started = performance.now();
const fragmentRoots = readdirSync(join(registry, "fragments")).map((name) =>
  join(registry, "fragments", name),
);
const configs = readdirSync(registry, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name))
  .filter((path) =>
    /\/adapters\/(?:claude\/\.claude\/settings\.json|codex\/\.codex\/hooks\.json|cursor\/\.cursor\/hooks\.json|opencode\/\.opencode\/plugins\/[^/]+\.js)$/.test(
      path,
    ),
  )
  .sort();

function scriptPath(command: string) {
  const match = command.match(/\.(?:claude|codex|cursor)\/hooks\/[\w.-]+\.(?:sh|ts)/);
  if (!match) throw new Error(`Hook command has no script: ${command}`);
  return match[0];
}

function wired(
  config: string,
  agent: Agent,
  {
    event,
    command,
    script = scriptPath(command),
  }: { event: string; command: string; script?: string },
): Hook {
  const entry = config.slice(0, config.indexOf("/adapters/"));
  const candidates = [entry, ...fragmentRoots].flatMap((root) => [
    join(root, "adapters", agent, script),
    join(root, "files", script),
  ]);
  const source = candidates.find((path) => existsSync(path));
  if (!source) throw new Error(`Missing wired script: ${config} -> ${script}`);
  return {
    owner: relative(registry, entry),
    agent,
    event,
    command,
    script,
    name: basename(script),
    body: readFileSync(source, "utf8"),
  };
}

// Settings merge by concatenating hook arrays. Inventory the shipped declarations directly,
// before choosing representatives, so changing any one copy creates a new command/script row.
const hooks = configs.flatMap((config) => {
  const text = readFileSync(config, "utf8");
  const match = config.match(/\/adapters\/(claude|codex|cursor|opencode)\//);
  const agent = Schema.decodeUnknownSync(Schema.Literals(agents))(match?.[1]);
  if (agent === "opencode") {
    return [...new Set([...text.matchAll(/(?:guard|run)\("([\w-]+\.sh)"/g)].map((m) => m[1]))].map(
      (script) => {
        if (!script) throw new Error(`Missing plugin script in ${config}`);
        return wired(config, agent, {
          event: script,
          command: text,
          script:
            script === "check-patch.sh"
              ? ".opencode/hooks/check-patch.sh"
              : `.claude/hooks/${script}`,
        });
      },
    );
  }
  const groups =
    agent === "cursor"
      ? Object.entries(Schema.decodeUnknownSync(CursorSettings)(JSON.parse(text)).hooks).flatMap(
          ([event, commands]) => commands.map(({ command }) => ({ event, command })),
        )
      : Object.entries(Schema.decodeUnknownSync(Settings)(JSON.parse(text)).hooks ?? {}).flatMap(
          ([event, groups]) =>
            groups.flatMap((group) => group.hooks.map(({ command }) => ({ event, command }))),
        );
  return groups.map((hook) => wired(config, agent, hook));
});

function distinct(items: Hook[], key: (hook: Hook) => string) {
  return [...new Map(items.map((hook) => [key(hook), hook])).values()];
}

const wrappers = distinct(hooks, (hook) =>
  hook.agent === "opencode"
    ? `${hook.command}:${hook.event}`
    : hook.command.replace(/[\w.-]+\.(sh|ts)\b/g, "hook.$1"),
);
const scripts = distinct(hooks, (hook) => hook.body);
const rows = [
  ...wrappers.flatMap((hook) =>
    ["normal", "missing script", "missing bash/jq", "failing script", "no tools"].map(
      (condition) => ({ ...hook, kind: "wrapper", condition }),
    ),
  ),
  ...scripts.flatMap((hook) =>
    (hook.script.endsWith(".ts")
      ? ["normal"]
      : [
          "normal",
          "missing jq",
          "no tools",
          ...(hook.body.includes("_lib.sh") ? ["missing helper"] : []),
        ]
    ).map((condition) => ({ ...hook, kind: "script", condition })),
  ),
];
const space = { path: mkdtempSync(join(tmpdir(), "hook-stdin-")) };
const roots = [join(space.path, "project-0"), join(space.path, "project-1")];
const bun = spawnSync("/bin/sh", ["-c", "command -v bun"], { encoding: "utf8" }).stdout.trim();
let preparedMs = 0;

// The plugin receives objects, not stdin. This host reads the agent payload, then lets the real
// Bun shell feed the plugin's child process its own large payload through Buffer redirection.
const pluginHost = `import { $ } from "bun";
import { AgentOps } from "./.opencode/plugins/agent-ops.js";
const payload = JSON.parse(await new Response(Bun.stdin.stream()).text());
payload.padding = "x".repeat(256 * 1024);
const sizes = [];
const shell = (...args) => {
  const input = args.find(value => Buffer.isBuffer(value));
  sizes.push(input?.byteLength ?? 0);
  return $(...args);
};
const plugin = await AgentOps({ $: shell, directory: process.cwd() });
const script = process.argv[2];
if (script === "format-changed.sh") {
  const path = process.env.PATH;
  process.env.PATH = process.env.HOOK_TEST_PATH;
  await plugin["tool.execute.after"]({ tool: "write", sessionID: payload.padding,
    args: { filePath: "absent.txt" } }, { output: "" });
  process.env.PATH = path;
  await plugin.event({ event: { type: "session.idle", properties: { sessionID: payload.padding } } });
} else if (script === "lint-on-write.sh") {
  await plugin["tool.execute.after"]({ tool: "write", sessionID: payload.padding,
    args: { filePath: "absent.txt" } }, { output: "" });
} else {
  const tool = script === "detect-secrets.sh" ? "write" : script === "check-patch.sh" ? "apply_patch" : "bash";
  const patchText = "*** Begin Patch\\n*** Add File: stdin.txt\\n" +
    payload.padding.match(/.{1,1024}/g).map(line => "+" + line).join("\\n") + "\\n*** End Patch";
  await plugin["tool.execute.before"]({ tool }, { args: { ...payload.tool_input,
    filePath: "absent.txt", patchText, content: payload.padding, padding: payload.padding } });
}
if (sizes.length === 0 || sizes.some(size => size <= 256 * 1024))
  throw new Error("Plugin child stdin is too small: " + JSON.stringify(sizes));
`;

beforeAll(async () => {
  expect(hooks.length).toBeGreaterThan(0);
  // One real composition supplies the shared helpers and native adapters. Individual script
  // contents are installed per row; no project install or full stack scaffold runs.
  const files = await Effect.runPromise(
    Effect.gen(function* () {
      const reader = yield* Registry;
      const composition = yield* compose({
        stack: "typescript-cli",
        agents,
        with: ["rr", "openrouter-chat-cli"],
        without: [],
        always: [],
        preset: "default",
        mode: "new",
      });
      return yield* composeFiles(
        {
          ...composition,
          files: composition.files.filter(
            (file) =>
              /^\.(claude|codex|cursor|opencode)\//.test(file.path) ||
              file.path.startsWith("scripts/"),
          ),
        },
        NEUTRAL_VARS,
        reader,
      );
    }).pipe(
      Effect.provide(Registry.layer([{ origin: "bundled", path: registry }])),
      Effect.provide(NodeServices.layer),
    ),
  );
  for (const root of roots) {
    for (const file of files) {
      const path = join(root, file.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.bytes, { mode: file.executable ? 0o755 : 0o644 });
    }
    mkdirSync(join(root, "tmp"));
    writeFileSync(join(root, "stdin-plugin.mjs"), pluginHost);
    // The API session hook imports these Node-only helpers before reading its payload.
    for (const name of ["dev-status.ts", "dev-logs.ts", "dev-pid.ts"])
      copyFileSync(
        join(registry, "stacks/typescript-api/files/scripts", name),
        join(root, "scripts", name),
      );
    expect(spawnSync("git", ["init", "--quiet", root]).status).toBe(0);
  }
  const normal = [
    "bash",
    "bun",
    "cat",
    "jq",
    "git",
    "sh",
    "dirname",
    "basename",
    "awk",
    "grep",
    "sed",
    "tr",
    "head",
    "wc",
    "mkdir",
    "mktemp",
    "rm",
    "sort",
    "cksum",
    "cut",
    "id",
    "date",
    "tail",
    "node",
    "env",
    "sleep",
    "ps",
  ];
  for (const [name, programs] of Object.entries({
    normal,
    "missing bash/jq": ["cat", "git", "bun", "sh"],
    "missing jq": normal.filter((program) => program !== "jq"),
    "no tools": ["bun"],
  })) {
    const bin = join(space.path, name);
    mkdirSync(bin, { recursive: true });
    for (const program of programs) {
      const path = spawnSync("/bin/sh", ["-c", `command -v ${program}`], {
        encoding: "utf8",
      }).stdout.trim();
      expect(path, program).not.toBe("");
      symlinkSync(path, join(bin, program));
    }
  }
  preparedMs = performance.now() - started;
}, 10_000);

afterAll(() => {
  rmSync(space.path, { recursive: true, force: true });
  const elapsed = performance.now() - started;
  console.info(
    "hook stdin: " +
      hooks.length +
      " declarations, " +
      wrappers.length +
      " command shapes, " +
      scripts.length +
      " script contents, " +
      rows.length +
      " rows; preparation " +
      Math.round(preparedMs) +
      "ms; total " +
      Math.round(elapsed) +
      "ms",
  );
  // Leave headroom for loaded CI; unloaded file time is measured separately against 5 seconds.
  expect(elapsed).toBeLessThan(10_000);
});

function payload(root: string, agent: Agent, condition: string) {
  const input = JSON.stringify({
    cwd: root,
    workspace_roots: [root],
    session_id: "stdin-test",
    file_path: "absent.txt",
    tool_name: agent === "cursor" ? "Shell" : "Bash",
    tool_input: { command: "echo ok", file_path: "absent.txt", content: "hello" },
  });
  // Valid JSON whitespace keeps the transport over a pipe buffer without making parser cost
  // part of this regression. Short lines also exercise the no-cat builtin drain efficiently.
  const padding =
    condition === "missing jq" ? "\n".repeat(256 * 1024) : `${" ".repeat(1024)}\n`.repeat(256);
  return `${input}\n${padding}`;
}

type Run = {
  error: Error | undefined;
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

function pipeInput(
  command: { program: string; args: string[] },
  root: string,
  path: string,
  input: string,
) {
  return new Promise<Run>((resolve) => {
    const child = spawn(command.program, command.args, {
      cwd: root,
      signal: AbortSignal.timeout(10_000),
      env: {
        HOME: root,
        PATH: path,
        TMPDIR: join(root, "tmp"),
        CLAUDE_PROJECT_DIR: root,
        CURSOR_PROJECT_DIR: root,
        HOOK_TEST_PATH: join(space.path, "normal"),
      },
    });
    let error: Error | undefined;
    let stdout = "";
    let stderr = "";
    child.on("error", (cause) => {
      error ??= cause;
    });
    child.stdin.on("error", (cause) => {
      error ??= cause;
    });
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("close", (status, signal) => resolve({ error, status, signal, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function run(hook: Hook, condition: string, direct: boolean, root: string) {
  const script = join(root, hook.script);
  const original = existsSync(script) ? readFileSync(script) : undefined;
  mkdirSync(dirname(script), { recursive: true });
  writeFileSync(script, hook.body);
  const removed = condition === "missing helper" ? join(root, ".claude/hooks/_lib.sh") : script;
  const mutate = ["missing script", "failing script", "missing helper"].includes(condition);
  if (mutate) renameSync(removed, `${removed}.saved`);
  try {
    if (condition === "failing script")
      writeFileSync(script, "echo 'first diagnostic' >&2\necho 'second diagnostic' >&2\nexit 7\n");
    const path = existsSync(join(space.path, condition))
      ? join(space.path, condition)
      : join(space.path, "normal");
    let command = { program: "/bin/sh", args: ["-c", hook.command] };
    if (direct)
      command = { program: hook.script.endsWith(".ts") ? bun : "/bin/bash", args: [script] };
    else if (hook.agent === "opencode")
      command = { program: bun, args: [join(root, "stdin-plugin.mjs"), hook.event] };
    return await pipeInput(command, root, path, payload(root, hook.agent, condition));
  } finally {
    if (mutate) {
      rmSync(removed, { force: true });
      renameSync(`${removed}.saved`, removed);
    }
    if (original) writeFileSync(script, original);
    else rmSync(script);
  }
}

// Two independent fixtures bound parallel child processes to the CI runner's two cores.
// Cases within each fixture stay sequential because they temporarily remove shared helpers.
describe.concurrent.each(roots.map((root, group) => ({ root, group })))(
  "hook pipes $group",
  ({ root, group }) => {
    test.each(rows.filter((_, index) => index % roots.length === group))(
      "$kind $name ($owner, $event) drains stdin: $condition",
      { concurrent: false, timeout: 15_000 },
      async (row) => {
        const result = await run(row, row.condition, row.kind === "script", root);
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status, result.stderr).toBe(0);
        const notes = result.stderr.trim().split("\n").filter(Boolean);
        expect(notes.length, result.stderr).toBeLessThanOrEqual(1);
        if (
          ["missing script", "failing script", "missing helper"].includes(row.condition) ||
          (row.condition === "no tools" && row.name.endsWith(".sh"))
        )
          expect(notes, result.stderr).toHaveLength(1);
      },
    );
  },
);
