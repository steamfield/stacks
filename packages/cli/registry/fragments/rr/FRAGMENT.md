---
schema_version: 1
id: rr
kind: fragment
category: tooling
name: rr remote test runner
description: Configures rr (github.com/rileyhilliard/rr) so the project's test, lint, and build commands can run on remote machines over SSH, with a committed .rr.yaml of named tasks, an AGENTS.md section, and the rr Claude Code plugin.
tags: [testing, remote, ssh]
applies_to: []
requires_tools: [rr]
tools: [rr]
merge: [.claude/settings.json]
decisions:
  - "Which rr hosts the project should use (default: every host in the user's ~/.rr/config.yaml, by leaving hosts out of .rr.yaml). If the user has no hosts configured, write .rr.yaml anyway and record host setup under Pending user actions."
  - "Fall back to running locally when no host is reachable (default: `local_fallback: never`; a run that can't reach a host fails loudly rather than quietly using the laptop)."
verify:
  - name: rr-config
    layer: check
    run: "out=$(rr tasks 2>&1) || { printf '%s\\n' \"$out\"; exit 1; }; if printf '%s' \"$out\" | grep -q '\"status\":\"warn\"'; then printf '%s\\n' \"$out\"; exit 1; fi"
---

# rr remote runner

rr runs the project's existing commands on SSH hosts; every command must also work locally, and `stacks verify` runs locally. Write the committed `.rr.yaml`; leave personal `~/.rr/config.yaml` to the user.

## What to add

Write `.rr.yaml` by hand from the installed rr skill's `reference/config.md` and `reference/tasks.md` (or `rr --help`). Don't run `rr init`, `rr setup` or `rr host add`: they write the user's `~/.rr/config.yaml`. Add tasks wrapping local test and lint commands, per-area tasks and a parallel task for monorepos. Single-command tasks take scoped arguments after `--`; use `{args}` for commands containing pipes or `&&`. Avoid built-in task names (`run`, `exec`, `sync`). List remote toolchains in `require:`. Put the frozen install in the task (`bun install --frozen-lockfile && bun run test {args}`) or a parallel task's `setup:`; the default `sync.preserve` keeps `node_modules/` and `.venv/` warm between runs. Check a Node host against the project's recorded Node version, if any; report a mismatch and ask for an update. Omit `hosts:` unless the user requests specific hosts. `.gitignore` already applies to sync; add `sync.exclude` only if needed, since it replaces the defaults (`.git`, `.venv`, `node_modules`, caches, `.claude/`, `.cursor/`), so repeat the ones you keep.
<!-- stacks:when with=claude-harness -->

The test suite runs `.claude/hooks/` (`tests/hooks/`), which rr's defaults don't sync. Set `sync.exclude` to the defaults minus `.claude/`, plus `.claude/settings.local.json` and `.claude/worktrees/`.
<!-- stacks:end -->

If hosts are configured, run `rr doctor` and a real task end to end; `rr provision` can install missing host tools. Otherwise list host setup (`rr host add`, then `rr doctor`) under Pending user actions in AGENTS.md. Do not invent hosts.

The Claude adapter enables the rr plugin and allows read-only rr commands. Keep remote execution prompting unless the user requests allow rules for project tasks. Its shipped rule points at the rr skill.

## AGENTS.md

After Testing, document the `.rr.yaml` tasks in a table with local equivalents, scoped use (`rr test -- <path or filter>`), full-suite use, and the final stderr result's `details.failures`, `details.no_tests` (zero tests is not a pass) and `details.log_file`. Include `rr doctor` and `rr unlock <host>` for diagnosis. Add rr to Commands as an optional way to run the same tests.

## Verify

`rr-config` runs `rr tasks` locally and fails on an invalid `.rr.yaml` or a config warning (an unknown key is usually a typo); no verify step needs a reachable host.
