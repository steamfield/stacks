# Phase 5.0: CI release and checks

Status: DRAFT 2026-10-26 (not agreed)

| Field | Value |
|---|---|
| Goal | A `v*` tag on `main` publishes the `stacks` package to npm with provenance and no long-lived token; CI tests the packed artifact on Node 22 as well as the `.node-version` Node; the bundled registry's `validate` and rot checks fail CI when they fail locally |
| Traces to | "Is the npm name available? ... `npx stacks new ...`, the README's first line, only works if `stacks` is free on npm." Entry point `npx stacks` (D9) and the Node range (D12): every user's first contact is a package someone downloaded from npm, so what ships must be the artifact the gate tested |
| Depends on | [1.6c](../archive/phases/phase-1.6c-first-release-2026-10-30.md) (the package exists on npm, published by hand; the packed-tarball e2e and the Node 22 e2e switch from [0.2](../archive/phases/phase-0.2-npm-distribution-artifact-2026-10-30.md) exist and pass locally) |
| Blocks | [5.1](phase-5.1-scheduled-canary.md) (ledger PRs need CI that validates the ledger), [5.2](phase-5.2-ci-index-build-and-deploy.md) (reuses this file's workflow conventions) |
| Decisions needed | D12 (Node range; if the floor changes, the `e2e-node22` job's Node version changes with it). D23 (this sub-phase exists because of it). [Open question 20](../risks-and-open-questions.md#open-questions-for-the-maintainers): is a manual `npm publish` without provenance acceptable for the first releases? If the maintainers say no, this sub-phase moves ahead of 1.6c and 1.6c publishes through the workflow instead of by hand; nothing in the design changes |
| Settles | How releases are cut after 1.6c; which CI jobs gate a merge; that `ci-ok` stays the only required check |

## Scope

Where this fits: everything here wraps behavior that already exists and is tested
locally. 0.2 built the Node ESM bundle, the `bun pm pack` tarball, the tarball e2e and
the `STACKS_E2E_NODE` switch that makes the e2e spawn a chosen Node. 1.5 and 2.2
built `validate` and its rot checks, with a test asserting the bundled registry is clean.
1.6c published the first version by hand with `npm publish <tgz>`. This sub-phase only
adds `.github/workflows/` wiring and the docs that describe it. Its siblings: 5.1
schedules bench runs on a maintainer-controlled machine, and 5.2 builds, signs and
deploys the index from CI.

In:

- `.github/workflows/release.yml`: tag-driven gate, pack, publish with provenance through
  npm trusted publishing. Replaces 1.6c's manual publish.
- A separate `e2e-node22` job in `.github/workflows/ci.yml`, added to `ci-ok`'s `needs`.
- The bundled registry's `validate` (1.5) and rot checks (2.2) as CI steps, where they
  aren't already run by CI.
- `AGENTS.md` (CI, Pending user actions, Deferred) and the release procedure 1.6c wrote.

Out:

- Any change to the CLI, the e2e suite or `validate`. If a step here needs one, it goes
  back to the owning sub-phase (0.2, 1.5, 2.2) as a fix with its own test.
- Changelog or version-bump tooling. A maintainer bumps `version` in
  `packages/cli/package.json` in a PR, merges, then tags.
- SHA-pinned actions (deferred in `AGENTS.md`); action tags match `ci.yml`.
- Publishing `@steamfield/stacks-mcp`. 4.3 publishes it by hand; a CI release for it is out of
  scope here and owned by no sub-phase.
- Updating the released-versions list 4.1b's ingest checks: 4.1c reads released versions
  from npm daily; a publish-time push is an optional later speed-up.

## Design

### What CI already runs

`.github/workflows/ci.yml` has one `check` job on `ubuntu-latest` and `macos-latest`
(lint, typecheck, `test:hooks`, `coverage`, `e2e`) and a `ci-ok` job that passes only when
every `check` leg passed. Note it runs `bun run coverage`, not `bun run test` or
`bun run check`: anything `check` runs that isn't a Vitest test or an e2e test doesn't run
in CI today. Root scripts fan out with `bun run --filter '*'`, so every package's Vitest
suite already runs here.

### The `e2e-node22` job

D12 promises Node 22 or newer. The `check` job runs e2e on the `.node-version` Node only.
The new job proves the floor:

```yaml
e2e-node22:
  strategy:
    fail-fast: false
    matrix:
      os: [ubuntu-latest, macos-latest]
  runs-on: ${{ matrix.os }}
  timeout-minutes: 15
  steps:
    - uses: actions/checkout@v6
    - uses: actions/setup-node@v6
      with:
        node-version: "22"
    - uses: oven-sh/setup-bun@v2
      with:
        bun-version-file: package.json
    - run: bun run install:ci
    - run: echo "STACKS_E2E_NODE=$(command -v node)" >> "$GITHUB_ENV"
    - run: bun run e2e
    - uses: actions/upload-artifact@v6
      if: failure()
      with:
        name: diagnostics-node22-${{ matrix.os }}
        path: packages/*/logs/
```

Build and e2e only: lint, typecheck and unit tests don't depend on the Node that runs the
packed CLI, and `bun run e2e` builds first. `STACKS_E2E_NODE` is 0.2's switch (an
absolute Node path whose directory the e2e puts first in the scratch `PATH`); it is set
explicitly because the e2e builds its child environment from scratch and setup-node's
toolcache isn't in `/usr/bin:/bin`. Both OSes, because process groups and signals differ
between them and the e2e is where that shows.

`ci-ok` changes to `needs: [check, e2e-node22]` and tests both results. Branch protection
keeps `ci-ok` as the only required check, so adding a job needs no settings change. This
is the only edit to the existing `check` job's file; the `check` job itself is unchanged.

### The bundled registry in CI

1.5 asserts in a Vitest test that `validate` on `packages/cli/registry` gives zero errors
and zero warnings, and 2.2 extends the same assertion to its rot checks. `coverage` runs
every Vitest test, so CI already runs both.

The first task of this sub-phase is to confirm that, by reading what 1.5 and 2.2 landed:

| What 1.5 and 2.2 landed | What this sub-phase adds |
|---|---|
| The assertion is a Vitest test (the plan) | Nothing to the steps. Record in `AGENTS.md` that `coverage` covers it |
| A separate script in `check` (for example `validate:registry`) | One step in the `check` job, after `coverage`: `bun run --cwd packages/cli <that script>` |

Decided here: no second, redundant `validate` step when the test already runs, because
two copies of one check drift. The 2.2 `ledger-changed` findings are `note` severity and
never fail anything (see roadmap, Other shared facts: `validate` severities); CI doesn't
surface them.

### The release workflow

`.github/workflows/release.yml`:

```yaml
on:
  push:
    tags: ["v*"]
  workflow_dispatch: {}
permissions:
  contents: read
concurrency:
  group: release
  cancel-in-progress: false
```

Two jobs, so the job holding the OIDC permission never installs dependencies or runs
repo code:

`gate` (`ubuntu-latest`, `contents: read`):

1. Checkout with `fetch-depth: 0`. On a tag push, fail unless the tagged commit is an
   ancestor of `origin/main` (`git merge-base --is-ancestor "$GITHUB_SHA" origin/main`);
   tag triggers can't filter by branch.
2. On a tag push, fail unless the tag equals `v` plus `packages/cli/package.json`
   `version`.
3. setup-node from `.node-version`, setup-bun, `bun run install:ci`, then `bun run check`
   (the full local gate, including e2e against a tarball).
4. `bun pm pack` in `packages/cli` into `dist-pack/`. `bun pm pack` resolves the
   workspace's `catalog:` specs; `npm pack` would publish them unresolved. Fail if the
   packed `package.json` contains `catalog:` or `workspace:`.
5. Upload the tarball as a workflow artifact.

`publish` (`needs: gate`, runs only on a tag push, `permissions: { contents: read,
id-token: write }`, `environment: npm`):

1. setup-node from `.node-version` with `registry-url: https://registry.npmjs.org`, then
   make sure npm is a version that supports trusted publishing (11.5.1 or later):
   `npm install -g npm@^11.5.1` if `npm --version` is lower.
2. Download the tarball artifact.
3. `npm publish <tgz> --provenance --access public`, adding `--tag next` when the version
   has a prerelease part, so a prerelease never becomes `latest`.
4. Smoke check: in an empty temp directory, `npx -y stacks@<version> --version`
   prints the version, retried a few times over about two minutes for registry
   propagation.

`workflow_dispatch` runs `gate` only: the dry run the maintainers use before the first
tagged release. There is no `NPM_TOKEN` secret anywhere.

Decided here: an `npm` GitHub environment on the `publish` job, named in the npm trusted
publisher configuration. It lets the maintainers add a required reviewer later without
editing the workflow, and stops a workflow on another branch from claiming the trusted
publisher.

### Maintainer actions

These go in `AGENTS.md` under "Pending user actions" until done:

- On npmjs.com, add a trusted publisher for `stacks`: this repository, workflow
  `release.yml`, environment `npm`. The package must already exist, which 1.6c ensures.
- In the repository settings, create the `npm` environment.
- After the first release through the workflow, set the package's publishing access on
  npm to disallow tokens, so a manual publish can no longer happen by accident.

### What replaces 1.6c's manual step

1.6c's release procedure (in `AGENTS.md` or the package README, wherever 1.6c wrote it)
becomes: bump `version` in a PR, merge after `ci-ok`, tag `v<version>` on that `main`
commit, push the tag. The manual `npm publish <tgz>` stays documented only as the path
for a broken workflow, and stops working once tokens are disallowed.

### Failure modes

| Case | What happens |
|---|---|
| Tag doesn't match the package version | `gate` fails at step 2; nothing published |
| Tag on a commit not on `main` | `gate` fails at step 1 |
| `bun run check` fails at the tag | `gate` fails; fix on `main`, delete and recreate the tag |
| Trusted publisher not configured, or npm too old | `npm publish` fails with an OIDC or auth error; nothing published; fix the config and rerun the `publish` job |
| Version already published | `npm publish` fails; npm versions are immutable, so bump and retag |
| npm propagation slower than the smoke check | Smoke check fails after the package is live; rerun the job's smoke step by hand. Not a reason to unpublish |
| Node 22 e2e fails but `check` passes | `ci-ok` fails; the fix is in the CLI (a Node 22 API gap) or D12 changes |

## Files and areas touched

| Path | Change |
|---|---|
| `.github/workflows/release.yml` | New: `gate` and `publish` jobs |
| `.github/workflows/ci.yml` | New `e2e-node22` job; `ci-ok` needs it; a registry step only if the table above says so |
| `AGENTS.md` | CI section (the new job, the release workflow), Pending user actions (trusted publisher, `npm` environment, disallow tokens), release procedure |
| The release procedure 1.6c wrote | Tag-driven steps; manual publish as a fallback |

## Acceptance tests

Workflows aren't unit-testable here; these are the checks:

- A PR that only touches docs shows `check` (two legs), `e2e-node22` (two legs) and
  `ci-ok` green.
- A throwaway branch that breaks Node 22 (for example a call to an API newer than Node
  22, guarded so the `.node-version` Node passes) makes `e2e-node22` and `ci-ok` fail
  while `check` passes. Revert it.
- If a registry step was added: a throwaway branch with a fragment that fails `validate`
  fails that step.
- `workflow_dispatch` of `release.yml` on `main` runs `gate` green, uploads a tarball
  whose `package.json` has no `catalog:` or `workspace:`, and skips `publish`.
- A tag whose name doesn't match the version fails `gate` before packing.
- The first real tagged release: `publish` succeeds, the npm package page shows a
  provenance statement linking this repository and workflow, and the smoke check passes.

## Exit criteria

- `bun run check` green from the repo root.
- `ci-ok` on `main` needs both `check` and `e2e-node22`, and is green.
- One version published by `release.yml` with provenance, by the maintainers.
- `AGENTS.md` describes both workflows; Pending user actions lists only what's still
  undone.
- Open question 20 answered and recorded in the README decisions log, or explicitly
  left open by the maintainers.

## What this plan may get wrong

- npm trusted publishing details (minimum npm version, environment matching, whether
  `--provenance` is still needed alongside it) change over time. Check npm's current
  documentation before writing the job; the shape (OIDC, no token, a separate job) stays.
- The gate's e2e tests a tarball packed inside `bun run check`, and `publish` ships one
  packed in step 4 of the same job from the same commit. They should be identical; if a
  build turns out not to be reproducible, change the e2e to accept a tarball path and test
  the one that ships (a 0.2 change).
- 4.1c reads released versions from npm daily; a publish-time push is an optional later
  speed-up.
- Running `e2e-node22` on macOS doubles its cost for a difference that may never show.
  If it never fails on macOS for a quarter, drop that leg.
