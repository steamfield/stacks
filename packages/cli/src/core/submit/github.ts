import { GitHubLogin } from "@steamfield/stacks-format";
import { Duration, Effect, Option, Schema } from "effect";
import { AppConfig, GIT_REPOSITORY_VARIABLES } from "../../config";
import { BadInput, PermissionDenied, UpstreamUnavailable } from "../../errors";
import { type Captured, Processes } from "../../services/processes";
import { shellArg } from "../shell";

/**
 * Every program `submit` runs is `gh` or `git`, found with `Processes.which` and run through
 * `Processes.exec` with fixed argv; only CLI-built values (the repository, branch, paths, a title
 * and a body file) fill the arguments, and nothing from an entry is executed (Trust model, point
 * 1). The CLI holds no credentials: `gh` authenticates its own requests and git's pushes.
 */
export type Tools = { gh: string; git: string; login: string };
export type Step = "auth" | "clone" | "fork" | "push" | "pr";

const QUICK = Duration.seconds(60);
const NETWORK = Duration.minutes(5);
const LOCAL = Duration.seconds(30);
/** A fresh fork can take a few seconds to accept pushes. */
const FORK_WAIT = Duration.seconds(3);
const PUSH_ATTEMPTS = 5;

/**
 * Never prompt: a missing credential fails fast instead of waiting on a closed stdin. git finds
 * its repository from `cwd` alone, and its messages stay untranslated for the checks below.
 */
const toolEnv = (config: typeof AppConfig.Service) =>
  config.childEnv(GIT_REPOSITORY_VARIABLES, {
    GIT_TERMINAL_PROMPT: "0",
    GH_PROMPT_DISABLED: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
    LC_ALL: "C",
  });

const exec = Effect.fn("submit.exec")(function* (
  argv: readonly [string, ...string[]],
  options: { cwd: string; timeout: Duration.Duration; step: Step },
) {
  const processes = yield* Processes;
  const env = toolEnv(yield* AppConfig);
  return yield* processes
    .exec({ argv, cwd: options.cwd, env, timeout: options.timeout })
    .pipe(
      Effect.mapError(
        () => new UpstreamUnavailable({ details: { service: "github", step: options.step } }),
      ),
    );
});

const ok = (run: Captured) => run.exitCode === 0 && !run.timedOut;
const DENIED =
  /permission to .* denied|\b403\b|forbidden|not accessible by|must have admin rights/i;
const MISSING = /not found|does not exist|could not resolve to a repository/i;

/** A failed GitHub request: a refusal for this login is the human's to fix, anything else retries. */
function failed(run: Captured, step: Step) {
  if ((step === "fork" || step === "push") && !run.timedOut && DENIED.test(run.stderr))
    return new PermissionDenied({ details: { reason: "github" } });
  return new UpstreamUnavailable({ details: { service: "github", step } });
}

/** `gh` and `git` on PATH, `gh` logged in, and the login it uses. */
export const preflight = Effect.fn("submit.preflight")(function* (cwd: string) {
  const processes = yield* Processes;
  const gh = Option.getOrUndefined(yield* processes.which("gh"));
  if (gh === undefined)
    return yield* new BadInput({ details: { flag: "tool", tool: "gh", reason: "missing" } });
  const git = Option.getOrUndefined(yield* processes.which("git"));
  if (git === undefined)
    return yield* new BadInput({ details: { flag: "tool", tool: "git", reason: "missing" } });
  const status = yield* exec([gh, "auth", "status"], { cwd, timeout: QUICK, step: "auth" });
  if (status.timedOut) return yield* failed(status, "auth");
  if (!ok(status))
    return yield* new BadInput({
      details: { flag: "tool", tool: "gh", reason: "unauthenticated" },
    });
  const user = yield* exec([gh, "api", "user", "--jq", ".login"], {
    cwd,
    timeout: QUICK,
    step: "auth",
  });
  if (!ok(user)) return yield* failed(user, "auth");
  const login = yield* Schema.decodeUnknownEffect(GitHubLogin)(user.stdout.trim()).pipe(
    Effect.mapError(
      () => new UpstreamUnavailable({ details: { service: "github", step: "auth" } }),
    ),
  );
  return { gh, git, login } satisfies Tools;
});

/** No hook the user configured runs in the CLI's own temporary checkout. */
const NO_HOOKS = ["-c", "core.hooksPath=/dev/null"] as const;

/** git's credentials come from `gh` alone, never a helper the user configured. */
const credentials = (tools: Tools) => [
  "-c",
  "credential.helper=",
  "-c",
  `credential.helper=!${shellArg(tools.gh)} auth git-credential`,
];

