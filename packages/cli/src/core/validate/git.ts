/**
 * Finds files excluded by an entry's own Git ignore rules. A shipped `.gitignore` also affects
 * the registry checkout and can keep a file out of the published registry even when a local
 * scaffold can see it. `HARDENING` constrains the fixed `Processes.exec` call (trust point 1).
 */
import { shippedPath } from "@steamfield/stacks-format";
import { Duration, Effect, FileSystem, Option, Path, Result } from "effect";
import { AppConfig, GIT_REPOSITORY_VARIABLES } from "../../config";
import type { SpawnFailed } from "../../errors";
import type { Finding } from "../../schemas/validate";
import { type Captured, Processes } from "../../services/processes";
import { type Entry, markdownFile } from "../registry/entry";
import { Registry } from "../registry/registry";
import type { Check, View } from "./types";
import { finding } from "./view";

/** Paths per `git check-ignore` call, well under any argv limit. */
const BATCH = 200;
/**
 * Disable hooks and filesystem monitors, and keep non-ASCII paths unquoted. NUL-delimited
 * output requires stdin, which `Processes.exec` closes. Git still quotes paths with quotes or
 * newlines, so those paths go unmatched.
 */
const HARDENING = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.quotePath=false",
] as const;

/** One `check-ignore -v` line: `<source>:<line>:<pattern>\t<path>`. */
const VERBOSE = /^(.*?):(\d+):(.*)\t(.*)$/;

/** Runs git with the hardening flags in the registry root; a spawn failure is a value. */
type RunGit = (args: ReadonlyArray<string>) => Effect.Effect<Result.Result<Captured, SpawnFailed>>;

/** The rule that ignores a path: its source file, relative to the root's real path, and pattern. */
type Rule = { source: string; pattern: string };

/** Where the rules are read from: the checkout's top and the validated root's real path. */
type Checkout = { path: Path.Path; toplevel: string; rootReal: string };

const realPath = (fs: FileSystem.FileSystem, at: string) =>
  fs.realPath(at).pipe(Effect.orElseSucceed(() => at));

/**
 * Every file the validated entries ship, plus each entry's markdown file, as root-relative paths
 * mapped to the entry that owns them.
 */
const ownedFiles = (registry: Registry["Service"], view: View) =>
  Effect.gen(function* () {
    const owners = new Map<string, Entry>();
    for (const entry of view.entries) {
      const files = yield* Effect.result(registry.files(entry));
      // An unreadable entry is reported by the file checks.
      if (Result.isFailure(files)) continue;
      for (const source of [markdownFile(entry.kind), ...files.success.map((file) => file.source)])
        owners.set(view.file(entry, source), entry);
    }
    return owners;
  });

function collectRules(checkout: Checkout, stdout: string, rules: Map<string, Rule>) {
  const { path, toplevel, rootReal } = checkout;
  for (const line of stdout.split("\n")) {
    const match = VERBOSE.exec(line);
    if (!match) continue;
    const [, source = "", , pattern = "", name = ""] = match;
    // A negated pattern that matched means the path is not ignored.
    if (pattern.startsWith("!")) continue;
    // Per-directory rule files are named relative to the top of the checkout.
    const at = path.resolve(toplevel, source);
    rules.set(name, { source: path.relative(rootReal, at), pattern });
  }
}

/**
 * The rule ignoring each of `paths`, asked of git in batches. `undefined` when git can't answer:
 * the root isn't in a checkout after all, or git failed.
 */
const readRules = (runGit: RunGit, checkout: Checkout, paths: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const rules = new Map<string, Rule>();
    for (let start = 0; start < paths.length; start += BATCH) {
      const batch = paths.slice(start, start + BATCH);
      const run = yield* runGit(["check-ignore", "--no-index", "-v", "--", ...batch]);
      // Exit 0: some paths are ignored; 1: none; anything else: not a checkout, or git failed.
      if (Result.isFailure(run) || (run.success.exitCode !== 0 && run.success.exitCode !== 1))
        return undefined;
      collectRules(checkout, run.success.stdout, rules);
    }
    return rules;
  });

/**
 * The warning for one ignored file, when the rule comes from a `.gitignore` inside its owner's
 * directory (`entryDir`, relative to the root's real path); anything else isn't the entry's doing.
 */
