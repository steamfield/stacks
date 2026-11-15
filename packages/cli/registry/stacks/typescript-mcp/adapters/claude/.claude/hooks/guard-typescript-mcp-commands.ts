// PreToolUse (Bash): keep foreground servers from hanging the session.
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

function foregroundInspector(
  name: string,
  args: string[],
  background: boolean,
): string | undefined {
  if (background) return undefined;
  const webUi =
    (name !== "bunx" && name !== "npx" && target(args, true) === "inspect") ||
    (args.some((a) => /(^|\/|@modelcontextprotocol\/)(mcp-)?inspector(@.*)?$/.test(a)) &&
      !args.includes("--cli") &&
      !INSTALL_VERBS.has(target(args, false)));
  return webUi
    ? "MCP Inspector's web UI never exits and would block this call. Use bun run smoke, or mcp-inspector --cli node dist/index.js --method tools/list (add -e MCP_ROOT=<dir>); run bun run inspect with run_in_background only for a person to open."
    : undefined;
}

function reasonFor(cmd: Command, background: boolean): string | undefined {
  const [first = "", ...args] = cmd.argv;
  const name = basename(first);
  if (name === "mcp-inspector" || name === "inspector") {
    return foregroundInspector("bunx", [first, ...args], background);
  }
  if (!MANAGERS.has(name)) return undefined;
  return foregroundInspector(name, args, background);
}

const payload = readPayload();
if (payload === undefined)
  console.error("Note: unreadable stack guard payload; allowing this call.");
const input = payload?.tool_input;
const command = text(input?.command);
const background =
  typeof input === "object" &&
  input !== null &&
  "run_in_background" in input &&
  input.run_in_background === true;
const reason = command
  ? commands(command)
      .map((cmd) => reasonFor(cmd, background))
      .find((r) => r !== undefined)
  : undefined;
if (reason) deny(`BLOCKED: ${reason}`);