/** A git command that talks to GitHub: no hooks, and `gh`'s credentials. */
const remoteGit = (tools: Tools, args: ReadonlyArray<string>) =>
  [tools.git, ...NO_HOOKS, ...credentials(tools), ...args] as const;

/** A partial, shallow clone of `repo`'s `main` into `dest`. */
export const cloneUpstream = Effect.fn("submit.clone")(function* (
  tools: Tools,
  options: { repo: string; cwd: string; dest: string },
) {
  const cloned = yield* exec(
    remoteGit(tools, [
      "clone",
      "--quiet",
      "--filter=blob:none",
      "--depth",
      "1",
      "--branch",
      "main",
      "--single-branch",
      `https://github.com/${options.repo}.git`,
      options.dest,
    ]),
    { cwd: options.cwd, timeout: NETWORK, step: "clone" },
  );
  if (ok(cloned)) return;
  if (!cloned.timedOut && MISSING.test(cloned.stderr))
    return yield* new BadInput({ details: { flag: "repo", value: options.repo } });
  return yield* failed(cloned, "clone");
});

/**
 * A git command in the clone, which can only fail on a broken local setup: no hooks run, since
 * the clone is the CLI's own temporary checkout.
 */
export const gitLocal = Effect.fn("submit.gitLocal")(function* (
  tools: Tools,
  cwd: string,
  args: ReadonlyArray<string>,
) {
  return yield* exec([tools.git, ...NO_HOOKS, ...args], {
    cwd,
    timeout: LOCAL,
    step: "clone",
  });
});

/** Fails a local git command that didn't succeed as a defect: the CLI's own checkout broke. */
export const localOk = (run: Captured) =>
  ok(run) ? Effect.void : Effect.die(new Error("A git command in the submission clone failed."));

/**
 * Commits the staged registry, unsigned whatever the user's git config says (a signing setup can
 * prompt or fail in a non-interactive run); a missing author identity is the user's to set.
 */
export const commit = Effect.fn("submit.commit")(function* (
  tools: Tools,
  cwd: string,
  message: string,
) {
  const committed = yield* gitLocal(tools, cwd, [
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    message,
  ]);
  if (ok(committed)) return;
  if (/tell me who you are|user\.email|user\.name|empty ident/i.test(committed.stderr))
    return yield* new BadInput({ details: { flag: "git_identity" } });
  return yield* localOk(committed);
});

/** Forks `repo` for the login (an existing fork is reused) and returns the fork's `owner/name`. */
export const fork = Effect.fn("submit.fork")(function* (tools: Tools, repo: string, cwd: string) {
  const forked = yield* exec([tools.gh, "repo", "fork", repo, "--clone=false"], {
    cwd,
    timeout: QUICK,
    step: "fork",
  });
  if (!ok(forked)) return yield* failed(forked, "fork");
  // gh names the fork on stdout or stderr; a fork renamed to avoid a clash keeps its new name.
  const named = new RegExp(`\\b${tools.login}/([A-Za-z0-9._-]+)`, "i").exec(
    `${forked.stdout}\n${forked.stderr}`,
  );
  return `${tools.login}/${named?.[1]?.replace(/\.git$/, "") ?? repo.slice(repo.indexOf("/") + 1)}`;
});

/** The subject `submit` gives its commits (`body.ts::title`). */
const SUBMIT_SUBJECT = /^feat\(registry\): (?:add|update) /;

/** `Name <email>` from `git var GIT_AUTHOR_IDENT`, without its timestamp. */
const ident = (text: string) => text.trim().replace(/ \d+ [+-]\d{4}$/, "");

/**
 * Refuses the fork's branch (`branch_taken`) unless its tip `tip` is one commit `submit` made:
 * its subject, this user's git author identity, and a single parent on the upstream `main`.
 * Anything else (a commit pushed by hand, a maintainer's fixup, a rebase onto another base) is
 * someone else's work, and replacing the branch would lose it.
 */