function ignoredFinding(
  path: Path.Path,
  ignored: { file: string; owner: Entry; rule: Rule },
  entryDir: string,
): Finding | undefined {
  const { file, owner, rule } = ignored;
  if (!rule.source.startsWith(`${entryDir}${path.sep}`)) return undefined;
  const source = rule.source.split(path.sep).join("/");
  // A .gitignore the entry ships (under files/ or adapters/) can be shipped as a template
  // instead: git doesn't read `.gitignore.tmpl`, and `new` renders it to `.gitignore`.
  const within = path.relative(entryDir, rule.source).split(path.sep).join("/");
  const shipped = shippedPath(within)?.path.split("/").at(-1) === ".gitignore";
  return finding(owner, {
    check: "git-ignored",
    severity: "warning",
    file,
    message: `git ignores ${path.basename(file)} here (rule ${rule.pattern} in ${source}), so it never reaches a commit${shipped ? `; ship ${source} as .gitignore.tmpl, which git doesn't read as ignore rules and new still writes as .gitignore` : ""}`,
  });
}

/** The checkout the root is in, or `undefined` when it is in none (or git failed). */
const findCheckout = (
  runGit: RunGit,
  at: { fs: FileSystem.FileSystem; path: Path.Path; root: string },
) =>
  Effect.gen(function* () {
    const top = yield* runGit(["rev-parse", "--show-toplevel"]);
    if (Result.isFailure(top) || top.success.exitCode !== 0) return undefined;
    return {
      path: at.path,
      toplevel: top.success.stdout.replace(/\n$/, ""),
      rootReal: yield* realPath(at.fs, at.root),
    } satisfies Checkout;
  });

const ignoredFindings = (
  fs: FileSystem.FileSystem,
  checkout: Checkout,
  found: {
    paths: ReadonlyArray<string>;
    owners: ReadonlyMap<string, Entry>;
    rules: ReadonlyMap<string, Rule>;
  },
) =>
  Effect.gen(function* () {
    const { path, rootReal } = checkout;
    const findings: Finding[] = [];
    for (const file of found.paths) {
      const owner = found.owners.get(file);
      const rule = found.rules.get(file);
      if (!owner || !rule) continue;
      const entryDir = path.relative(rootReal, yield* realPath(fs, owner.dir));
      const ignored = ignoredFinding(path, { file, owner, rule }, entryDir);
      if (ignored) findings.push(ignored);
    }
    return findings;
  });

/**
 * Inside a git checkout, no file an entry ships (nor its markdown file) may match an ignore rule
 * of the entry's own. A root under an ignored directory (`node_modules`, a dotfiles repo, a global
 * excludes file) isn't the entry's doing, so only a rule from a .gitignore inside the entry's
 * directory counts. `--no-index` checks tracked files against the rules as well. Outside a
 * checkout, or with no git on PATH, there is nothing to check.
 */
export const gitChecks: Check = (view) =>
  Effect.gen(function* () {
    if (!view.entries.length) return { findings: [] };
    const processes = yield* Processes;
    const git = yield* processes.which("git");
    if (Option.isNone(git)) return { findings: [] };
    const registry = yield* Registry;
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const config = yield* AppConfig;
    // As for new's git calls: git finds the checkout from the root alone, and a discovery limit
    // such as GIT_CEILING_DIRECTORIES still holds.
    const env = config.childEnv(GIT_REPOSITORY_VARIABLES, { LC_ALL: "C" });
    const owners = yield* ownedFiles(registry, view);
    const paths = [...owners.keys()].sort();
    const runGit: RunGit = (args) =>
      Effect.result(
        processes.exec({
          argv: [git.value, ...HARDENING, ...args],
          cwd: view.root,
          env,
          timeout: Duration.seconds(30),
        }),
      );
    const checkout = yield* findCheckout(runGit, { fs, path, root: view.root });
    if (checkout === undefined) return { findings: [] };
    const rules = yield* readRules(runGit, checkout, paths);
    if (rules === undefined) return { findings: [] };
    return { findings: yield* ignoredFindings(fs, checkout, { paths, owners, rules }) };
  });
