// Protect the Node unit runner and explicitly scoped Bun binary/native tests.
import { basename, isAbsolute, relative, resolve } from "node:path";
import { deny, projectRoot, readPayload, text } from "./_lib";
import { type Command, commands } from "./_shell";

const VALUE_FLAGS = new Set([
  "-t",
  "--test-name-pattern",
  "--timeout",
  "--preload",
  "--rerun-each",
  "--retry",
  "--seed",
  "--max-concurrency",
  "--reporter",
  "--reporter-outfile",
  "--coverage-reporter",
  "--coverage-dir",
]);
const UNIT_SCRIPTS = new Set(["test", "test:unit", "test:watch", "coverage"]);
// A package's e2e/ from inside it (`bun test ./e2e`) or from the repo root
// (`bun test ./packages/<name>/e2e`).
const E2E_ROOT = /^\.\/(?:packages\/[\w.-]+\/)?e2e(?:\/|$)/;

const payload = readPayload();
const command = text(payload?.tool_input?.command);
const start = text(payload?.cwd) || process.cwd();
const root = projectRoot();

/** The directory `bun add` installs into, or null when it can't be known from the line. */
function installDir({ dir }: Command, args: ReadonlyArray<string>): string | null {
  if (dir === null) return null;
  const at = resolve(start, dir ?? ".");
  const flag = args.findIndex((arg) => arg === "--cwd" || arg.startsWith("--cwd="));
  if (flag === -1) return at;
  const value = args[flag]?.startsWith("--cwd=") ? args[flag].slice(6) : args[flag + 1];
  if (value === undefined || /[$~`]/.test(value)) return null;
  return resolve(at, value);
}

// The schema rule protects this repository's packages; a project scaffolded elsewhere picks its own.
function insideProject(dir: string | null): boolean {
  if (dir === null) return true;
  const path = relative(root, dir);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

for (const parsed of commands(command ?? "")) {
  const { argv } = parsed;
  const [first = "", ...args] = argv;
  const name = basename(first);
  const vitest = args.some((arg) => basename(arg) === "vitest");
  const unitScript = args.includes("run") && args.some((arg) => UNIT_SCRIPTS.has(arg));
  if (["bun", "bunx"].includes(name) && args.includes("--bun") && (vitest || unitScript)) {
    deny("BLOCKED: Vitest runs on Node. Drop --bun and use the project test commands.");
    break;
  }
  if (name === "bun" && args[0] === "test") {
    const rest = args.slice(1);
    const positional = rest.filter(
      (arg, index) => !arg.startsWith("-") && !VALUE_FLAGS.has(rest[index - 1] ?? ""),
    );
    const paths = positional.filter((arg) => arg.includes("/") || /\.[cm]?[jt]sx?$/.test(arg));
    const scoped =
      paths.length > 0 &&
      paths.every((path) => !path.split("/").includes("..") && E2E_ROOT.test(path));
    if (!scoped) {
      deny(
        "BLOCKED: Scope Bun's runner to its declared binary/native tests; use bun run test for the Node unit suite.",
      );
      break;
    }
  }
  if (
    name === "bun" &&
    ["add", "install", "i", "a"].includes(args[0] ?? "") &&
    args.some((arg) => /^(?:zod|@effect\/(?:schema|platform))(@|$)/.test(arg)) &&
    insideProject(installDir(parsed, args))
  ) {
    deny(
      "BLOCKED: Use Schema and platform modules from the installed effect package, not competing schema or legacy platform packages.",
    );
    break;
  }
}
