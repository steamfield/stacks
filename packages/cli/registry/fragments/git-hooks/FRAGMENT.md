---
schema_version: 1
id: git-hooks
kind: fragment
needs_own_repo: true
category: tooling
name: Git hooks (lefthook)
description: lefthook git hooks that format and lint staged files, enforce Conventional Commits, and run the project's tests before push.
tags: [git, lefthook, conventional-commits]
applies_to: []
tools: [git, lefthook]
decisions:
  - "Conventional Commits commit-msg hook (default: yes; declining deletes the `commit-msg` job and `.lefthook/commit-msg/`)."
  - "What pre-push runs: the project's test target (default), or only the fast tests if the suite takes minutes."
verify:
  - { name: git-hooks-install, phase: setup, layer: install, run: lefthook install }
  - { name: git-hooks-validate, layer: check, run: "lefthook validate && ! grep -n 'stacks:fill' lefthook.yml" }
  - name: git-hooks-jobs
    layer: check
    run: "lefthook dump | awk '/^pre-commit:/{h=1;next} /^pre-push:/{h=2;next} /^[^ ]/{h=0} h&&/^ +(- )?(run|script):/{ok[h]=1} END{exit !(ok[1]&&ok[2])}'"
  - name: git-hooks-commit-msg
    layer: test
    run: "! test -f .lefthook/commit-msg/conventional-commits.sh || { m=$(mktemp) && printf 'wip\\n' > \"$m\" && ! lefthook run commit-msg --no-auto-install \"$m\" && printf 'feat: check commit messages\\n' > \"$m\" && lefthook run commit-msg --no-auto-install \"$m\"; r=$?; rm -f \"$m\"; exit $r; }"
---

# Git hooks (lefthook)

stacks wrote `lefthook.yml` with a commit-msg job running `.lefthook/commit-msg/conventional-commits.sh` (Conventional Commits). Keep the script; no commitlint. Replace the file's `stacks:fill` comment with the pre-commit and pre-push jobs it describes, as `jobs:` lists (lefthook 2 has no `skip_output`, and `exclude` takes only globs).

<!-- stacks:when mode=add -->
`lefthook install` refuses to run while `core.hooksPath` is set. If the repo already uses husky (`.husky/`), the pre-commit framework (`.pre-commit-config.yaml`) or hand-written `.git/hooks`, port those checks into `lefthook.yml`, then ask the user before running `lefthook install --reset-hooks-path` and removing the old manager. If stacks parked `lefthook.yml` under `.stacks/incoming/`, merge its commit-msg job into the existing file.
<!-- stacks:end -->

## Install

If the install step doesn't already run `lefthook install`, add this line (skipping CI, a missing lefthook or config) to `make install` (with `$$CI`) or, without a Makefile, a `prepare` script:

```sh
test -n "$CI" || ! test -f lefthook.yml || ! command -v lefthook >/dev/null || lefthook install
```

## Verify

Verify checks that pre-commit and pre-push have jobs and feeds commit-msg a bad and a good subject. It can't see pre-commit work (lefthook skips jobs with nothing tracked): `git add -A`, run `lefthook run pre-commit --all-files` and check each job ran and passed.

## AGENTS.md

A **Git hooks** section: what each hook runs, the commit format, how to install lefthook and the hooks, and no `--no-verify`: fix the cause or the hook.
