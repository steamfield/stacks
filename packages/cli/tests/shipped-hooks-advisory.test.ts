/** Advisory hooks remain quiet, bound their output, and ship with valid wiring and shell modes. */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, matchesGlob, relative } from "node:path";
import { Schema } from "effect";
import { afterAll, beforeAll, expect, test } from "vitest";
import { guardCommands } from "./helpers/native-adapters";
import {
  agentOps,
  allowed,
  bashPayload,
  bundledStacks,
  composedSettings,
  denied,
  editPayload,
  eventPayload,
  failingTool,
  fixture,
  hookCommand,
  noted,
  registry,
  run,
  Settings,
  settings,
  writePayload,
} from "./helpers/shipped-hooks";

const space = fixture();
let project: string;
beforeAll(async () => {
  project = await space.scaffold();
});
afterAll(() => space.cleanup());
function write(root: string, file: string, text: string, mode = 0o644) {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { mode });
  chmodSync(path, mode);
}
async function lint(root: string, file: string, session = "advisory") {
  return await run(root, hookCommand(root, "lint-on-write.sh"), {
    ...writePayload(root, file, "", session),
    hook_event_name: "PostToolUse",
  });
}
async function format(root: string, session = "advisory", path?: string) {
  return await run(
    root,
    hookCommand(root, "format-changed.sh"),
    eventPayload(root, "Stop", session),
    { path },
  );
}
function fakeBiome(root: string, lines: number) {
  write(root, "biome.json", "{}\n");
  write(
    root,
    "node_modules/.bin/biome",
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${root}/biome-calls"\ni=0; while [ "$i" -lt ${lines} ]; do echo "src.ts:$i:1: lint/style: issue $i"; i=$((i + 1)); done\nexit 1\n`,
    0o755,
  );
}

