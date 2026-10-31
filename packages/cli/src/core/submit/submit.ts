import { Effect, FileSystem, Path } from "effect";
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
export const MAINTAINER_WARNINGS: ReadonlyArray<string> = [
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

const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}\/[A-Za-z0-9._-]{1,100}$/;

const blocks = (finding: Finding) =>
  finding.severity === "error" ||
  (finding.severity === "warning" && !MAINTAINER_WARNINGS.includes(finding.check));

/**
 * Validates each submitted entry in the clone's registry, as that registry's own bundled entries
 * (references resolve only inside it), with the submission checks. Fails on the readiness bar.
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
    for (const finding of own.filter(blocks))
      blockers.push({
        kind: entry.kind,
        id: entry.id,
        check: finding.check,
        severity: finding.severity === "error" ? "error" : "warning",
        ...(finding.file === undefined ? {} : { file: finding.file }),
        ...(finding.line === undefined ? {} : { line: finding.line }),
      });
  }
  if (blockers.length) return yield* new BadInput({ details: { flag: "submission", blockers } });
  return findings;
});

/** Stacks first, then by id: the branch, title and result don't depend on argument order. */
const inOrder = (entries: ReadonlyArray<PlannedEntry>) => {
  const rank = (entry: PlannedEntry) => (entry.kind === "stack" ? 0 : 1);
  return [...entries].sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1));
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
 * `submit`: checks the entries against a partial clone of the upstream repository and, unless
 * `dryRun`, opens one draft pull request adding them from the login's fork. The clone lives in a
 * temporary directory removed when the command ends, however it ends.
 */
export const submit = Effect.fn("submit.submit")(function* (options: SubmitOptions) {
  if (yield* (yield* AppConfig).offline)
    return yield* new BadInput({ details: { flag: "offline", command: "submit" } });
  if (!REPO.test(options.repo))
    return yield* new BadInput({ details: { flag: "repo", value: options.repo } });
  const sources = yield* resolveEntries(options.entries);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const temp = yield* writePermission(
        fs.makeTempDirectoryScoped({ prefix: "stacks-submit-" }),
        (error) =>
          "pathOrDescriptor" in error.reason && typeof error.reason.pathOrDescriptor === "string"
            ? path.dirname(error.reason.pathOrDescriptor)
            : undefined,
      );
      const tools = yield* preflight(temp);
      const clone = path.join(temp, "upstream");
      yield* cloneUpstream(tools, { repo: options.repo, cwd: temp, dest: clone });
      const registry = path.join(clone, REGISTRY_PATH);
      const entries = inOrder(yield* assemble({ registry, entries: sources, login: tools.login }));
      const findings = yield* checkEntries(registry, entries);
      const first = entries[0];
      const branch = first === undefined ? "entry" : `entry/${first.kind}-${first.id}`;
      const paths = yield* submittedPaths(clone, entries);
      const files = yield* stage(tools, clone, { branch, paths });
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
      const bodyFile = path.join(temp, "body.md");
      yield* writePermission(fs.writeFileString(bodyFile, body), bodyFile);
      const opened = yield* publish(tools, {
        repo: options.repo,
        clone,
        branch,
        title: title(entries),
        bodyFile,
      });
      return { ...result, ...opened } satisfies SubmitResult;
    }),
  );
});
