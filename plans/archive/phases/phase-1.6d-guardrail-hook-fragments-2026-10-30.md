# Phase 1.6d: Guardrail hook fragments

Status: EXECUTED 2026-10-26, reviewed once and fixed, merged to main 2026-10-27
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | The Claude Code guardrails that ship in the `agent-ops` fragment: five bash-3.2 hook scripts and their shared library, the `.claude/settings.json` merge with its deny rules, and the `.claude/README.md` skeleton, each with behavior tests that run inside `bun run test`, so a generated project is safe to hand to an agent |
| Traces to | Job 1 ("agent config"); the brief "refuses to let the agent weaken a step" (D14); success row "The result is complete" |
| Depends on | [1.6a](phase-1.6a-bundled-stack-content-2026-10-30.md) (the `agent-ops` fragment and the bundled stacks whose generated projects the tests run on), 1.5 (`validate`) |
| Blocks | [1.6b](phase-1.6b-mvp-gate-runs-2026-10-30.md) (the gate runs ship these hooks) |
| Decisions needed | D18 (entry format; adapters live under `adapters/claude/`). D14 (changed steps fail verify) shapes the manifest deny rule |
| Settles | The hook set, the destructive-command and secret-shape lists, and the deny rules the bundled `agent-ops` ships for Claude Code |

## Where this fits

1.6a writes the stacks and the `agent-ops` fragment's body, `AGENTS.md` skeleton and
verify steps. This sub-phase adds the files that make a generated project safe to hand to
an agent, and the demo shows them, so their contents are fixed here rather than left to
whoever writes them. Every file ships under `agent-ops`'s `adapters/claude/` (Claude
Code's format; other agents' native adapters are
[3.4b](phase-3.4b-native-agent-adapters-2026-10-30.md)). Paths are output paths, and dotfiles are stored
literally (D18 as amended), so `adapters/claude/.claude/settings.json` is written as
`.claude/settings.json`. `agent-ops` lists `.claude/settings.json` in its `merge`, so
other fragments' hook entries deep-merge into it (1.1). [3.4a](phase-3.4a-agent-harness-fragment-2026-10-30.md) later
offers a TypeScript harness that replaces the regex guard with a lexer.

## Scope

In:

- The hook scripts and their library, `.claude/settings.json` and `.claude/README.md` below.
- One paragraph in `agent-ops`'s body saying what the hooks are for and the one rule (a
  block means ask the user).
- Behavior tests for every hook, run inside `bun run test`.

Out:

- The `agent-ops` body beyond that paragraph, the `AGENTS.md` skeleton and the verify
  steps (1.6a).
- Hooks for agents other than Claude Code (3.4b) and the TypeScript harness (3.4a).
- A dedicated CI job across more shells and a runner image without `jq`
  ([5.0](../../phases/phase-5.0-ci-release-and-checks.md)).

## Design

### Files