test.concurrent.each([
  ["PEM", "-----BEGIN PRIVATE KEY-----", "Private key"],
  ["OpenAI mixed-case key", `sk-proj-${"Ab3d".repeat(12)}`, "OpenAI-style"],
  ["Anthropic placeholder filtering", `sk-ant-${"aB3d".repeat(8)}`, "Anthropic"],
  ["generic assignment", `api_key = '${"aB3d".repeat(10)}'`, "Long literal"],
  ["connection password", "postgres://app:v8K3mZ2pQ9@db/app", "Connection string"],
])("denies a secret-shaped %s write", async (_name, content, reason) => {
  const explanation = denied(
    await run(
      project,
      hookCommand(project, "detect-secrets.sh"),
      writePayload(project, "src/config.ts", content),
    ),
  );
  expect(explanation).toContain(reason);
  expect(explanation).not.toContain(content);
  if (_name === "PEM") {
    const edits = guardCommands(project, "claude", "Edit").find((command) =>
      command.includes("/detect-secrets.sh"),
    );
    if (!edits) throw new Error("Missing configured Edit guard");
    expect(denied(await run(project, edits, editPayload(project, content)))).toContain(reason);
    allowed(await run(project, edits, editPayload(project, "export const value = 2;")));
  }
  if (_name === "Anthropic placeholder filtering" || _name === "OpenAI mixed-case key") {
    const conditions =
      _name === "Anthropic placeholder filtering"
        ? ['[ "$1" = -qviE ]']
        : ['[ "$1" = -v ] && [ "$2" = "^sk-ant-" ]', '[ "$1" = "[A-Z]" ]'];
    for (const condition of conditions) {
      const root = space.copy(project);
      const path = failingTool(
        root,
        "grep",
        `if ${condition}; then exit 7; fi\nexec /usr/bin/grep "$@"`,
      );
      noted(
        await run(
          root,
          hookCommand(root, "detect-secrets.sh"),
          writePayload(root, "src/config.ts", content),
          { path },
        ),
      );
    }
  }
});
test("secret checks protect .env, permit ordinary writes, and fail open on unavailable input", async () => {
  const command = hookCommand(project, "detect-secrets.sh");
  expect(denied(await run(project, command, writePayload(project, ".env", "DEBUG=1")))).toContain(
    ".env",
  );
  allowed(
    await run(
      project,
      command,
      writePayload(project, ".env.example", "-----BEGIN PRIVATE KEY-----"),
    ),
  );
  allowed(
    await run(project, command, writePayload(project, "src/config.ts", "export const value = 1;")),
  );
  noted(await run(project, command, "{broken", { raw: true }));
  const root = space.copy(project);
  rmSync(join(root, ".claude/hooks/_lib.sh"));
  noted(
    await run(root, command, writePayload(root, "src/config.ts", "-----BEGIN PRIVATE KEY-----")),
  );
});
test("lint without a linter and format without session changes exit silently", async () => {
  const root = space.copy(project);
  write(root, "src/normal.ts", "export const value = 1;\n");
  allowed(await lint(root, "src/normal.ts"));
  allowed(await format(root, "no-changes"));
});
test("lint caps diagnostics at 60 lines and labels truncation", async () => {
  const root = space.copy(project);
  fakeBiome(root, 61);
  write(root, "src.ts", "export const value = 1;\n");
  const result = await lint(root, "src.ts");
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  const context = Schema.decodeUnknownSync(
    Schema.Struct({ hookSpecificOutput: Schema.Struct({ additionalContext: Schema.String }) }),
  )(JSON.parse(result.stdout)).hookSpecificOutput.additionalContext;
  expect(context.split("\n")).toHaveLength(62);
  expect(context).toContain("issue 59");
  expect(context).not.toContain("issue 60");
  expect(context.split("\n").at(-1)).toContain("truncated");
});
test("formatter failures exit silently after actually attempting the formatter", async () => {
  const root = space.copy(project);
  fakeBiome(root, 1);
  write(root, "src.ts", "export const value = 1;\n");
  await lint(root, "src.ts");
  allowed(await format(root));
  expect(readFileSync(join(root, "biome-calls"), "utf8")).toContain("check --write");
});
test("Rust formatting inherits the workspace edition and leaves other files alone", async () => {
  const root = space.copy(project);
  write(
    root,
    "ws/Cargo.toml",
    '[workspace]\nmembers = ["core"]\n[workspace.package]\nedition = "2024"\n',
  );
  write(
    root,
    "ws/core/Cargo.toml",
    '[package]\nname = "core"\nedition.workspace = true\n[dependencies.decoy]\nedition = "2018"\n',
  );
  write(root, "ws/core/src/lib.rs", "pub fn value() {}\n");
  write(root, "ws/core/src/untouched.rs", "pub fn other() {}\n");
  write(root, "stray.rs", "fn main() {}\n");
  write(root, "legacy/Cargo.toml", '[package]\nname = "legacy"\n');
  write(root, "legacy/main.rs", "fn main() {}\n");
  write(
    root,
    "bin/rustfmt",
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${root}/rustfmt-calls"\nprintf '// formatted\\n'\ncat\n`,
    0o755,
  );
  for (const file of ["ws/core/src/lib.rs", "stray.rs", "legacy/main.rs"])
    allowed(await lint(root, file));
  allowed(await format(root, "advisory", `${root}/bin:${process.env.PATH}`));
  expect(readFileSync(join(root, "rustfmt-calls"), "utf8").trim().split("\n").sort()).toEqual([
    "--edition 2015 --emit stdout",
    "--edition 2024 --emit stdout",
  ]);
  expect(readFileSync(join(root, "ws/core/src/lib.rs"), "utf8")).toBe(
    "// formatted\npub fn value() {}\n",
  );
  expect(readFileSync(join(root, "stray.rs"), "utf8")).toBe("fn main() {}\n");
  expect(readFileSync(join(root, "ws/core/src/untouched.rs"), "utf8")).toBe("pub fn other() {}\n");
});
test("Maven formatting batches only the session's Java files under a wrapper with a pom", async () => {
  const root = space.copy(project);
  const wrapper = `#!/bin/sh\nprintf '%s %s\\n' "$PWD" "$*" >> "${root}/mvnw-calls"\n`;
  write(root, "svc/pom.xml", "<project/>\n");
  write(root, "svc/mvnw", wrapper, 0o755);
  write(root, "lib/mvnw", wrapper, 0o755);
  for (const file of ["svc/src/A.java", "svc/src/B.java", "lib/C.java", "stray.java"]) {
    write(root, file, "class App {}\n");
    allowed(await lint(root, file));
  }
  allowed(await format(root));
  const real = realpathSync(root);
  expect(readFileSync(join(root, "mvnw-calls"), "utf8")).toBe(
    `${real}/svc -q -B spotless:apply -DspotlessFiles=\\Q${real}/svc/src/A.java\\E,\\Q${real}/svc/src/B.java\\E\n`,
  );
});
test("session start supplies no more than 15 lines", async () => {
  const result = await run(
    project,
    hookCommand(project, "session-start.sh"),
    eventPayload(project, "SessionStart"),
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Repo state:");
  expect(result.stdout.trim().split("\n").length).toBeLessThanOrEqual(15);
});
test("composed settings wire each agent-ops hook once and protect env reads without hiding templates", () => {
  const config = settings(project);
  const commands = Object.values(config.hooks).flatMap((groups) =>
    groups.flatMap((group) => group.hooks.map((hook) => hook.command)),
  );
  for (const name of [
    "session-start.sh",
    "block-destructive.sh",
    "detect-secrets.sh",
    "lint-on-write.sh",
    "format-changed.sh",
  ]) {
    expect(
      commands.filter((command) => command.includes(`/${name}"`)),
      name,
    ).toHaveLength(1);
  }
  const reads = (config.permissions?.deny ?? [])
    .filter((rule) => rule.startsWith("Read("))
    .map((rule) => rule.slice(5, -1));
  for (const file of [
    "./.env",
    "./.env.local",
    "./.envrc",
    "./.env.development",
    "./.env.test",
    "./.env.staging",
    "./.env.production",
    "./.env.development.local",
    "./apps/web/.env",
    "./apps/web/.env.local",
    "./apps/web/.env.production",
    "./apps/web/.env.production.local",
    "./apps/web/.envrc",
  ])
    expect(
      reads.some((pattern) => matchesGlob(file, pattern)),
      file,
    ).toBe(true);
  for (const file of [
    "./.env.example",
    "./.env.sample",
    "./.env.template",
    "./apps/web/.env.example",
  ])
    expect(
      reads.some((pattern) => matchesGlob(file, pattern)),
      file,
    ).toBe(false);
});
test("every bundled stack with all its optional fragments wires each hook once and keeps agent-ops' deny rules", async () => {
  const base = Schema.decodeUnknownSync(Settings)(
    JSON.parse(readFileSync(join(agentOps, "adapters/claude/.claude/settings.json"), "utf8")),
  );
  const stacks = await bundledStacks();
  expect(stacks.length).toBeGreaterThan(0);
  for (const { id, optional } of stacks) {
    const config = await composedSettings(id, optional);
    const commands = Object.values(config.hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.map((hook) => hook.command)),
    );
    // Two fragments wiring the same hook, even in different languages (guard-x.sh and guard-x.ts).
    const scripts = commands.map((command) =>
      /\.claude\/hooks\/([^"/]+)"/.exec(command)?.[1]?.replace(/\.[^.]+$/, ""),
    );
    expect(scripts, id).toEqual([...new Set(scripts)]);
    const deny = config.permissions?.deny ?? [];
    expect(deny, id).toEqual([...new Set(deny)]);
    expect(deny, id).toEqual(expect.arrayContaining([...(base.permissions?.deny ?? [])]));
  }
});
test("smoke checks that every wired Claude hook exists", async () => {
  const root = space.copy(project);
  const command = "bash .claude/hooks/smoke.sh";
  expect(await run(root, command, {})).toEqual({
    status: 0,
    stdout: "hooks-smoke: guards and hook configs OK\n",
    stderr: "",
  });
  // An additional hook proves this walks the wiring rather than a fixed inventory.
  const config = settings(root);
  write(
    root,
    ".claude/settings.json",
    JSON.stringify({
      ...config,
      hooks: {
        ...config.hooks,
        SessionStart: [
          ...(config.hooks.SessionStart ?? []),
          { hooks: [{ command: "bash .claude/hooks/extra-advisory.sh" }] },
        ],
      },
    }),
  );
  const result = await run(root, command, {});
  expect(result).toEqual({
    status: 1,
    stdout: "",
    stderr:
      "hooks-smoke: .claude/settings.json references missing .claude/hooks/extra-advisory.sh\n",
  });
});

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
// Strip quoted data and comments before looking for bash syntax, keeping expansions
// inside double quotes for the parameter-expansion checks. This is the old static check.
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
  const c = source[i] ?? "";
  if (c === "\\") return i + 1;
  if (c === "'" || c === '"') {
    text.quote = c;
    text.out += " ";
    return i;
  }
  if (c === "#" && (i === 0 || /\s/.test(source[i - 1] ?? ""))) {
    while (i < source.length && source[i] !== "\n") i++;
    text.out += "\n";
    return i;
  }
  text.out += c;
  return i;
}
function unquoted(source: string, keepDouble: boolean): string {
  const text: ShellText = { out: "", quote: undefined };
  for (let i = 0; i < source.length; i++) {
    if (text.quote !== undefined) i = quotedCharacter(source, i, text, keepDouble);
    else i = unquotedCharacter(source, i, text);
  }
  return text.out;
}
const scripts = readdirSync(registry, { recursive: true, withFileTypes: true })
  .filter((file) => file.isFile() && file.name.endsWith(".sh"))
  .map((file) => join(file.parentPath, file.name));
const inCheckout =
  spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: registry }).status === 0;
