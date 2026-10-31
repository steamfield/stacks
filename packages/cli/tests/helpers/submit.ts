import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./cli";
import { smallRegistry } from "./registry";

/** The real git the fake delegates local commands to, found on the test runner's PATH. */
const REAL_GIT = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();

/** Appends `<tool>\x1f<arg>\x1f<arg>...` to `$FAKE_LOG`, one line per call. */
const LOG = `{ printf '%s' "$(basename "$0")"; for a in "$@"; do printf '\\037%s' "$a"; done; printf '\\n'; } >> "$FAKE_LOG"`;

const GH = `#!/bin/sh
${LOG}
case "$1 $2" in
  "auth status") exit "\${FAKE_GH_AUTH:-0}" ;;
  "api user") printf '%s\\n' "$FAKE_GH_LOGIN"; exit 0 ;;
  "repo fork")
    if [ -n "$FAKE_GH_FORK_SLEEP" ]; then sleep "$FAKE_GH_FORK_SLEEP"; fi
    if [ -n "$FAKE_GH_FORK_FAIL" ]; then printf '%s\\n' "$FAKE_GH_FORK_FAIL" >&2; exit 1; fi
    printf '! %s/stacks already exists\\n' "$FAKE_GH_LOGIN" >&2; exit 0 ;;
  "pr view")
    if [ -n "$FAKE_GH_PR" ]; then printf '%s\\n' "$FAKE_GH_PR"; exit 0; fi
    printf 'no pull requests found for branch\\n' >&2; exit 1 ;;
  "api repos/"*)
    if [ -n "$FAKE_GH_COMPARE_FAIL" ]; then printf '%s\\n' "$FAKE_GH_COMPARE_FAIL" >&2; exit 1; fi
    # The compare API's status for <base>...main, answered from the clone (gh's working directory).
    base=\${2##*/compare/}; base=\${base%...main}
    if [ "$base" = "$("${REAL_GIT}" rev-parse main)" ]; then echo identical
    elif "${REAL_GIT}" merge-base --is-ancestor "$base" main; then echo ahead
    elif "${REAL_GIT}" merge-base --is-ancestor main "$base"; then echo behind
    else echo diverged; fi
    exit 0 ;;
  "pr edit")
    prev=""
    for a in "$@"; do [ "$prev" = "--body-file" ] && cp "$a" "$FAKE_LOG.edit-body"; prev="$a"; done
    exit 0 ;;
  "pr create")
    prev=""
    for a in "$@"; do [ "$prev" = "--body-file" ] && cp "$a" "$FAKE_LOG.body"; prev="$a"; done
    printf 'https://github.com/steamfield/stacks/pull/42\\n'; exit 0 ;;
esac
printf 'fake gh: unexpected call\\n' >&2
exit 2
`;

