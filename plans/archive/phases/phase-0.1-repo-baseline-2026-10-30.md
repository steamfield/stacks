# Phase 0.1: Repo baseline

Status: EXECUTED 2026-10-26. The base is ported, moved into the workspace, reviewed,
committed and pushed; `bun run check` passes locally and the CI workflow passes on `main`.

| Field | Value |
|---|---|
| Goal | A committed, CI-verified skeleton with `doctor` and `--version` as its only commands, so product work starts on a known-good base |
| Traces to | "The emotional job underneath all of these is trust": a CLI whose own gates nobody has seen pass can't ask users to trust its gate. D10 and D11 |
| Depends on | nothing |
| Blocks | [0.2](phase-0.2-npm-distribution-artifact-2026-10-30.md), [0.3a](phase-0.3a-errors-and-output-2026-10-30.md), and through them all of phase 1 |
| Decisions needed | none |
| Settles | Nothing new; records what D10 and D11 produced |

## Scope

In: the port of the `typescript-cli` base (D10), the bun-workspace layout (D11), the
foundation review fixes, committing them, and a green `ci-ok` on `main`.

Out: distribution ([0.2](phase-0.2-npm-distribution-artifact-2026-10-30.md)), the error and output
changes ([0.3a](phase-0.3a-errors-and-output-2026-10-30.md)) and the process and signal changes
([0.3b](phase-0.3b-processes-and-signals-2026-10-30.md)) that long and interactive commands need.
No product code. No change to `.github/workflows/` (D23: CI changes are phase 5).

## Design

### What was done

| Date | Work | Evidence |
|---|---|---|
| 2026-10-26 | Ported the base with its required and default pieces only, renamed to stacks (slug, `STACKS_` env prefix, CI on `main`). Exit 5 is unassigned in the base | `bun run check` green after the port |
| 2026-10-26 | Moved into a bun workspace: `packages/cli` is the package, the harness stays at the root, shared versions in the root catalog | Root scripts fan out with `bun run --filter '*'`; root `dev` uses `--cwd packages/cli` |
| 2026-10-26 | Foundation review: workspace-move bugs and base gaps fixed (non-retryable defects with class and frames logged, `--json` after `--` left to the command, XDG data and cache paths, a cache path in `doctor`, `HOME` fallback, CI on Linux and macOS behind one `ci-ok`, path resolution in e2e and Grit probes) | `bun run check` green from the root |
| 2026-10-26 | Three review findings were product design, not bugs; recorded as A2-A4 | [Roadmap, open architecture questions](../../roadmap.md#open-architecture-questions) |
| 2026-10-26 | Review fixes committed through the hooks and pushed; CI passed on `main` on Ubuntu and macOS behind `ci-ok` | `git log` on `main`; the repo's Actions tab, workflow "CI", latest `main` run. Counts from `bun run check` after the push: 80 hook tests, 51 CLI tests, 8 binary tests |

The facts a later sub-phase relies on are in
[the roadmap's Repository and stack section](../../roadmap.md#repository-and-stack). The
code-level reference is `AGENTS.md`, whose "Pending user actions" section says None.

The existing `.github/workflows/ci.yml` stays as it is until phase 5: one `check` job on
`ubuntu-latest` and `macos-latest` running frozen install, lint, typecheck, hook tests,
coverage and `bun run e2e`, behind the one required check `ci-ok`. Root scripts fan out
with `bun run --filter '*'`, so a new package's tests and e2e run there without a
workflow change.

### Notes for later sub-phases

- The binary tests spawn the built artifact with an environment built from scratch.
  Differences between the macOS and Linux runners (signals, process groups, `/tmp`
  semantics) show up there first. Fix them in the test helper, never by skipping a test
  on one OS. 0.2 replaces the compiled binary with the packed tarball and keeps this
  rule.
- The CI workflow uses official action tags, not SHA pins. SHA pinning is deferred (see
  `AGENTS.md`, Deferred).

## Files and areas touched

None remaining. Had CI failed, the fix would have touched `packages/cli/e2e/` or
`tests/hooks/`, not the workflow.

## Acceptance tests

The existing suites are the tests: `bun run test:hooks`, the CLI's Vitest suite through
`tests/helpers/cli.ts`, and `bun test ./e2e` against the built artifact.

## Exit criteria

- `bun run check` green from the repo root. Met 2026-10-26.
- `ci-ok` green on `main` on GitHub. Met 2026-10-26.
- `AGENTS.md` "Pending user actions" says None. Met.
- This file's status line says EXECUTED with the date. Met.

## What this plan may get wrong

- Test counts drift as later sub-phases add tests. A drop in any suite needs an
  explanation in the sub-phase that caused it.
- GitHub's macOS runners have been slower and flakier with process-heavy tests than
  Linux. 0.3b adds process-group and signal tests; if one times out only there, measure
  before raising a timeout.