test.skipIf(!inCheckout)("every shipped shell script is executable in git", () => {
  const git = spawnSync("git", ["ls-files", "--stage", "registry"], {
    cwd: join(registry, ".."),
    encoding: "utf8",
  });
  expect(git.status).toBe(0);
  expect(git.stderr).toBe("");
  for (const path of scripts) {
    const name = `registry/${relative(registry, path)}`;
    expect(
      git.stdout.split("\n").find((line) => line.endsWith(`\t${name}`)),
      name,
    ).toMatch(/^100755 /);
  }
});
test("every shipped shell script avoids bash 4 constructs", () => {
  expect(scripts.length).toBeGreaterThan(0);
  for (const path of scripts) {
    const source = readFileSync(path, "utf8");
    const views = { code: unquoted(source, false), expanded: unquoted(source, true) };
    expect(
      BASH4.filter(([, pattern, view]) => pattern.test(views[view])).map(([name]) => name),
      path,
    ).toEqual([]);
  }
});
test.skipIf(process.platform !== "darwin")(
  "the composed destructive hook runs on bash 3.2 (macOS)",
  async () => {
    const version = spawnSync("/bin/bash", ["-c", "echo $BASH_VERSION"], { encoding: "utf8" });
    expect(version.status).toBe(0);
    expect(version.stderr).toBe("");
    expect(version.stdout).toMatch(/^3\.2\./);
    const command = hookCommand(project, "block-destructive.sh");
    expect(
      denied(
        await run(project, command, bashPayload(project, "git reset --hard"), {
          program: "/bin/bash",
          args: ["-c", command],
          path: `/bin:/usr/bin:${process.env.PATH ?? ""}`,
        }),
      ),
    ).toMatch(/git/);
  },
);
