/**
 * Runs `stacks submit`, which proposes a user's own stacks and fragments to the public registry
 * by opening a draft pull request on GitHub.
 *
 * An author keeps personal entries (a stack or a fragment) in the user registry. `submit` copies
 * them into a temporary clone of the upstream repository, checks them there with the same
 * submission checks `stacks validate --submission` runs, and then forks, commits, pushes and
 * opens the pull request. A dry run stops after the checks and the staged file list: it still
 * logs in and clones, but forks, pushes and opens nothing.
 *
 * `commands/submit.ts` parses the flags and calls `submit`. The steps run in a fixed order:
 * `entries.ts::resolveEntries` finds the entries, `github.ts::preflight` checks `gh` and `git`,
 * `github.ts::cloneUpstream` clones, `assemble.ts::assemble` writes the entries and
 * `authors.json` into the clone, `checkEntries` validates them, `stage` stages the files,
 * `body.ts` renders the pull request text and `publish` does the GitHub writes. The clone lives
 * in a scoped temporary directory, removed however the command ends. Start at `submit`.
 */
import { Effect, FileSystem, Path, type PlatformError } from "effect";
import { AppConfig } from "../../config";
import { BadInput, type SubmissionBlocker } from "../../errors";
import type { SubmitResult } from "../../schemas/submit";
import type { Finding } from "../../schemas/validate";
import { VERSION } from "../../version";
import { Registry } from "../registry/registry";
import { sidecarPath } from "../search/sidecar";
import { validate } from "../validate/index";
import { AUTHORS_FILE, assemble, type PlannedEntry, REGISTRY_PATH } from "./assemble";
import { pullRequestBody, title } from "./body";
import { kindDir, resolveEntries } from "./entries";
import { writePermission } from "./filesystem";
import {
  cloneUpstream,
  commit,
  createPullRequest,
  editPullRequest,
  fork,
  gitLocal,
  localOk,
  openPullRequest,
  preflight,
  push,
  type Tools,
} from "./github";

export const DEFAULT_REPO = "steamfield/stacks";

/**
 * Warnings a submission may carry: what maintainers finish after the pull request (the reviewed
 * search card, dependency review). Every other warning, and every error, blocks it.
 */
const MAINTAINER_WARNINGS: ReadonlyArray<string> = [
  "search-unreviewed",
  "search-missing",
  "missing-card",
  "deps-missing",
  "deps-unreviewed",
];

export type SubmitOptions = {
  entries: ReadonlyArray<string>;
  dryRun: boolean;
  queries: ReadonlyArray<string>;
  repo: string;
};

/** A GitHub `owner/name`: GitHub's login rules for the owner, its repository characters after. */
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}\/[A-Za-z0-9._-]{1,100}$/;

/** Refuses the submission before any lookup when the CLI is offline or `repo` isn't `owner/name`. */
const checkArguments = Effect.fn("submit.checkArguments")(function* (repo: string) {
  if (yield* (yield* AppConfig).offline)
    return yield* new BadInput({ details: { flag: "offline", command: "submit" } });
  if (!REPO.test(repo)) return yield* new BadInput({ details: { flag: "repo", value: repo } });
});

const blocks = (finding: Finding) =>
  finding.severity === "error" ||
  (finding.severity === "warning" && !MAINTAINER_WARNINGS.includes(finding.check));

/** The `details.blockers` row for one blocking finding of `entry`. */
const toBlocker = (entry: PlannedEntry, finding: Finding): typeof SubmissionBlocker.Type => ({
  kind: entry.kind,
  id: entry.id,
  check: finding.check,
  severity: finding.severity === "error" ? "error" : "warning",
  ...(finding.file === undefined ? {} : { file: finding.file }),
  ...(finding.line === undefined ? {} : { line: finding.line }),
});

/**
 * Validates each submitted entry in the clone's registry, as that registry's own bundled entries
 * (references resolve only inside it), with the submission checks. Any blocking finding fails the
 * whole submission, listing every blocker; otherwise the entries' own findings are returned.
 */
const checkEntries = Effect.fn("submit.checkEntries")(function* (
  registry: string,
  entries: ReadonlyArray<PlannedEntry>,
) {
  const findings: Finding[] = [];
  const blockers: Array<typeof SubmissionBlocker.Type> = [];
  for (const entry of entries) {
    const report = yield* validate(
      { root: registry, bundled: true, only: { kind: entry.kind, id: entry.id } },
      { submission: true },
    );
    // Registry-wide findings are the upstream registry's own, not the submission's.
    const own = report.findings.filter(
      (finding) => finding.kind === entry.kind && finding.entry === entry.id,
    );
    findings.push(...own);
    blockers.push(...own.filter(blocks).map((finding) => toBlocker(entry, finding)));
  }
  if (blockers.length) return yield* new BadInput({ details: { flag: "submission", blockers } });
  return findings;
});

const kindRank = (entry: PlannedEntry) => (entry.kind === "stack" ? 0 : 1);

/** Stacks first, then by id: the branch, title and result don't depend on argument order. */
const inOrder = (entries: ReadonlyArray<PlannedEntry>) =>
  [...entries].sort((a, b) => kindRank(a) - kindRank(b) || (a.id < b.id ? -1 : 1));

/** The fork's branch, named for the first entry in `inOrder` order. */
const branchName = (entries: ReadonlyArray<PlannedEntry>) => {
  const first = entries[0];
  return first === undefined ? "entry" : `entry/${first.kind}-${first.id}`;
};

