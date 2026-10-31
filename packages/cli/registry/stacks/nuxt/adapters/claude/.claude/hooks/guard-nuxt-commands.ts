// PreToolUse (Bash): deny commands that are wrong for this stack, with the fix.
//
//   bun test                              bun's own test runner; the tests are vitest
//                                         (bun run test)
//   --bun on nuxt / nuxi / vitest /       they run on Node here; --bun swaps in bun's runtime
//   playwright or a script                and breaks them subtly
//   nuxt dev, bun run dev / start         servers never exit, so a foreground call hangs the
//   in the foreground                     session; run them in the background
//   nuxi init, create-nuxt                the project already exists; a generator overwrites
//                                         the shipped app, configs and tests
//
// Commands are read the way bash runs them (see _shell.ts), so a quoted mention (a commit message,
// bun run test -t "bun test") passes.
import { basename } from "node:path";
import { deny, readPayload, text } from "./_lib";
import { type Command, commands } from "./_shell";

const NODE_TOOL = /(^|\/)(nuxt|nuxi|vitest|playwright)$/;
const NUXT_CLI = /(^|\/)(nuxt|nuxi)(@[^/]*)?$/;
const SCRIPTS = new Set([
  "dev",
  "build",
  "start",
  "test",
  "test:watch",
  "coverage",
  "e2e",
  "typecheck",
  "check",
]);
const SERVER_SCRIPTS = new Set(["dev", "start"]);
const RUNNERS = new Set(["bun", "bunx", "npx", "npm", "pnpm", "yarn"]);

/** The nuxt/nuxi subcommand, when the command runs one directly or through a runner. */
function nuxtSubcommand(name: string, args: string[]): string | undefined {
  if (name === "nuxt" || name === "nuxi") return args[0];
  if (!RUNNERS.has(name)) return undefined;
  const at = args.findIndex((a) => NUXT_CLI.test(a));
  return at === -1 ? undefined : args[at + 1];
}

function generatorReason(name: string, args: string[]): string | undefined {
  const sub = nuxtSubcommand(name, args);
  const creates = args.some((a) => /^create-nuxt(-app)?(@.*)?$/.test(a));
  if (sub === "init" || creates || (args[0] === "create" && args[1]?.startsWith("nuxt"))) {
    return "The Nuxt project already exists. A generator overwrites the shipped app, configs and tests; add files by hand following app/ and server/.";
  }
  return undefined;
}

function serverReason(name: string, args: string[], background: boolean): string | undefined {
  if (background) return undefined;
  const sub = nuxtSubcommand(name, args);
  const script = RUNNERS.has(name) && args[0] === "run" ? args[1] : undefined;
  const servesNode = name === "node" && args.some((a) => a.endsWith(".output/server/index.mjs"));
  if (sub === "dev" || sub === "preview" || servesNode || (script && SERVER_SCRIPTS.has(script))) {
    return "A server never exits, so running it in the foreground hangs this session. Run it with run_in_background, or check the build with bun run e2e.";
  }
  return undefined;
}

function reasonFor(cmd: Command, background: boolean): string | undefined {
  const [first = "", ...args] = cmd.argv;
  const name = basename(first);
  const generator = generatorReason(name, args);
  if (generator) return generator;
  if (name === "bun" && args[0] === "test") {
    return 'bun test is bun\'s own test runner; the tests here are vitest. Use bun run test (add a file path or -t "<name>" to scope it).';
  }
  if (
    (name === "bun" || name === "bunx") &&
    args.includes("--bun") &&
    (args.some((a) => NODE_TOOL.test(a)) ||
      (args.includes("run") && args.some((a) => SCRIPTS.has(a))))
  ) {
    return "Nuxt, Vitest and Playwright run on Node in this project. Drop --bun (use bun run dev / bun run test / bun run build).";
  }
  return serverReason(name, args, background);
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
