import { spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { deny, isDir, readPayload, text } from "./_lib";
import { type Command, commands } from "./_shell";

// In-place edits from the shell skip every Edit/Write hook (lint, typecheck, boundary and secret
// guards, format-on-stop), so the Edit and Write tools are the only way to change a file.
const IN_PLACE =
  "BLOCKED: Shell in-place edits bypass the Edit/Write hooks (lint, typecheck, boundaries, secrets, formatting). Use the Edit or Write tool.";
const inPlaceFlag = (arg: string) =>
  /^-[a-zA-Z]*i/.test(arg) || arg === "--in-place" || arg.startsWith("--in-place=");

// Parallel agents running whole suites on one laptop starve each other into timeouts; rr queues
// them on the test hosts. A clone opts in with `git config stacks.rr true` (shared by its
// worktrees, never committed); without it, whole suites run locally. A scoped file always does.
const RR =
  'BLOCKED: Whole test suites run through rr, which queues them across the test hosts: `rr check` for the gate, `rr test-cli`, `rr test-hooks` or `rr e2e` for one suite (AGENTS.md "Test runs"). A single test file runs locally (`bun run test:unit tests/<file>.test.ts` in packages/cli). If rr is missing or fails before running, say so and rerun with STACKS_LOCAL_GATE=1 in front.';
// A delegate (the codex-delegate runner sets CODEX_DELEGATE=1; older runners set STACKS_DELEGATE=1)
// runs no gate at all: Claude runs it once on the delegate's work after the refactor, so the
// delegate's run only held a shared host.
const DELEGATE =
  'BLOCKED: Delegates run no full gate or whole suite, locally or on rr: Claude runs the gate once after review (AGENTS.md "Test runs"). Run the test files covering your change (`bun run test:unit tests/<file>.test.ts` in packages/cli, or `rr test-cli tests/<file>.test.ts`), lint and typecheck, and name in the hand-off any test outside your scope your change could affect.';
const RR_SUITES = new Set(["check", "check-serial", "test", "test-hooks", "e2e"]);
const SUITES = new Set(["check", "test", "e2e", "coverage"]);
const SCOPABLE = new Set(["test:hooks", "test:unit"]);
// Flags whose value is the next word, for bun, rr and vitest (`--project cli` runs a whole project).
const VALUED = new Set([
  "--cwd",
  "--filter",
  "-F",
  "--host",
  "--project",
  "--maxWorkers",
  "--reporter",
  "-c",
  "--config",
]);

/** A word the shell passes through as written: a $(...), $VAR or unquoted glob can become nothing. */
const literal = (cmd: Command, i: number) =>
  !cmd.expands[i] && (cmd.quoted[i] || !/[*?[]/.test(cmd.argv[i] ?? ""));

/** The literal operands from `from` up to `--`, skipping flags and the values of `VALUED` flags. */
function operands(cmd: Command, from: number): string[] {
  const out: string[] = [];
  for (let i = from; i < cmd.argv.length; i++) {
    const arg = cmd.argv[i] ?? "";
    if (VALUED.has(arg)) i++;
    else if (arg === "--") break;
    else if (!arg.startsWith("-") && literal(cmd, i)) out.push(arg);
  }
  return out;
}

function wholeSuite(cmd: Command): boolean {
  const [executable = "", sub] = cmd.argv;
  const name = basename(executable);
  if (name === "bun" && sub === "run") {
    const [script = "", ...files] = operands(cmd, 2);
    return SUITES.has(script) || (SCOPABLE.has(script) && files.length === 0);
  }
  if (name === "bun" && sub === "test")
    return !operands(cmd, 2).some((arg) => /\.[cm]?[jt]sx?$/.test(arg));
  if (name === "vitest") return unscopedVitest(cmd, 1);
  return ["npx", "bunx"].includes(name) && sub === "vitest" && unscopedVitest(cmd, 2);
}

const unscopedVitest = (cmd: Command, from: number) =>
  operands(cmd, from).filter((arg) => arg !== "run").length === 0;

/** An rr task that runs a whole suite: `rr check`, or `rr test-cli` without a file. */
function wholeRrSuite(cmd: Command): boolean {
  if (basename(cmd.argv[0] ?? "") !== "rr") return false;
  const [task = "", ...files] = operands(cmd, 1);
  const filtered = files.length > 0 || cmd.argv.includes("--");
  return RR_SUITES.has(task) || (task === "test-cli" && !filtered);
}

function bunDirectory(argv: readonly string[]): string | undefined {
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--") return undefined;
    if (arg === "--cwd") return argv[index + 1];
    if (arg?.startsWith("--cwd=")) return arg.slice("--cwd=".length);
  }
  return undefined;
}

function commandDirectory(command: Command, start: string): string {
  if (command.remote || command.dir === null) return start;
  let directory = resolve(start, command.dir ?? ".");
  if (basename(command.argv[0] ?? "") === "bun") {
    const selected = bunDirectory(command.argv);
    if (selected !== undefined) directory = resolve(directory, selected);
  }
  return isDir(directory) ? directory : start;
}

function optedIntoRr(cwd: string): boolean {
  const result = spawnSync("git", ["config", "--type=bool", "--get", "stacks.rr"], {
    cwd,
    encoding: "utf8",
  });
  return result.status === 0 && result.stdout.trim() === "true";
}

const payload = readPayload();
const requestedDirectory = text(payload?.tool_input?.working_directory) || text(payload?.cwd);
const start = isDir(requestedDirectory) ? requestedDirectory : process.cwd();
const command = text(payload?.tool_input?.command);
const localGate = /(^|[\s;&|(])STACKS_LOCAL_GATE=1\s/.test(command ?? "");
const delegate = process.env.CODEX_DELEGATE === "1" || process.env.STACKS_DELEGATE === "1";
for (const parsed of commands(command ?? "")) {
  const { argv, stdin } = parsed;
  if (delegate && (wholeSuite(parsed) || wholeRrSuite(parsed))) {
    deny(DELEGATE);
    break;
  }
  if (!localGate && wholeSuite(parsed) && optedIntoRr(commandDirectory(parsed, start))) {
    deny(RR);
    break;
  }
  const [executable = "", sub] = argv;
  const name = basename(executable);
  if ((name === "sed" || name === "perl") && argv.slice(1).some(inPlaceFlag)) {
    deny(IN_PLACE);
    break;
  }
  if (/^python[0-9.]*$/.test(name) && /write_text\(|open\([^)]*["'][wa]/.test(stdin.join("\n"))) {
    deny(IN_PLACE);
    break;
  }
  if (
    ["npm", "pnpm", "yarn"].includes(name) &&
    ((name === "yarn" && sub === undefined) ||
      ["install", "i", "add", "ci", "remove", "uninstall", "rm", "update", "up"].includes(
        sub ?? "",
      ))
  ) {
    deny("BLOCKED: bun owns this project's lockfile. Use bun install, bun add, or bun remove.");
    break;
  }
}