/** Each entry's description, read from the assembled clone, for the pull request body. */
const describe = (registry: string, entries: ReadonlyArray<PlannedEntry>) =>
  Effect.gen(function* () {
    const loaded = yield* Registry;
    const described = [];
    for (const entry of entries) {
      const found = yield* Effect.result(loaded.get(entry.kind, entry.id));
      described.push({
        ...entry,
        description: found._tag === "Success" ? found.success.meta.description : "",
      });
    }
    return described;
  }).pipe(Effect.provide(Registry.layer([{ origin: "bundled", path: registry }])));

/**
 * What a submission touches in the clone, repository-relative: each entry directory, each card
 * that exists, and `authors.json`.
 */
const submittedPaths = Effect.fn("submit.submittedPaths")(function* (
  clone: string,
  entries: ReadonlyArray<PlannedEntry>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const paths: string[] = [];
  for (const entry of entries) paths.push(`${REGISTRY_PATH}/${kindDir(entry.kind)}/${entry.id}`);
  for (const entry of entries) {
    const card = `${REGISTRY_PATH}/${sidecarPath(entry)}`;
    if (yield* fs.exists(path.join(clone, card)).pipe(Effect.orElseSucceed(() => false)))
      paths.push(card);
  }
  paths.push(`${REGISTRY_PATH}/${AUTHORS_FILE}`);
  return paths;
});

/**
 * Stages exactly the submitted paths, including files the upstream `.gitignore` would skip (an
 * entry ships `.vscode/` or `dist/` on purpose), and lists what changed; nothing changed is
 * refused.
 */
const stage = Effect.fn("submit.stage")(function* (
  tools: Tools,
  clone: string,
  options: { branch: string; paths: ReadonlyArray<string> },
) {
  yield* localOk(yield* gitLocal(tools, clone, ["checkout", "--quiet", "-b", options.branch]));
  yield* localOk(
    yield* gitLocal(tools, clone, ["add", "--all", "--force", "--", ...options.paths]),
  );
  const staged = yield* gitLocal(tools, clone, ["diff", "--cached", "--name-only", "-z"]);
  yield* localOk(staged);
  const files = staged.stdout
    .split("\0")
    .filter((file) => file !== "")
    .sort();
  if (!files.length) return yield* new BadInput({ details: { flag: "unchanged" } });
  return files;
});

/** Fork, commit, push and the draft pull request: everything `--dry-run` leaves out. */
const publish = Effect.fn("submit.publish")(function* (
  tools: Tools,
  options: { repo: string; clone: string; branch: string; title: string; bodyFile: string },
) {
  const forked = yield* fork(tools, options.repo, options.clone);
  yield* commit(tools, options.clone, options.title);
  yield* push(tools, {
    cwd: options.clone,
    repo: options.repo,
    fork: forked,
    branch: options.branch,
  });
  const open = yield* openPullRequest(tools, { ...options, cwd: options.clone });
  if (open !== undefined) {
    yield* editPullRequest(tools, { ...options, url: open, cwd: options.clone });
    return { prUrl: open, reused: true };
  }
  const prUrl = yield* createPullRequest(tools, { ...options, cwd: options.clone });
  return { prUrl, reused: false };
});

/**
 * The directory a failed temporary-directory creation was refused in: the parent of the path the
 * platform error names, so a denial reports the unwritable `TMPDIR` itself.
 */
const tempParent = (path: Path.Path) => (error: PlatformError.PlatformError) =>
  "pathOrDescriptor" in error.reason && typeof error.reason.pathOrDescriptor === "string"
    ? path.dirname(error.reason.pathOrDescriptor)
    : undefined;

/** The scoped temporary directory holding the clone and the body file. */
const makeWorkspace = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* writePermission(
    fs.makeTempDirectoryScoped({ prefix: "stacks-submit-" }),
    tempParent(path),
  );
});

/** Writes the pull request body where `gh --body-file` reads it, and returns that path. */
const writeBody = Effect.fn("submit.writeBody")(function* (temp: string, body: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const bodyFile = path.join(temp, "body.md");
  yield* writePermission(fs.writeFileString(bodyFile, body), bodyFile);
  return bodyFile;
});

/**
 * `submit`: checks the entries against a partial clone of the upstream repository and, unless
 * `dryRun`, opens one draft pull request adding them from the login's fork. The clone lives in a
 * temporary directory removed when the command ends, however it ends.
 */
export const submit = Effect.fn("submit.submit")(function* (options: SubmitOptions) {
  yield* checkArguments(options.repo);
  const sources = yield* resolveEntries(options.entries);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const temp = yield* makeWorkspace;
      const tools = yield* preflight(temp);
      const clone = path.join(temp, "upstream");
      yield* cloneUpstream(tools, { repo: options.repo, cwd: temp, dest: clone });
      const registry = path.join(clone, REGISTRY_PATH);
      const entries = inOrder(yield* assemble({ registry, entries: sources, login: tools.login }));
      const findings = yield* checkEntries(registry, entries);
      const branch = branchName(entries);
      const files = yield* stage(tools, clone, {
        branch,
        paths: yield* submittedPaths(clone, entries),
      });
      const body = pullRequestBody({
        entries: yield* describe(registry, entries),
        findings,
        queries: options.queries,
        author: tools.login,
        version: VERSION,
      });
      const result = {
        repo: options.repo,
        entries: entries.map(({ kind, id, update }) => ({ kind, id, update })),
        author: tools.login,
        branch,
        dryRun: options.dryRun,
        findings,
        files,
      };
      if (options.dryRun)
        return { ...result, prUrl: null, reused: false, body } satisfies SubmitResult;
      const opened = yield* publish(tools, {
        repo: options.repo,
        clone,
        branch,
        title: title(entries),
        bodyFile: yield* writeBody(temp, body),
      });
      return { ...result, ...opened } satisfies SubmitResult;
    }),
  );
});
