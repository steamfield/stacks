// PreToolUse (Bash): deny commands that are wrong for this stack, with the fix.
//
//   bun test                        bun's own test runner; the tests are Vitest (bun run test)
//   --bun (-b) on vitest or a script  the server and tests run on Node here; --bun swaps in Bun's
//                                     runtime and hides differences until deploy
//   bun [run] src/....ts            runs the server under Bun; bun run dev or bun run start run it
//                                   on Node
//   bun run dev, not in background  the dev server never exits and blocks the tool call; run it
//                                   with run_in_background, or build and start in the background
//
// Commands are read the way bash runs them (see _shell.ts), so a quoted mention (a commit message,
// bun run test -t "bun test") passes.
import { basename } from "node:path";
import { deny, readPayload, text } from "./_lib";
import { type Command, commands } from "./_shell";

// Flags whose value is the next word (bun --cwd sub add ...).
const VALUE_FLAGS = new Set(["--cwd", "--filter", "-F", "--env-file"]);

/** The first argument that isn't a flag or a flag's value, skipping a leading `run` when `skipRun` is set. */
function target(args: string[], skipRun: boolean): string {
  const words = args.filter((a, i) => !a.startsWith("-") && !VALUE_FLAGS.has(args[i - 1] ?? ""));
  return (skipRun && words[0] === "run" ? words[1] : words[0]) ?? "";
}

const MANAGERS = new Set(["bun", "bunx", "npm", "pnpm", "yarn"]);

type Rule = (name: string, args: string[], background: boolean) => string | undefined;

const forcedBun: Rule = (name, args) => {
  if (name !== "bun" && name !== "bunx") return undefined;
  if (!args.includes("--bun") && !args.includes("-b")) return undefined;
  const runsScript = args.includes("run") && !/^(\.\/)?scripts\//.test(target(args, true));
  if (!runsScript && !args.some((a) => /(^|\/)vitest$/.test(a))) return undefined;
  return "The server and Vitest run on Node in this project. Drop --bun (bun run test / bun run dev / bun run build).";
};

const bunTest: Rule = (name, args) =>
  name === "bun" && target(args, false) === "test"
    ? 'bun test is Bun\'s own test runner; the tests here are Vitest. Use bun run test (add a file path or -t "<name>" to scope it).'
    : undefined;

const serverUnderBun: Rule = (name, args) =>
  name === "bun" && /^(\.\/)?src\/.*\.ts$/.test(target(args, true))
    ? "That runs the server under Bun; it runs on Node here. Use bun run dev (in the background) or bun run build && bun run start."
    : undefined;

const foregroundDev: Rule = (name, args, background) =>
  !background && name !== "bunx" && target(args, true) === "dev"
    ? "bun run dev never exits and would block this call. Run it with run_in_background, or bun run build and then PORT_API=<free port> bun run start in the background."
    : undefined;

const RULES: Rule[] = [forcedBun, bunTest, serverUnderBun, foregroundDev];

function reasonFor(cmd: Command, background: boolean): string | undefined {
  const [first = "", ...args] = cmd.argv;
  const name = basename(first);
  if (!MANAGERS.has(name)) return undefined;
  for (const rule of RULES) {
    const reason = rule(name, args, background);
    if (reason) return reason;
  }
  return undefined;
}

const input = readPayload()?.tool_input as
  | { command?: unknown; run_in_background?: unknown }
  | undefined;
const command = text(input?.command);
const background = input?.run_in_background === true;
const reason = command
  ? commands(command)
      .map((cmd) => reasonFor(cmd, background))
      .find((r) => r !== undefined)
  : undefined;
if (reason) deny(`BLOCKED: ${reason}`);
