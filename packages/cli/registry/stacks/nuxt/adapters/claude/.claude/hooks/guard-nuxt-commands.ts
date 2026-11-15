// PreToolUse (Bash): keep foreground servers from hanging the session.
import { basename } from "node:path";
import { deny, readPayload, text } from "./_lib";
import { type Command, commands } from "./_shell";

const NUXT_CLI = /(^|\/)(nuxt|nuxi)(@[^/]*)?$/;
const SERVER_SCRIPTS = new Set(["dev", "start"]);
const RUNNERS = new Set(["bun", "bunx", "npx", "npm", "pnpm", "yarn"]);
const VALUE_FLAGS = new Set(["--cwd", "--filter", "-F", "--workspace", "-w", "--env-file"]);

/** The nuxt/nuxi subcommand, when the command runs one directly or through a runner. */
function nuxtSubcommand(name: string, args: string[]): string | undefined {
  if (name === "nuxt" || name === "nuxi") return args[0];
  if (!RUNNERS.has(name)) return undefined;
  const at = args.findIndex((a) => NUXT_CLI.test(a));
  return at === -1 ? undefined : args[at + 1];
}

function serverReason(name: string, args: string[], background: boolean): string | undefined {
  if (background) return undefined;
  const sub = nuxtSubcommand(name, args);
  const words = args.filter(
    (arg, i) => !arg.startsWith("-") && !VALUE_FLAGS.has(args[i - 1] ?? ""),
  );
  const script = RUNNERS.has(name) && words[0] === "run" ? words[1] : undefined;
  const servesNode = name === "node" && args.some((a) => a.endsWith(".output/server/index.mjs"));
  if (sub === "dev" || sub === "preview" || servesNode || (script && SERVER_SCRIPTS.has(script))) {
    return "A server never exits, so running it in the foreground hangs this session. Run it with run_in_background, or check the build with bun run e2e.";
  }
  return undefined;
}

function reasonFor(cmd: Command, background: boolean): string | undefined {
  const [first = "", ...args] = cmd.argv;
  const name = basename(first);
  return serverReason(name, args, background);
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
