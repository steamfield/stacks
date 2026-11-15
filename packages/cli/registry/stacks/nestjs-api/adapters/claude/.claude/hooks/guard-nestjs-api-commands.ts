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
/** The Nest CLI's own arguments, for `nest ...` and `bunx nest ...`; undefined otherwise. */
function nestArgs(name: string, args: string[]): string[] | undefined {
  if (name === "nest") return args;
  if (
    (name === "bunx" || name === "npx") &&
    /(^|\/)(@nestjs\/cli|nest)(@.*)?$/.test(args[0] ?? "")
  ) {
    return args.slice(1);
  }
  return undefined;
}

function foregroundDev(name: string, args: string[], background: boolean): string | undefined {
  if (background) return undefined;
  const nest = nestArgs(name, args);
  const dev = !nest && name !== "bunx" && name !== "npx" && target(args, true) === "dev";
  const watch = nest?.[0] === "start" && nest.some((a) => a === "--watch" || a === "-w");
  return dev || watch
    ? "nest start --watch never exits and would block this call. Run bun run dev with run_in_background, or bun run build and then PORT_API=<free port> bun run start in the background."
    : undefined;
}

function reasonFor(cmd: Command, background: boolean): string | undefined {
  const [first = "", ...args] = cmd.argv;
  const name = basename(first);
  if (!MANAGERS.has(name) && name !== "nest") return undefined;
  return foregroundDev(name, args, background);
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
      .map((cmd) => reasonFor(cmd, background || cmd.background === true))
      .find((r) => r !== undefined)
  : undefined;
if (reason) deny(`BLOCKED: ${reason}`);
