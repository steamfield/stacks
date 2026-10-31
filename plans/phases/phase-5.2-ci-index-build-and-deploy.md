# Phase 5.2: CI index build and deploy

Status: DRAFT 2026-10-26 (not agreed)

| Field | Value |
|---|---|
| Goal | Every green merge to `main` rebuilds the registry index and the entry bundles, signs the index, the names file, the directory data and the allowlist in CI with the Ed25519 key held as a deploy secret, and hands the signed output to `stacks-api`'s own CI to deploy, behind a switch the maintainers turn on, so official stacks reach users without a maintainer at a keyboard |
| Traces to | "Stacks don't rot: A stack that passed last month still passes this month without a prose change", made visible to agents through the index; "A community registry will form ... no public registry exists yet" |
| Depends on | [4.0c](../archive/phases/phase-4.0c-registry-index-2026-10-30.md) (the local build, inline signing and deploy), [4.0e](../archive/phases/phase-4.0e-official-names-and-directory-2026-10-30.md) (the signed names file), [4.0d](../archive/phases/phase-4.0d-cli-remote-origin-2026-10-30.md) (the CLI's compiled public key and signature check), [5.0](phase-5.0-ci-release-and-checks.md) (workflow conventions, `ci-ok` as the gate), and a deploy workflow in `stacks-api` that accepts a signed index output ([4.0b](../archive/phases/phase-4.0b-api-skeleton-on-node-2026-10-30.md)'s deploy, moved to that repository's CI). Soft: [4.2c](phase-4.2c-directory-browsing.md)'s `v1/directory.json` and [4.2d](../archive/phases/phase-4.2d-dependency-telemetry-client-and-ingest-2026-10-30.md)'s signed allowlist, built when they have landed |
| Blocks | Nothing |
| Decisions needed | D21 (the signed index). If it were dropped, this sub-phase deploys unsigned and the key handling below goes away. D23 (why this is phase 5). D16 is decided and doesn't affect this file: the host is `stacks-api`'s concern |
| Settles | When CI publishes the index, where the signing key lives, how the signed output reaches the API's deploy, how a stale run is kept from overwriting a newer deploy, and how a key mismatch is caught before users see it |

## Scope

Where this fits: by the time this starts, a maintainer can already do all of this by
hand. 4.0c's local build script reads `packages/cli/registry/` and the ledger, runs
`validate`, writes the static, content-addressed index and the entry bundles (and 4.0e's
names file), signs every signed file inline with a key kept off the repo, and hands the
output to `stacks-api`'s deploy, which builds the site over it and deploys both.
4.0d's CLI verifies that signature against the public key compiled into it (see
[trust model point 7](../roadmap.md#trust-model)). This sub-phase only moves this
repository's half into a workflow and the private key into a deploy secret. The API, its
site, its migrations, its deploy and its smoke checks run in `stacks-api`'s own CI
(D35), which this repository never holds credentials for. It changes no build, signing or
CLI code; a gap it finds goes back to 4.0c or 4.0d. Siblings: 5.0 adds the release
workflow and extra CI jobs; 5.1 schedules canary runs, whose ledger PRs, once merged,
trigger this deploy.

In:

- `.github/workflows/deploy.yml`: build on every green `main`, sign and hand off when the
  maintainers enable it.
- The Ed25519 private key as an environment secret (D21, trust model point 7).
- A pre-handoff check that the signature verifies against the CLI's compiled public key.
- A post-deploy check against the live host once `stacks-api` reports its deploy.
- `AGENTS.md` and the deploy procedure 4.0c and 4.0e wrote.

Out:

- The build, the index and bundle formats, the canonical bundle digest, signing code and
  the public key: 4.0a, 4.0c and 4.0d own them.
- Building or deploying the API or the site, applying migrations, and the ingest smoke
  (4.1e's `smoke.ts`): all in `stacks-api`'s own CI.
- Key rotation tooling. Rotation needs a CLI release carrying the new public key, which
  4.0d owns; this file documents only where the secret is replaced.
- Preview deploys for PRs.
- Deploying anything not on `main`.

## Design

### Trigger and gate

```yaml
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch: {}
permissions:
  contents: read
concurrency:
  group: deploy
  cancel-in-progress: false
```

The deploy runs only after the `CI` workflow finished on `main` with conclusion
`success` and event `push`, so a red `main` never deploys and `ci-ok`'s checks are the
gate. It checks out `github.event.workflow_run.head_sha`, not the branch tip.

Decided here: `workflow_run` instead of a job inside `ci.yml`, so the deploy secrets live
in a separate workflow that never runs on pull requests.

### Jobs

`build` (`ubuntu-latest`, `contents: read`, no secrets):

1. Checkout `head_sha` with full history and tags (`fetch-depth: 0`), because 4.0e's
   `v1/names.json` reads every release tag; setup-node from `.node-version`, setup-bun,
   `bun run install:ci`.
2. Run 4.0c's build script unchanged with `--unsigned` and
   `--previous https://<host>/v1/index.json`. It refuses to build when `validate` reports
   an error, and the previous deploy stays live.
3. Upload the output directory (index, names file, directory data and allowlist when
   4.2c and 4.2d have landed, bundles) as an artifact. This artifact is unsigned and is
   never deployed: it is the reviewable result, and the whole output when deploys are off.

`deploy` (`needs: build`, `if: vars.DEPLOY_ENABLED == 'true'`, `environment: production`):

1. Stale-run guard: fetch `origin/main` and skip (success, with a notice) unless
   `head_sha` is still its tip. A slow run for an older commit never overwrites a newer
   deploy.
2. Checkout `head_sha` with full history and tags, setup-node, setup-bun,
   `bun run install:ci`.
3. Build and sign: 4.0c signs inline in the build, so the deploy job runs the build once
   more, signed. One step writes the `INDEX_SIGNING_KEY` secret to a file in
   `$RUNNER_TEMP` with mode 600 (from the environment, never on a command line, never
   echoed); the next runs
   `bun run --cwd packages/cli build:index -- --out <dir> --previous https://<host>/v1/index.json --key <that file>`;
   a step with `if: always()` deletes the file whatever happened before it. This signed
   output is what deploys.
4. Verify before handoff: check the signature of every signed file in the output,
   `v1/index.json`, `v1/names.json` and, once landed, `v1/directory.json` and
   `v1/allowlist.json`, with the public key from 4.0d's source (the same
   `INDEX_PUBLIC_KEYS` the CLI compiles in), not with a key derived from the secret. A
   mismatch fails the job. Without this, a wrong secret would deploy files every CLI
   ignores with `lastOutcome: "invalid"`, which fails safe but silently.
5. Hand off: upload the signed output as an artifact named for `head_sha`, then send a
   `repository_dispatch` event (`index-published`, with the run id and `head_sha`) to
   `stacks-api` using `API_DISPATCH_TOKEN`. That repository's deploy workflow
   downloads the artifact, builds the site over it, deploys, and runs its own smoke
   checks (`/healthz`, and 4.1e's ingest smoke once it has landed).
6. Wait and check: poll the live host until `GET /v1/index.json` returns the commit just
   built, for up to 15 minutes, then run `build:index -- --check https://<host>`, and run
   the built CLI with fresh XDG cache directories (no cached index, so the first `list`
   refreshes) against the default URL, which must report a verified index through 4.0d's
   outcome field and list every bundled stack. A timeout fails this job without
   undoing anything: the previous index stays live until `stacks-api` deploys.

### Secrets and environment

| Name | Kind | Holds | Used by |
|---|---|---|---|
| `production` | GitHub environment | Deployment branch policy: `main` only | `deploy` job |
| `INDEX_SIGNING_KEY` | Environment secret | The Ed25519 private key as the PKCS8 PEM 4.0c's `--key` reads | Step 3 only, through a mode-600 temp file deleted in an `always()` step |
| `API_DISPATCH_TOKEN` | Environment secret | A fine-grained token that can only send `repository_dispatch` to `stacks-api` and read nothing | Step 5 only |
| `DEPLOY_ENABLED` | Repository variable | `true` once the maintainers have set up `stacks-api`'s deploy workflow | `deploy` job condition |

The host credential (a Workers API token) lives only in `stacks-api`'s CI. This
repository is public and its workflows can be read by anyone, so it holds the signing key
and a dispatch-only token and nothing that can change the host directly.

In phase 4 a maintainer signs locally with a key kept off the repo (trust model point 7).
Moving to CI means putting that same key into `INDEX_SIGNING_KEY`, not generating a new
one, so already-released CLIs keep verifying. The maintainers keep their offline copy as
the backup. Replacing the key is a rotation: a CLI release with the new public key first
(4.0d), then the secret.

Decided here: no required reviewer on `production`. Every merge to `main` already passed
review and `ci-ok`, and a reviewer gate on each merge would make deploys wait on a person,
which is what this sub-phase removes. The maintainers can add one later without editing
the workflow.

### Failure modes

| Case | What happens |
|---|---|
| Registry fails `validate` | `build` fails; the previous index stays live |
| CI red on `main` | No deploy run starts |
| Older commit finishes after a newer one | Step 1 skips it; `stacks-api`'s deploy also refuses an artifact older than the one live |
| Wrong or missing signing key | Step 3 or 4 fails; nothing is handed off; the key file is still deleted |
| Dispatch token missing, expired or refused | Step 5 fails; the signed artifact stays for a maintainer to hand off by hand |
| `stacks-api`'s deploy fails | Step 6 times out and fails; the old index stays live because the Worker's static assets deploy all at once; the maintainers fix it there and rerun its deploy |
| Live check fails after deploy | The job fails and the maintainers roll back with 4.0c's manual procedure; CLIs that can't verify fall back to the bundled set (4.0d) |
| `DEPLOY_ENABLED` unset | `build` runs and uploads; `deploy` is skipped |

## Files and areas touched

| Path | Change |
|---|---|
| `.github/workflows/deploy.yml` | New: `build` and `deploy` jobs |
| `AGENTS.md` | CI section (the deploy workflow), Pending user actions (create `production`, add the two secrets, set `DEPLOY_ENABLED`) |
| The deploy procedure 4.0c and 4.0e wrote | CI is the normal path; the manual procedure stays as the fallback and rollback |
| `stacks-api`'s deploy workflow | Outside this repository: accepts `index-published`. Listed so the dependency is visible; its plan is that repository's |

## Acceptance tests

- With `DEPLOY_ENABLED` unset, a merge to `main` runs `build` green and uploads an
  artifact whose index decodes with 4.0c's schema; `deploy` is skipped.
- A throwaway branch's push doesn't start the deploy workflow; a PR doesn't either.
- `workflow_dispatch` with a deliberately wrong `INDEX_SIGNING_KEY` in a test environment
  fails at step 4 and sends no dispatch.
- Two merges in quick succession: the run for the older commit skips at step 1.
- After any `deploy` run, including one that failed at step 3 or 4, no key file remains
  in `$RUNNER_TEMP` (the `always()` step's log shows the delete).
- The `build` job's artifact has `signature: ""` in every envelope, and step 4 checks
  every signed file the deploy job built.
- No secret in this repository's `production` environment can deploy to the host: the
  workflow file references only `INDEX_SIGNING_KEY` and `API_DISPATCH_TOKEN`.
- With deploys enabled, a merge that changes one fragment's body: the live index's commit
  matches, the changed bundle's digest is new, and `npx @steamfield/stacks@latest list --json`
  on a clean machine shows the change after the index cache expires.

## Exit criteria

- `bun run check` green from the repo root.
- One deploy from CI on a real merge, with the live check green, run with the
  maintainers' secrets.
- The signing key exists only in the `production` environment and the maintainers'
  offline copy.
- `AGENTS.md` describes the workflow and Pending user actions lists only what's undone.

## What this plan may get wrong

- `workflow_run` runs the workflow file from the default branch, not from `head_sha`.
  That is the point (a PR can't change it), but a change to `deploy.yml` takes effect on
  the merge after it lands. Note it in `AGENTS.md`.
- 2026-10-27: the plan deployed the API and applied its migrations from this
  repository's CI with a host credential stored here. Under D35 the API lives in a
  private repository with its own CI, so this file now only builds, signs and hands off
  the index output, and the host credential never enters this public repository.
- Handing off through an artifact and `repository_dispatch` couples the two workflows
  by an event name and an artifact layout. If that proves brittle, publish the signed
  output as a GitHub release asset per commit and have `stacks-api` poll for it.
- The 15-minute wait in step 6 is a guess at how long `stacks-api`'s deploy takes.