| Output path | What it does |
|---|---|
| `.claude/hooks/lib.sh` | Shared shell library every hook sources: read one field from the hook's JSON input (with `jq` when it is on PATH, otherwise a small `sed`-based reader that handles the few flat string fields the hooks need), print a bounded message (at most 40 lines), emit the agent's block response, find the project root. Written for bash 3.2 (macOS's `/bin/bash`): no associative arrays, `mapfile`, `${var,,}`, `\|&` or `;&` |
| `.claude/hooks/session-start.sh` | SessionStart: prints a short orientation (whether `AGENTS.md` is filled, which of the stack's tools are missing from PATH, whether `.stacks/BRIEF.md` exists and the project hasn't reached green yet), at most 15 lines |
| `.claude/hooks/guard-destructive.sh` | PreToolUse on the shell tool: blocks a command matching the pattern list below and tells the agent to ask the user instead of working around the block |
| `.claude/hooks/guard-secrets.sh` | PreToolUse on file writes and edits: blocks content with a secret shape (below), and any write to `.env` or `.env.*` other than `.env.example` |
| `.claude/hooks/lint-on-write.sh` | PostToolUse on file writes and edits: runs the project's lint for the written file through the project's task runner, found at run time (a `lint` target in the `Makefile`, else a `lint` script in `package.json`; templates have no conditionals, D1), and returns its diagnostics as context, bounded, never blocking. A missing lint command is silent: the agent may not have created it yet |
| `.claude/hooks/format-on-stop.sh` | Stop: runs the project's `format` command (found the same way) over the files git reports changed, then exits 0 whatever happens |
| `.claude/settings.json` | A `merge` path: wires each hook once, and holds `permissions.deny` rules for reading `.env` and `.env.*` (not `.env.example`), for `git push --force`, `git commit --no-verify` and `git push --no-verify`, and for editing `.stacks/manifest.json` (D14: the agent can't weaken the steps by accident even before verify catches it) |
| `.claude/README.md` | Skeleton with `stacks:fill` markers: what each hook does, what a block means ("ask the user; never work around a deny"), how to turn one off for a session, and where the patterns live |

Destructive-command patterns, one list in `guard-destructive.sh`, matched against the
command after collapsing whitespace (a regex list, not a shell parser;
3.4a's harness replaces it with a lexer):

- `rm -r` with `-f` in any flag order, whose target is `/`, `~`, `$HOME`, `.`, `..`, `*`
  or `/*`
- `git reset --hard`, `git clean` with `-f` and `-d` or `-x`, `git checkout -- .`,
  `git restore .`, `git branch -D`, `git stash clear`
- `git push` with `--force`, `-f` or `--force-with-lease`; `git commit` or `git push`
  with `--no-verify`
- `chmod -R 777`, `chown -R` on `/` or `~`
- `dd` with `of=/dev/`, `mkfs`, a fork bomb
- `curl` or `wget` piped into `sh`, `bash` or `zsh`
- `sudo`

Secret shapes, one list in `guard-secrets.sh`: private key headers (`-----BEGIN ... PRIVATE KEY-----`), cloud access
key ids of the `AKIA` plus 16 characters form, GitHub token prefixes (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`), Slack token
prefixes (`xoxb-`, `xoxp-`, `xoxa-`), payment live keys (`sk_live_`, `rk_live_`), and long `sk-`-prefixed API keys.
A match blocks with the pattern's name, never the matched text.

`.claude/README.md` gets no verify step: verify steps can't depend on the target agents,
and a project without Claude Code as a target doesn't have the file.

### Budget

The hooks paragraph in `agent-ops`'s body counts toward 1.6a's 300-word budget for the
fragment. Details live in `.claude/README.md`, which is shipped Markdown: 1.5 reports it
as a `shipped` row with no limit, and the agent reads it only when a hook fires. The
scripts aren't prose and don't count.

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/registry/fragments/agent-ops/adapters/claude/` | `.claude/hooks/*.sh`, `.claude/settings.json`, `.claude/README.md` (literal names, 1.0) |
| `packages/cli/registry/fragments/agent-ops/FRAGMENT.md` | The hooks paragraph |
| `packages/cli/tests/registry-hooks.test.ts`, `tests/fixtures/hook-input/` | Behavior tests for the shipped hooks, with recorded hook-input JSON per tool |

## Acceptance tests

`packages/cli/tests/registry-hooks.test.ts`, on the files `new astro-blog app --json`
writes into a temp dir (numbered 2026-10-26 for the acceptance trace; the wording is
the original bullets):

1. Each guard blocks every pattern in its list and allows a near miss for each (removing
   `./dist`, a plain `git push`, `git reset --soft`, `.env.example`, a 10-character `sk-`
   string), with the block response in the agent's documented shape and the pattern's
   name, never the matched text, in the message.
2. Every hook runs under `/bin/bash` when it is bash 3.x (macOS), and under the `bash` on
   PATH otherwise; the test prints which. A static check fails on any bash 4 construct
   (`declare -A`, `mapfile`, `readarray`, `${x,,}`, `${x^^}`, `|&`, `;&`) in a shipped
   script.
3. Every hook gives the same decision with `jq` on PATH and with a PATH built without it.
4. Composing each bundled stack, `.claude/settings.json` wires each hook command
   exactly once, even though several fragments merge into it, and each deny rule appears
   once.
5. Every shipped script is executable.
6. `lint-on-write.sh` with no lint command defined exits 0 silently; `format-on-stop.sh`
   with a failing `format` command exits 0.
7. `validate` over the bundled registry still has zero errors and zero warnings.

These run inside `bun run test`, so the existing CI job runs them on Ubuntu and macOS with
no workflow change.

## Exit criteria

- `bun run check` green from the repo root.
- `validate` over the bundled registry: zero errors, zero warnings, and `agent-ops`'s
  body within 1.6a's budget.

## What this plan may get wrong

- The guard pattern lists are regexes over a command string. Quoting, `eval`, aliases and
  scripts that call the command indirectly defeat them; they stop accidents, not an agent
  set on getting past them, and the README says so. 3.4a's lexer-based guard is the
  stronger version.
- Hook input and block-response shapes are the agent's, and they change. The fixtures in
  `tests/fixtures/hook-input/` are dated; a mismatch shows up in 1.6b's gate runs as hooks
  that never fire (2.0b records whether they fired).
- A `sed`-based JSON reader handles only flat string fields. A hook that needs nested
  input needs `jq` or the 3.4a harness.
- 2026-10-26: the shipped files were planned under a `_dot_` escape (`_dot_claude/`) and
  tested against three stacks. The amended D18 stores dotfiles literally, and 1.6a now
  brings the whole catalog into v1, so the settings merge test runs over every bundled
  stack. 1.1's merge concatenates arrays, so "each hook command exactly once" depends on
  no two fragments shipping the same hook entry; if one does, the test fails and the
  duplicate moves to one owner.
- 2026-10-26, on execution: the hooks already shipped with 1.6a, so this sub-phase
  compared them with the design above, filled the gaps and kept the rest. What differs:
  - Names. The shipped names stay: `_lib.sh` (plus `_destructive-patterns.sh`, the
    pattern list in its own sourced file so another hook can reuse it),
    `block-destructive.sh`, `detect-secrets.sh` and `format-changed.sh`, not `lib.sh`,
    `guard-destructive.sh`, `guard-secrets.sh` and `format-on-stop.sh`. The acceptance
    tests' names map onto them.
  - jq. The shipped hooks were no-ops without jq. `_lib.sh::hook_get` now reads the
    payload with jq when it's on PATH and with an awk walker otherwise (awk rather than
    sed: a JSON string with escapes needs a small state machine), and every response is
    written by `_lib.sh::hook_deny` / `hook_context` without jq, so both paths answer
    alike. `jq` left `agent-ops`'s `tools`; python-react, whose own
    `guard-generated.sh` still needs jq, now lists it.
  - Destructive list. Added `git branch -D`, `--no-verify` on commit and push, `chown -R`
    of `/` or `~`, a fork bomb, a download piped into a shell, and `sudo` (the last two in
    command position only, so a commit message mentioning them passes). Kept from the
    shipped list, broader than the plan: `git clean` with any `-f`, `chmod 777` without
    `-R`, the stash drop, `find -delete`, database drops, Docker volume deletion,
    publishing. Narrower, on purpose: `git push --force-with-lease` is allowed (the
    guard's own suggestion for a needed force push), and `dd` blocks only disk devices
    (`of=/dev/null` passes).
  - Secrets. The shipped shapes cover the plan's list with length floors (`ghp_` plus
    36 characters, `sk-` plus 40) and add more (GitLab, Google, npm, JWTs, connection
    strings). Added: any write or edit to `.env` or `.env.*` is denied except
    `.env.example`, `.env.sample` and `.env.template`. The shipped hook skips Markdown and
    text files, where example keys are expected; kept.
  - Settings deny rules. Added `--no-verify` on commit and push, reading `.env`,
    `.env.local`, `.env.*.local` and `.env.production` (a `.env.*` wildcard would also
    deny `.env.example`, and an allow can't override a deny), and
    `Edit(./.stacks/manifest.json)` (Edit rules cover Write).
  - Bounds. Lint diagnostics are capped at 60 lines (the shipped value), not 40; block
    messages are a few lines. `session-start.sh` now stops at 15 lines.
  - `session-start.sh` reports what it already did (branch, `main`, `.env`, dependencies,
    compose services) and now points at `.stacks/BRIEF.md` while `AGENTS.md` still
    has `stacks:fill` markers. It doesn't list missing tools (the manifest's tools
    are nested JSON, out of reach of the jq-free reader) or detect "reached green"
    (verify doesn't exist yet).
  - `lint-on-write.sh` picks the linter by file extension from the project's own install
    (ruff, biome or eslint, golangci-lint or gofmt, shellcheck) rather than a Makefile or
    `package.json` `lint` target, which lints the whole project on every write. "No lint
    command" in test 6 means no linter installed for the file.
  - `format-changed.sh` formats the files this session wrote, recorded by
    `lint-on-write.sh`, with the formatter the project configured, rather than a `format`
    target over every file git reports changed, so parallel agents in one checkout don't
    reformat each other's work. It now also traps any unhandled failure to exit 0.
  - "Every shipped script is executable" now holds for the two sourced libraries too, in
    the working tree and in git's index; the settings call each hook through `bash`, so
    the bit is belt and braces.
  - The claude-harness TypeScript hooks wire different commands from agent-ops (package
    manager, generated-file and typecheck guards), so the two never double-wire; test 4
    also fails if two wired scripts share a name across languages.
- 2026-10-26, after review: the guards missed shapes the fixtures didn't list, so each
  is now a fixture case with a near miss.
  - Git rules match through git's global options (`-C dir`, `-c k=v`, `--no-pager`,
    `--git-dir=`, `--work-tree=`) before the subcommand. `git commit -n` and clusters
    holding it (`-nm`, `-anm`) count as `--no-verify`; `-n` as the argument of `-m`,
    `-c`, `-C`, `-F` or `-t` doesn't, and `git push -n` (dry run) stays allowed. A `-n`
    in a commit message's text (`-m "fix -n"`) is denied, an accepted false positive.
  - The discard rules take a ref or options before `.` or `:/` (`git checkout HEAD -- .`,
    `git restore --source=HEAD .`). `git restore` with only `--staged`/`-S` just unstages
    and stays allowed; with `--worktree`/`-W` too it's denied. Each restore on the line
    is judged alone.
  - rm targets accept the quote before the slash (`"$HOME"/`, `"$HOME"/*`, `"$PWD"/*`).
  - Every `sh -c` payload on a line is checked, not only the last, and a payload's
    escaped quotes (`\"` in double quotes, `'\''` in single) no longer cut it short.
  - The generic secret rule ignores case (`apiKey`, `API_KEY`, `clientSecret`,
    `AUTH_TOKEN`). Its own fixture shape now covers it.
  - Reading `.env.development`, `.env.test` and `.env.staging` is denied too, still by
    name rather than `.env.*` for the reason above, so a project with another real
    `.env.<name>` file adds its own rule. The rules cover the project root only; an
    `apps/web/.env` read isn't denied.
