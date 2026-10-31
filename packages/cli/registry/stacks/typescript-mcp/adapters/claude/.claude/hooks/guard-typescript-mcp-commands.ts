// PreToolUse (Bash): deny commands that are wrong for this stack, with the fix.
//
//   adding @modelcontextprotocol/sdk   the v1 SDK; this server is on the v2 split packages
//   bun test                           bun's own test runner; the tests are Vitest (bun run test)
//   --bun (-b) on vitest or a script   the server and tests run on Node here
//   bun [run] src/....ts               runs the server under Bun; build it and run it with node
//   Inspector's web UI, not in background  `bun run inspect` or mcp-inspector without --cli
//                                      serves a web page until stopped and blocks the tool call
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

const MANAGERS = new Set(["bun", "bunx", "npm", "npx", "pnpm", "yarn"]);
const INSTALL_VERBS = new Set(["add", "install", "i"]);

type Rule = (name: string, args: string[], background: boolean) => string | undefined;

const v1Sdk: Rule = (name, args) => {
  if (name === "bunx" || name === "npx" || !INSTALL_VERBS.has(target(args, false))) {
    return undefined;
  }
  return args.some((a) => /^@modelcontextprotocol\/sdk(@.*)?$/.test(a))
    ? "@modelcontextprotocol/sdk is the v1 SDK. This server uses v2: bun add @modelcontextprotocol/server (McpServer, tools) and bun add -d @modelcontextprotocol/client (Client, tests). Read their installed declarations before writing imports."
    : undefined;
};

const forcedBun: Rule = (name, args) => {
  if (name !== "bun" && name !== "bunx") return undefined;
  if (!args.includes("--bun") && !args.includes("-b")) return undefined;
  const runsScript = args.includes("run") && !/^(\.\/)?scripts\//.test(target(args, true));
  if (!runsScript && !args.some((a) => /(^|\/)vitest$/.test(a))) return undefined;
  return "The server and Vitest run on Node in this project. Drop --bun (bun run test / bun run build / bun run smoke).";
};

const bunTest: Rule = (name, args) =>
  name === "bun" && target(args, false) === "test"
    ? 'bun test is Bun\'s own test runner; the tests here are Vitest. Use bun run test (add a file path or -t "<name>" to scope it).'
    : undefined;

const serverUnderBun: Rule = (name, args) =>
  name === "bun" && /^(\.\/)?src\/.*\.ts$/.test(target(args, true))
    ? "That runs the server under Bun; it runs on Node here. Use bun run build && bun run smoke, or bun run test tests/stdio.test.ts."
    : undefined;

const foregroundInspector: Rule = (name, args, background) => {
  if (background) return undefined;
  const webUi =
    (name !== "bunx" && name !== "npx" && target(args, true) === "inspect") ||
    (args.some((a) => /(^|\/|@modelcontextprotocol\/)(mcp-)?inspector(@.*)?$/.test(a)) &&
      !args.includes("--cli") &&
      !INSTALL_VERBS.has(target(args, false)));
  return webUi
    ? "MCP Inspector's web UI never exits and would block this call. Use bun run smoke, or mcp-inspector --cli node dist/index.js --method tools/list (add -e MCP_ROOT=<dir>); run bun run inspect with run_in_background only for a person to open."
    : undefined;
};

const RULES: Rule[] = [v1Sdk, forcedBun, bunTest, serverUnderBun, foregroundInspector];

function reasonFor(cmd: Command, background: boolean): string | undefined {
  const [first = "", ...args] = cmd.argv;
  const name = basename(first);
  if (name === "mcp-inspector" || name === "inspector") {
    return foregroundInspector("bunx", [first, ...args], background);
  }
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
