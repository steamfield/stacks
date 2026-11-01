// PreToolUse (Bash): deny commands that are wrong for this stack, with the fix.
//
//   bun test                          bun's own test runner; the tests are Vitest (bun run test)
//   --bun (-b) on vitest or a script  the server and tests run on Node here
//   bun|node|tsx|ts-node src/....ts   Nest needs decorator metadata, which only the build (nest
//                                     build) and Vitest emit; bun run dev or build && start
//   adding jest, ts-jest, ts-node     the tests are Vitest and the build is nest build
//   adding typescript, no version     resolves the newest major, which the Nest CLI may not load;
//                                     the message names the range the installed CLI declares
//   nest new                          the project exists; generate pieces with nest g
//   bun run dev, not in background    nest start --watch never exits and blocks the tool call
//
// Commands are read the way bash runs them (see _shell.ts), so a quoted mention (a commit message,
// bun run test -t "bun test") passes.
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { deny, projectRoot, readPayload, text } from "./_lib";
import { type Command, commands } from "./_shell";

// Flags whose value is the next word (bun --cwd sub add ...).
const VALUE_FLAGS = new Set(["--cwd", "--filter", "-F", "--env-file"]);

/** The first argument that isn't a flag or a flag's value, skipping a leading `run` when `skipRun` is set. */
function target(args: string[], skipRun: boolean): string {
  const words = args.filter((a, i) => !a.startsWith("-") && !VALUE_FLAGS.has(args[i - 1] ?? ""));
  return (skipRun && words[0] === "run" ? words[1] : words[0]) ?? "";
}

const MANAGERS = new Set(["bun", "bunx", "npm", "npx", "pnpm", "yarn"]);
const RUNNERS = new Set(["node", "tsx", "ts-node", "ts-node-esm"]);
const INSTALL_VERBS = new Set(["add", "install", "i"]);
const JEST = /^(jest|ts-jest|@types\/jest|ts-node|@swc\/jest)(@.*)?$/;

type Rule = (name: string, args: string[], background: boolean) => string | undefined;

/** The packages an install command names, or [] when it isn't one. */
function installed(name: string, args: string[]): string[] {
  if (name === "bunx" || name === "npx" || !INSTALL_VERBS.has(target(args, false))) return [];
  const verb = args.indexOf(target(args, false));
  return args.slice(verb + 1).filter((a) => !a.startsWith("-"));
}

/** The TypeScript range the installed Nest CLI declares, when it can be read. */
function cliTypescriptRange(): string | undefined {
  try {
    const manifest = JSON.parse(
      readFileSync(join(projectRoot(), "node_modules/@nestjs/cli/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    return manifest.dependencies?.typescript;
  } catch {
    return undefined;
  }
}

const jestInstall: Rule = (name, args) =>
  installed(name, args).some((pkg) => JEST.test(pkg))
    ? "The tests here are Vitest (bun run test, bun run test:e2e) and the build is nest build; jest, ts-jest and ts-node aren't used. Write *.spec.ts beside the code with imports from vitest."
    : undefined;

const unpinnedTypescript: Rule = (name, args) => {
  if (!installed(name, args).some((pkg) => /^typescript(@(latest|next))?$/.test(pkg))) {
    return undefined;
  }
  const range = cliTypescriptRange();
  const which = range
    ? `The installed Nest CLI declares typescript ${range}`
    : "Read the typescript range in node_modules/@nestjs/cli/package.json";
  return `Adding typescript without a version takes the newest major, which the Nest CLI may not load (nest build and nest g stop with an error). ${which}; add the newest release inside it, as typescript@<major>.`;
};

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

const nestNew: Rule = (name, args) => {
  const nest = nestArgs(name, args);
  return nest && (nest[0] === "new" || nest[0] === "n")
    ? "This project already exists. Generate a module, controller or service with bunx nest g <schematic> <name> --no-spec, then write the spec with imports from vitest."
    : undefined;
};

const forcedBun: Rule = (name, args) => {
  if (name !== "bun" && name !== "bunx") return undefined;
  if (!args.includes("--bun") && !args.includes("-b")) return undefined;
  const runsScript = args.includes("run") && !/^(\.\/)?scripts\//.test(target(args, true));
  if (!runsScript && !args.some((a) => /(^|\/)(vitest|nest)$/.test(a))) return undefined;
  return "The server and Vitest run on Node in this project. Drop --bun (bun run test / bun run build / bun run start).";
};

const bunTest: Rule = (name, args) =>
  name === "bun" && target(args, false) === "test"
    ? 'bun test is Bun\'s own test runner; the tests here are Vitest. Use bun run test or bun run test:e2e (add a file path or -t "<name>" to scope it).'
    : undefined;

const SOURCE = /^(\.\/)?src\/.*\.ts$/;
const RUN_SOURCE =
  "Nest needs decorator metadata, which only nest build and Vitest emit; running src/*.ts directly injects undefined or fails to start. Use bun run dev (in the background) or bun run build && bun run start.";

const sourceUnderBun: Rule = (name, args) =>
  name === "bun" && SOURCE.test(target(args, true)) ? RUN_SOURCE : undefined;

const foregroundDev: Rule = (name, args, background) => {
  if (background) return undefined;
  const nest = nestArgs(name, args);
  const dev = !nest && name !== "bunx" && name !== "npx" && target(args, true) === "dev";
  const watch = nest?.[0] === "start" && nest.some((a) => a === "--watch" || a === "-w");
  return dev || watch
    ? "nest start --watch never exits and would block this call. Run bun run dev with run_in_background, or bun run build and then PORT_API=<free port> bun run start in the background."
    : undefined;
};

const RULES: Rule[] = [
  jestInstall,
  unpinnedTypescript,
  nestNew,
  forcedBun,
  bunTest,
  sourceUnderBun,
  foregroundDev,
];

function reasonFor(cmd: Command, background: boolean): string | undefined {
  const [first = "", ...args] = cmd.argv;
  const name = basename(first);
  // bunx tsx src/main.ts runs the same runner as tsx src/main.ts.
  const viaPackage = (name === "bunx" || name === "npx") && RUNNERS.has(args[0] ?? "");
  if (RUNNERS.has(name) || viaPackage) {
    return args.some((a) => SOURCE.test(a)) ? RUN_SOURCE : undefined;
  }
  if (!MANAGERS.has(name) && name !== "nest") return undefined;
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
