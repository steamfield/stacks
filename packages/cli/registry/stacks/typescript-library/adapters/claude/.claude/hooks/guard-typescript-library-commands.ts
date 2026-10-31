// PreToolUse (Bash): deny commands that are wrong for this library, with the fix.
//
//   npm/bun/pnpm/yarn publish, npm unpublish, npm deprecate, npm dist-tag, changeset publish
//                                   publishing reaches every user and can't be taken back; it is
//                                   the maintainer's step
//   npm version, bun pm version     bumps the version and tags a release, also the maintainer's
//   bun test                        bun's own test runner; the tests are Vitest (bun run test)
//   --bun (-b) on vitest or a script  Vitest runs on Node here; --bun swaps in Bun's runtime
//
// Commands are read the way bash runs them (see _shell.ts), so a quoted mention (a commit message,
// bun run test -t "npm publish") passes.
import { basename } from "node:path";
import { deny, readPayload, text } from "./_lib";
import { type Command, commands } from "./_shell";

// Flags whose value is the next word (bun --cwd sub add ..., npm --workspace x publish).
const VALUE_FLAGS = new Set(["--cwd", "--filter", "-F", "--env-file", "--workspace", "-w"]);

/** The arguments that aren't flags or a flag's value. */
function words(args: string[]): string[] {
  return args.filter((a, i) => !a.startsWith("-") && !VALUE_FLAGS.has(args[i - 1] ?? ""));
}

const MANAGERS = new Set(["bun", "bunx", "npm", "npx", "pnpm", "yarn"]);
const RELEASE = new Set(["publish", "unpublish", "deprecate", "dist-tag", "version"]);

type Rule = (name: string, args: string[]) => string | undefined;

const PUBLISH_REASON =
  "Publishing, version bumps and dist-tags are the maintainer's step: they reach every user and can't be taken back. Run bun run check and stacks verify, describe the release kind (patch, minor, major) in your summary, and leave the release to the maintainer. To see what would ship, run bun pm pack --dry-run.";

/** The package binary and its arguments when the command runs one (bunx, npx, bun x). */
function executed(name: string, list: string[]): string[] {
  if (name === "bunx" || name === "npx") return list;
  if (name === "bun" && list[0] === "x") return list.slice(1);
  return [];
}

const release: Rule = (name, args) => {
  const list = words(args);
  const [first = "", second = ""] = list;
  if ((name === "npm" || name === "pnpm" || name === "yarn") && RELEASE.has(first)) {
    return PUBLISH_REASON;
  }
  if (name === "yarn" && first === "npm" && second === "publish") return PUBLISH_REASON;
  if (name === "bun" && first === "publish") return PUBLISH_REASON;
  if (name === "bun" && first === "pm" && second === "version") return PUBLISH_REASON;
  const [tool = "", subcommand = ""] = executed(name, list);
  if (/(^|\/)changeset$/.test(tool) && subcommand === "publish") return PUBLISH_REASON;
  return undefined;
};

const bunTest: Rule = (name, args) =>
  name === "bun" && words(args)[0] === "test"
    ? 'bun test is Bun\'s own test runner; the tests here are Vitest. Use bun run test (add a file path or -t "<name>" to scope it).'
    : undefined;

const forcedBun: Rule = (name, args) => {
  if (name !== "bun" && name !== "bunx") return undefined;
  if (!args.includes("--bun") && !args.includes("-b")) return undefined;
  const [first = "", second = ""] = words(args);
  const runsScript = first === "run" && !/^(\.\/)?scripts\//.test(second);
  if (!runsScript && !args.some((a) => /(^|\/)vitest$/.test(a))) return undefined;
  return "Vitest and the package scripts run on Node in this project. Drop --bun (bun run test / bun run build).";
};

const RULES: Rule[] = [release, bunTest, forcedBun];

function reasonFor(cmd: Command): string | undefined {
  const [first = "", ...args] = cmd.argv;
  const name = basename(first);
  if (!MANAGERS.has(name)) return undefined;
  for (const rule of RULES) {
    const reason = rule(name, args);
    if (reason) return reason;
  }
  return undefined;
}

const command = text(readPayload()?.tool_input?.command);
const reason = command
  ? commands(command)
      .map(reasonFor)
      .find((r) => r !== undefined)
  : undefined;
if (reason) deny(`BLOCKED: ${reason}`);
