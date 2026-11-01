import { Duration, Effect, FileSystem, Option, Path, Result } from "effect";
import { AppConfig, GIT_REPOSITORY_VARIABLES } from "../../config";
import type { Finding } from "../../schemas/validate";
import { Processes } from "../../services/processes";
import { type Entry, markdownFile, shippedPath } from "../registry/entry";
import { Registry } from "../registry/registry";
import { type Check, finding } from "./view";

/** Paths per `git check-ignore` call, well under any argv limit. */
const BATCH = 200;
/**
 * git runs no program it finds in configuration (no hooks, no fsmonitor), and prints paths as
 * given rather than quoting non-ASCII. (`-z` needs `--stdin`, which `exec` doesn't offer; a
 * path git still quotes, one holding a newline or a quote, isn't matched back and goes unreported.)
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

/**
 * Inside a git checkout, no file an entry ships (nor its markdown file) may match an ignore rule
 * of the entry's own: an entry's literal `files/.gitignore` applies to the checkout too, so a
 * pattern such as `.env.*` silently keeps the entry's own `files/.env.example.tmpl` out of every
 * commit while local runs pass. Only a rule from a .gitignore inside the entry's directory counts;
 * a root under an ignored directory (`node_modules`, a dotfiles repo, a global excludes file)
 * isn't the entry's doing. `--no-index` checks tracked files against the rules as well. Outside a
 * checkout, or with no git on PATH, there is nothing to check. Runs git through `Processes.exec`
 * (argv, no shell) on paths the CLI listed itself; nothing from an entry is executed.
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
    const owners = new Map<string, Entry>();
    const collectOwners = (entry: Entry) =>
      Effect.gen(function* () {
        const files = yield* Effect.result(registry.files(entry));
        // An unreadable entry is reported by the file checks.
        if (Result.isFailure(files)) return;
        for (const source of [
          markdownFile(entry.kind),
          ...files.success.map((file) => file.source),
        ])
          owners.set(view.file(entry, source), entry);
      });
    for (const entry of view.entries) yield* collectOwners(entry);
    const paths = [...owners.keys()].sort();
    const runGit = (args: ReadonlyArray<string>) =>
      Effect.result(
        processes.exec({
          argv: [git.value, ...HARDENING, ...args],
          cwd: view.root,
          env,
          timeout: Duration.seconds(30),
        }),
      );
    // Per-directory rule files are named relative to the top of the checkout.
    const top = yield* runGit(["rev-parse", "--show-toplevel"]);
    if (Result.isFailure(top) || top.success.exitCode !== 0) return { findings: [] };
    const toplevel = top.success.stdout.replace(/\n$/, "");
    const real = (at: string) => fs.realPath(at).pipe(Effect.orElseSucceed(() => at));
    const rootReal = yield* real(view.root);
    /** The rule that ignores each path: its source file, relative to the root, and pattern. */
    const rules = new Map<string, { source: string; pattern: string }>();
    const collectRules = (stdout: string) => {
      for (const line of stdout.split("\n")) {
        const match = VERBOSE.exec(line);
        if (!match) continue;
        const [, source = "", , pattern = "", name = ""] = match;
        // A negated pattern that matched means the path is not ignored.
        if (pattern.startsWith("!")) continue;
        const at = path.resolve(toplevel, source);
        rules.set(name, { source: path.relative(rootReal, at), pattern });
      }
    };
    const readRules = () =>
      Effect.gen(function* () {
        for (let start = 0; start < paths.length; start += BATCH) {
          const batch = paths.slice(start, start + BATCH);
          const run = yield* runGit(["check-ignore", "--no-index", "-v", "--", ...batch]);
          // Exit 0: some paths are ignored; 1: none; anything else: not a checkout, or git failed.
          if (Result.isFailure(run) || (run.success.exitCode !== 0 && run.success.exitCode !== 1))
            return false;
          collectRules(run.success.stdout);
        }
        return true;
      });
    if (!(yield* readRules())) return { findings: [] };
    const findings: Finding[] = [];
    const checkFile = (file: string) =>
      Effect.gen(function* () {
        const owner = owners.get(file);
        const rule = rules.get(file);
        if (!owner || !rule) return;
        const entryDir = path.relative(rootReal, yield* real(owner.dir));
        // Only a rule file inside the entry's own directory is the entry's doing.
        if (!rule.source.startsWith(`${entryDir}${path.sep}`)) return;
        const source = rule.source.split(path.sep).join("/");
        // A .gitignore the entry ships (under files/ or adapters/) can be shipped as a template
        // instead: git doesn't read `.gitignore.tmpl`, and `new` renders it to `.gitignore`.
        const within = path.relative(entryDir, rule.source).split(path.sep).join("/");
        const shipped = shippedPath(within)?.path.split("/").at(-1) === ".gitignore";
        findings.push(
          finding(owner, {
            check: "git-ignored",
            severity: "warning",
            file,
            message: `git ignores ${path.basename(file)} here (rule ${rule.pattern} in ${source}), so it never reaches a commit${shipped ? `; ship ${source} as .gitignore.tmpl, which git doesn't read as ignore rules and new still writes as .gitignore` : ""}`,
          }),
        );
      });
    for (const file of paths) yield* checkFile(file);
    return { findings };
  });
