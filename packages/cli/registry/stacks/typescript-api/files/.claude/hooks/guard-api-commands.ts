// PreToolUse (Bash): keep foreground servers from hanging the session.
import { basename } from "node:path";
import { deny, readPayload, text } from "./_lib";
import { type Command, commands } from "./_shell";

// Flags whose value is the next word (bun --cwd apps/api add ..., npm -w api install ...).
const VALUE_FLAGS = new Set(["--cwd", "--filter", "-F", "--workspace", "-w", "--env-file"]);

/** The first argument that isn't a flag or a flag's value, skipping a leading `run` when `skipRun` is set. */
function target(args: string[], skipRun: boolean): string {
  const words = args.filter((a, i) => !a.startsWith("-") && !VALUE_FLAGS.has(args[i - 1] ?? ""));
  return (skipRun && words[0] === "run" ? words[1] : words[0]) ?? "";
}

const MANAGERS = new Set(["bun", "bunx", "npm", "pnpm", "yarn"]);

function reasonFor(cmd: Command, background: boolean): string | undefined {
  if (background) return undefined;
  const [first = "", ...args] = cmd.argv;
  const name = basename(first);
  if (!MANAGERS.has(name)) return undefined;
  if (name !== "bunx" && target(args, true) === "dev") {
    return "bun run dev runs the dev servers in the foreground and blocks this shell. Use bun run dev:bg (stop them with bun run dev:stop).";
  }
  return undefined;
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