const ownBranch = Effect.fn("submit.ownBranch")(function* (
  tools: Tools,
  options: { cwd: string; url: string; ref: string; branch: string; tip: string },
) {
  const { cwd } = options;
  const fetched = yield* exec(
    remoteGit(tools, [
      "fetch",
      "--quiet",
      "--filter=tree:0",
      "--depth=2",
      options.url,
      options.ref,
    ]),
    { cwd, timeout: NETWORK, step: "push" },
  );
  if (!ok(fetched)) return yield* failed(fetched, "push");
  const shown = yield* gitLocal(tools, cwd, [
    "log",
    "-1",
    "--format=%P%x00%an <%ae>%x00%s",
    options.tip,
  ]);
  const me = yield* gitLocal(tools, cwd, ["var", "GIT_AUTHOR_IDENT"]);
  yield* localOk(me);
  const [parents = "", author = "", subject = ""] = shown.stdout.trim().split("\0");
  const taken = new BadInput({ details: { flag: "branch_taken", branch: options.branch } });
  if (!ok(shown) || !/^[0-9a-f]+$/.test(parents) || author !== ident(me.stdout))
    return yield* taken;
  if (!SUBMIT_SUBJECT.test(subject)) return yield* taken;
  // The clone holds one commit of main; its whole history, commits only, settles the parent.
  const deepened = yield* exec(
    remoteGit(tools, ["fetch", "--quiet", "--filter=tree:0", "--unshallow", "origin", "main"]),
    { cwd, timeout: NETWORK, step: "push" },
  );
  if (!ok(deepened)) return yield* failed(deepened, "push");
  const onMain = yield* gitLocal(tools, cwd, ["merge-base", "--is-ancestor", parents, "main"]);
  if (!ok(onMain)) return yield* taken;
});

/**
 * Pushes HEAD to the fork's `branch`. A new branch is pushed only while it is still absent. An
 * existing one is fetched and replaced only when its tip is `submit`'s own earlier push
 * (`ownBranch`), leased on that commit so a push someone makes meanwhile isn't lost.
 */
export const push = Effect.fn("submit.push")(function* (
  tools: Tools,
  options: { cwd: string; fork: string; branch: string },
) {
  const url = `https://github.com/${options.fork}.git`;
  const ref = `refs/heads/${options.branch}`;
  for (let attempt = 1; ; attempt++) {
    const remote = yield* exec(remoteGit(tools, ["ls-remote", url, ref]), {
      cwd: options.cwd,
      timeout: QUICK,
      step: "push",
    });
    const tip = remote.stdout.split(/\s/)[0] ?? "";
    if (ok(remote) && tip !== "") yield* ownBranch(tools, { ...options, url, ref, tip });
    const pushed = ok(remote)
      ? yield* exec(
          remoteGit(tools, [
            "push",
            "--quiet",
            `--force-with-lease=${ref}:${tip}`,
            url,
            `HEAD:${ref}`,
          ]),
          { cwd: options.cwd, timeout: NETWORK, step: "push" },
        )
      : remote;
    if (ok(pushed)) return;
    if (attempt >= PUSH_ATTEMPTS || pushed.timedOut || !MISSING.test(pushed.stderr))
      return yield* failed(pushed, "push");
    yield* Effect.sleep(FORK_WAIT);
  }
});

/** The open pull request from the fork's branch, if there is one. */
export const openPullRequest = Effect.fn("submit.openPullRequest")(function* (
  tools: Tools,
  options: { repo: string; branch: string; cwd: string },
) {
  const viewed = yield* exec(
    [
      tools.gh,
      "pr",
      "view",
      `${tools.login}:${options.branch}`,
      "--repo",
      options.repo,
      "--json",
      "url,state",
      "--jq",
      'select(.state == "OPEN") | .url',
    ],
    { cwd: options.cwd, timeout: QUICK, step: "pr" },
  );
  // gh exits 1 when no pull request has this head; a timeout is a network failure.
  if (viewed.timedOut) return yield* failed(viewed, "pr");
  const url = viewed.stdout.trim();
  return ok(viewed) && url.startsWith("https://") ? url : undefined;
});

export const createPullRequest = Effect.fn("submit.createPullRequest")(function* (
  tools: Tools,
  options: { repo: string; branch: string; title: string; bodyFile: string; cwd: string },
) {
  const created = yield* exec(
    [
      tools.gh,
      "pr",
      "create",
      "--draft",
      "--repo",
      options.repo,
      "--base",
      "main",
      "--head",
      `${tools.login}:${options.branch}`,
      "--title",
      options.title,
      "--body-file",
      options.bodyFile,
    ],
    { cwd: options.cwd, timeout: QUICK, step: "pr" },
  );
  const url = created.stdout
    .split("\n")
    .map((line) => line.trim())
    .findLast((line) => line.startsWith("https://"));
  if (!ok(created) || url === undefined) return yield* failed(created, "pr");
  return url;
});

/** Rewrites a reused pull request's title and body to match this submission. */
export const editPullRequest = Effect.fn("submit.editPullRequest")(function* (
  tools: Tools,
  options: { url: string; title: string; bodyFile: string; cwd: string },
) {
  const edited = yield* exec(
    [
      tools.gh,
      "pr",
      "edit",
      options.url,
      "--title",
      options.title,
      "--body-file",
      options.bodyFile,
    ],
    { cwd: options.cwd, timeout: QUICK, step: "pr" },
  );
  if (!ok(edited)) return yield* failed(edited, "pr");
});