const GIT = `#!/bin/sh
${LOG}
sub=""; skip=0
for a in "$@"; do
  if [ "$skip" = 1 ]; then skip=0; continue; fi
  case "$a" in -c|-C) skip=1 ;; -*) ;; *) sub="$a"; break ;; esac
done
case "$sub" in
  clone)
    if [ -n "$FAKE_CLONE_FAIL" ]; then printf '%s\\n' "$FAKE_CLONE_FAIL" >&2; exit 128; fi
    for a in "$@"; do dest="$a"; done
    cp -R "$FAKE_UPSTREAM" "$dest" && cd "$dest" &&
      "${REAL_GIT}" init -q -b main && "${REAL_GIT}" add -A &&
      "${REAL_GIT}" -c user.name=upstream -c user.email=upstream@example.invalid -c commit.gpgsign=false commit -q -m upstream
    exit $? ;;
  ls-remote)
    # FAKE_REMOTE_TIP puts a commit on the fork's branch: one submit made on top of main, someone
    # else's on top of main, or submit's on top of a commit main doesn't have.
    case "$FAKE_REMOTE_TIP" in
      submit) tip=$("${REAL_GIT}" commit-tree "main^{tree}" -p main -m "feat(registry): add demo-app stack") ;;
      other) tip=$(GIT_AUTHOR_NAME=Someone GIT_AUTHOR_EMAIL=someone@example.invalid \\
        "${REAL_GIT}" commit-tree "main^{tree}" -p main -m "Fix a typo in the README") ;;
      off-main)
        base=$("${REAL_GIT}" commit-tree "main^{tree}" -m "Someone's base")
        tip=$("${REAL_GIT}" commit-tree "main^{tree}" -p "$base" -m "feat(registry): add demo-app stack") ;;
      behind)
        tip=$("${REAL_GIT}" commit-tree "main^{tree}" -p main -m "feat(registry): add demo-app stack")
        "${REAL_GIT}" update-ref refs/heads/main "$("${REAL_GIT}" commit-tree "main^{tree}" -p main -m "Upstream moves on")" ;;
      *) tip="$FAKE_REMOTE_SHA" ;;
    esac
    if [ -n "$tip" ]; then printf '%s\\trefs/heads/branch\\n' "$tip"; printf '%s\\n' "$tip" > "$FAKE_LOG.tip"; fi
    exit 0 ;;
  fetch) exit 0 ;;
  push)
    if [ -n "$FAKE_PUSH_FAIL" ]; then printf '%s\\n' "$FAKE_PUSH_FAIL" >&2; exit 1; fi
    if [ -n "$FAKE_PUSH_FAIL_ONCE" ] && [ ! -e "$FAKE_LOG.push-failed" ]; then
      : > "$FAKE_LOG.push-failed"; printf '%s\\n' "$FAKE_PUSH_FAIL_ONCE" >&2; exit 1
    fi
    [ -d "$FAKE_LOG.pushed" ] || cp -R . "$FAKE_LOG.pushed"
    exit 0 ;;
esac
exec "${REAL_GIT}" "$@"
`;

/**
 * Fake `gh` and `git` on a PATH of their own: each logs its argv, `gh` answers as a logged-in
 * user with no open pull request, and `git clone` copies `upstream` (a plain directory holding
 * `packages/cli/registry`, the small fixture registry) into a fresh repository. Every other git
 * command runs the real git, except `ls-remote`, `fetch` and `push`, which touch no network:
 * `ls-remote` makes the fork branch's commit (`FAKE_REMOTE_TIP`) in the clone itself, so `fetch`
 * has nothing to do, and `gh api .../compare/<base>...main` answers from the clone's `main`.
 */
export function fakeGitHub() {
  const temp = tempDir();
  const bin = join(temp.path, "bin");
  const upstream = join(temp.path, "upstream");
  const log = join(temp.path, "calls.log");
  mkdirSync(bin);
  for (const [name, text] of [
    ["gh", GH],
    ["git", GIT],
  ] as const) {
    writeFileSync(join(bin, name), text);
    chmodSync(join(bin, name), 0o755);
  }
  cpSync(smallRegistry, join(upstream, "packages", "cli", "registry"), { recursive: true });
  const env = {
    PATH: `${bin}:/usr/bin:/bin`,
    FAKE_LOG: log,
    FAKE_UPSTREAM: upstream,
    FAKE_GH_LOGIN: "octo-author",
    GIT_AUTHOR_NAME: "Octo Author",
    GIT_AUTHOR_EMAIL: "octo@example.invalid",
    GIT_COMMITTER_NAME: "Octo Author",
    GIT_COMMITTER_EMAIL: "octo@example.invalid",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  return {
    bin,
    upstream,
    /** The upstream registry, to add entries, `removed.json` or `authors.json` to. */
    registry: join(upstream, "packages", "cli", "registry"),
    env,
    /** Each call as `[tool, ...args]`, in order. */
    calls: (): string[][] =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .split("\n")
            .filter((line) => line !== "")
            .map((line) => line.split("\x1f"))
        : [],
    /** The body file `gh pr create` was given. */
    body: () => readFileSync(`${log}.body`, "utf8"),
    /** The body file `gh pr edit` was given. */
    editedBody: () => readFileSync(`${log}.edit-body`, "utf8"),
    /** The calls log; `<log>.tip` holds the fork branch tip `ls-remote` last reported. */
    log,
    /** The clone's working tree as the first push saw it. */
    pushed: join(temp.path, "calls.log.pushed"),
    cleanup: temp.cleanup,
  };
}
