# RFC: stack and fragment definitions move to their own repository

Status: REVIEWED 2026-11-15 by one devils-advocate pass (24 findings across both RFCs, all applied;
summary at the end). Ready to execute after [the remote-first index RFC](remote-first-index-rfc-2026-11-15.md).
Decided by the maintainer on 2026-11-15
([feature-request-registry-repo-2026-11-15.md](feature-request-registry-repo-2026-11-15.md)).
Claims about the code were checked against `main` at `4bb7749c` (v0.13.0).

## Goal

A community contributor (or an agent working for one) runs `stacks submit`, gets a pull request in
a repository that holds only entries, sees a small fork-safe check pass or fail on their entry, and
after a maintainer merges and deploys, every CLI from 0.14.0 can use the entry without a CLI
release. The CLI keeps a bundled copy for offline and first runs, pinned to a registry release.

## The one mechanism: the registry sits at `packages/cli/registry`

Everything that reads the registry in this repository reads `packages/cli/registry`: the tests
(`tests/bundled-registry.test.ts` and about half the test files), `Host.registry` in a built CLI
(`dist/stacks` resolves `../registry/`), `prove` and `bench` (which run `dist/stacks`),
`build:index`, packing and its dotfile escaping (`scripts/packaging.ts`). Two of the review's
findings (22 and part of 4) came from trying to point those at another directory with flags or
`STACKS_REGISTRY_DIR`, which marks entries untrusted (`registry.ts::trustOf`) and so changes briefs
and recorded word counts. This RFC instead always puts the registry under test at that path: in the
CLI repository as a submodule, in the registry repository's CI by checking out the CLI and then the
PR's content into `packages/cli/registry`, and in `stacks-api`'s deploy the same way. No script
gains a `--registry` flag. What changes is that `packages/cli/registry` may be its own git
repository, which the history-reading scripts must handle (G2a, G2b).

## Decisions

D-G1. The repository is `steamfield/stacks-registry`, created from this repository's history with
`git filter-repo --subdirectory-filter packages/cli/registry` on a fresh clone. History matters:
`scripts/index/directory-added.ts` dates each entry by its first `git log --diff-filter=A`, and
`scripts/index/history.ts::withReleaseRegistry` archives the registry at each `v*` tag to recover
published names and removed content. Filtering keeps commit dates and rewrites tags `v0.1.0`
through `v0.14.0` onto the filtered commits, with paths at the root. `v0.14.0` is the last `v*` tag
the registry repository gets. Filtering changes every commit SHA; `filter-repo`'s
`.git/filter-repo/commit-map` is committed to the registry repository as `legacy-commit-map.txt`
(not shipped, see the exclusions) so a pre-split SHA in `runs.json` or a plan note can be mapped.

D-G2. Registry releases are tags named `registry-YYYY.MM.DD` (`.N` for a second one that day), never
`v*`; `releaseTags` keeps reading only `v*`. Published names after the split come from two places:
`origin: "index"` sources, which `scripts/index/names.ts::mergeNames` already carries forward from
the previous signed names, and a new source `build:index` emits for the checkout it builds. Today
only release sources (`release-names.ts::stackCompositions`) record one composition per optional
fragment; `index-names.ts::indexNames` records each stack's pinned default composition only. So
G2a makes `build:index` also emit a source for the current checkout through the same
`releaseSource` logic, `origin: "index"` with `version` set to the registry tag when `HEAD` has one
(the existing `OfficialNames` shape, no format change). Without it, optional-fragment compositions
and their step names added after the split would never be published.

D-G3. The CLI repository keeps the registry at `packages/cli/registry` as a git submodule pinned to
a `registry-*` tag. Rejected:

- An npm package (`@steamfield/stacks-registry`): its own pack step with the dotfile escaping in
  `scripts/packaging.ts::DROPPED`, its own trusted-publisher setup, and the maintainer scripts that
  write into the registry (`prove`, `bench`, `ledger:import`, `decorate`) would write into
  `node_modules`. A fourth published artifact for content the index already publishes.
- A pinned GitHub tarball fetched at build time: the gate would need the network on first install in
  every worktree and on every rr host.

The submodule keeps every path, keeps packing unchanged, works offline after checkout, and records
the exact registry commit in each CLI commit. Costs under "Risks".

D-G4. Pull-request CI in the registry repository runs on `pull_request` (never
`pull_request_target`), with `permissions: contents: read`, `persist-credentials: false` on every
checkout and no secrets, so a fork's PR gets the same check as a maintainer's and can read nothing
private. The registry's `package.json` pins `@steamfield/stacks` exactly (moved by Dependabot's npm
ecosystem); `registry.json` holds `minCli` (remote-first D-R2). Jobs:

1. `validate` (matrix: the pinned CLI and the CLI at `minCli`):
   `STACKS_OFFLINE=1 STACKS_REGISTRY_DIR="$PWD" npx -y @steamfield/stacks@<v> validate --json`,
   with no path. With a path, `core/validate/index.ts::validationRoots` treats the root as a `user`
   root resolving through `defaultRoots`, which include the published CLI's own bundled registry,
   so a reference to a removed fragment would resolve there and go unreported; with no path and
   `STACKS_REGISTRY_DIR`, the root is the bundled one and resolves only inside itself, as
   `tests/bundled-registry.test.ts` does. Exit 2 fails the job. For the pinned CLI, any
   `severity: "warning"` in `findings` also fails it (jq), the zero-warning rule. The `minCli` leg
   checks errors only; it catches content an older CLI can't decode.
2. `typecheck`: `tsc --noEmit -p tsconfig.registry.json`, the check that today runs inside the CLI's
   `typecheck` script (`packages/cli/tsconfig.registry.json` over `registry/**/*.ts`). The tsconfig
   moves to the registry repository with the compiler options it inherits written out and the
   `@types` dev dependencies it needs.
3. `lint`: Biome with the registry overrides now in `packages/cli/biome.json`, copied into the
   registry's `biome.json` together with the root rules they rely on through `extends: "//"`.
4. `prove` (information only): checks out `steamfield/stacks` at tag `v<pinned>`, then the PR's
   content into `packages/cli/registry` of that checkout, builds, and runs `bun run prove <ids>
   --ledger "$RUNNER_TEMP/proof"` for each stack the PR changes, plus the four canaries in
   `canaries.json` when a fragment changes (D42). It runs the PR's verify steps on a runner with a
   read-only token and no secrets, the standard fork model. Its records are not imported: the PR
   controls the job that writes them, so they could be forged. A PR that changes no stack or
   fragment skips the job.
5. `registry-ok`: the one required check, green only when 1 to 3 pass and 4 passed or was skipped.

Proof records that feed the index come from a separate workflow on `push` to `main` and on
`registry-*` tags, which proves the stacks changed since the previous tag and uploads
`runs.json` records as an artifact, as `zero-edit.yml` does; the maintainer imports them with
`ledger:import` and commits the result through a PR. That content was reviewed and merged before it
ran.

D-G5. The CLI repository stops linting and typechecking registry content: `packages/cli/biome.json`
drops its registry overrides and excludes `registry/**`, and the `typecheck` script drops
`tsconfig.registry.json`. The CLI gate still reads the registry through its tests, which is where a
submodule bump that breaks the CLI is caught.

D-G6. A CLI release bundles a deployed registry tag. `release.yml`'s `verify` job adds three checks:
the submodule commit carries a `registry-*` tag; it is an ancestor of, or equal to, the `commit` in
the live `https://stacks.steamfield.io/v1/index.json` payload (`git merge-base --is-ancestor` in a
fetch of the registry repository); and every stack and fragment id in the bundled registry appears
in the live `v1/names.json`. The third is what "served" means for names: an ancestor commit can hold
an entry no deploy ever published (an unproven stack once the proof gate is back, or one added and
removed between deploys). Each failure names the commit or the ids.

D-G7. Index deploys pin both refs. `stacks-api`'s `prod:deploy` takes `--registry-ref
<registry-tag>` and `--cli-ref <v-tag or sha>`, both required after the split. It clones the CLI at
`--cli-ref`, clones the registry at `--registry-ref` into its `packages/cli/registry`, and runs
`build:index` there. The index `commit` is the registry commit (G2a), which is what a project's
`.stacks/sources.json` records (remote-first D-R5). The existing `--ref` becomes `--cli-ref`.
`deploy-index.yml`'s trigger on `packages/cli/registry/**` and its `repository_dispatch` sender move
to the registry repository when the workflow is enabled (phase 5.2); it stays disabled here.

D-G8. `stacks submit` targets the new repository. `core/submit/submit.ts::DEFAULT_REPO` becomes
`steamfield/stacks-registry`, and `core/submit/assemble.ts::REGISTRY_PATH` becomes the repository
root, with every join in `submit.ts` (`${REGISTRY_PATH}/...`) producing paths without a leading
`/`. CLIs 0.14.0 and older still target `steamfield/stacks` at `packages/cli/registry`, now a
submodule; their submit fails when it stages files inside the gitlink. The 0.15.0 changelog says
so, and this repository's PR template points entry PRs at the registry repository.

D-G9. A format change lands in this order, each step a release that works with everything already
out: (1) `@steamfield/stacks-format`, additive; (2) a CLI release that reads and validates the new
field, its bundled registry not yet using it; (3) a registry PR that uses the field, raises
`registry.json` `minCli` to that CLI and bumps the pinned CLI, so both `validate` legs run on it;
(4) a `registry-*` tag and a deploy; (5) the next CLI release bumps the submodule. Older CLIs reject
the index at step 4 by `minCli` and keep their cached or bundled copy, and remote-first's fallback
report tells them to update.

D-G10. Submodule bumps are a step in the CLI release runbook, not Dependabot. Dependabot's
`gitsubmodule` ecosystem moves a submodule to the head of its branch, not to tags, and D-G6 would
refuse that commit. The runbook step: `git -C packages/cli/registry fetch --tags && git -C
packages/cli/registry checkout <newest registry-* tag that is deployed>`, commit `chore(registry):
bump to <tag>`, then the gate (brief digests and fixtures that change with content are regenerated
in that commit, as `scripts/release.ts` already does for digests).

D-G11. The request's interim step (registry-only PRs skip the CLI gate) is dropped. About half the
CLI's test files reference the bundled registry (116 of 216 match a grep for registry paths),
including `tests/bundled-compositions.test.ts` against brief digests that change with content, so
a registry-only PR can turn `main` red through the CLI suite. Until the split the full gate is the
check, and `ci-ok` already runs it on forks with read-only permissions.

## Registry repository layout

At the root, from today's `packages/cli/registry`: `stacks/`, `fragments/`, `search/`, `deps/`,
`allowlist.json`, `authors.json`, `canaries.json`, `runs.json`, `removed.json`, `registry.json`
(remote-first D-R2), `README.md`. New tooling: `package.json` (pinned CLI, Biome, TypeScript,
`@types`), `bun.lock`, `.gitignore` (`node_modules/`), `biome.json`, `tsconfig.registry.json`,
`CONTRIBUTING.md` (the authoring guide, `stacks validate`, `stacks submit`, what CI checks, how a
merge reaches users), `AGENTS.md` (the same for agents, pointing at `stacks guide author`),
`CODEOWNERS` (maintainers own everything; `authors.json` stays the per-entry author record
`submit` writes), `legacy-commit-map.txt` (D-G1), `.github/pull_request_template.md` (from this
repository's `.github/PULL_REQUEST_TEMPLATE/entry.md`, paths updated), `.github/workflows/ci.yml`,
`.github/workflows/prove.yml` (D-G4's push and tag proofs), `.github/dependabot.yml` (npm and
actions).

The CLI's package ships none of the tooling. In a submodule checkout `packages/cli/registry/.git`
is a file, and the root `.gitignore` would become `registry/.gitignore`, which
`scripts/packaging.ts::escapedRegistryFiles` walks recursively and would ship as
`registry/.gitignore.stacks`; it would also walk `node_modules/`. G2d makes `escapedRegistryFiles`
and `scripts/pack.ts` skip a fixed list of top-level tooling paths (`.git`, `.gitignore`,
`.github`, `node_modules`, `package.json`, `bun.lock`, `biome.json`, `tsconfig.registry.json`,
`CONTRIBUTING.md`, `AGENTS.md`, `CODEOWNERS`, `legacy-commit-map.txt`) and adds the same
exclusions to `packages/cli/package.json` `files`. Only top-level names are skipped: a `.gitignore`
inside a stack's `files/` still ships escaped, as today. `registry/README.md` keeps shipping.

## Changes in this repository

| Unit | Lands | Owns | Change |
| --- | --- | --- | --- |
| G2a Index scripts | in 0.14.0 | `scripts/build-index.ts`, `scripts/index/history.ts`, `scripts/index/directory-added.ts`, `scripts/index/names.ts` or `index-names.ts`, their tests | History reads resolve the registry's own git toplevel and path prefix (`git -C <registry> rev-parse --show-toplevel` and `--show-prefix`) instead of the CLI repository's toplevel and the literal `packages/cli/registry/`; `checkoutCommit` is `git -C <registry> rev-parse HEAD`. Works on today's layout (prefix `packages/cli/registry/`) and the split one (its own repository, empty prefix). Plus D-G2's checkout names source |
| G2b Maintainer scripts | in 0.14.0 | `scripts/prove.ts`, `scripts/bench/prepare.ts`, `scripts/bench-pending.ts`, `scripts/ledger-import.ts`, their tests | Dirty checks and `repoCommit` use `git -C <registry>`, so a record names the registry commit it proved, not the CLI checkout's. `ledger-import` checks a record's commit with `commitExists` in the registry's repository and writes `registry/runs.json` in place, which in the split layout is the submodule's working tree (the maintainer commits it there). A note's registry at an old commit comes from the gitlink when `git ls-tree <commit> packages/cli/registry` names one, else from the path. `runs.json` holds CLI SHAs before the split and registry SHAs after; `legacy-commit-map.txt` maps the first kind. `scripts/ledger-migrate.ts` was a one-time migration (D42) and is left as is |
| G2d Packaging and lint | in 0.14.0 | `scripts/packaging.ts`, `scripts/pack.ts`, `packages/cli/package.json` (`files`, `typecheck`), `packages/cli/biome.json` | The exclusions above. D-G5 waits for G2e (until then the registry is still linted and typechecked here) |
| G2c Submit | at the cut-over | `core/submit/submit.ts`, `core/submit/assemble.ts`, `core/submit/body.ts`, tests, docs mentions | D-G8. Not before the cut-over, or `submit` targets a repository whose layout it doesn't match |
| G2e Submodule cut-over | at the cut-over | `.gitmodules`, `packages/cli/registry` (gitlink), `scripts/prepare.ts`, `.github/workflows/*.yml`, `.github/PULL_REQUEST_TEMPLATE/entry.md`, `packages/cli/biome.json` and `typecheck` (D-G5) | Replace the directory with the submodule at the first `registry-*` tag. `prepare.ts` runs `git submodule update --init` outside CI, so a new worktree under `.claude/worktrees/` gets the registry on `bun install`. Every workflow checks out with `submodules: true`. `release.yml` gets D-G6. The entry PR template is replaced by a pointer to the registry repository. Removing a tracked directory (`git rm -r`) is denied to agents by the command guard: the maintainer runs this unit or gives the go-ahead for that command |
| G2f Docs and harness | at the cut-over | `AGENTS.md` (map, "Releasing" gains D-G10's bump and "tag the registry, deploy it, then bump"), `README.md` ("Monorepo"), `packages/cli/docs/maintaining.md`, `packages/cli/docs/authoring.md`, `.claude/agents/stack-creator.md`, `.claude/skills/stack-authoring/`, `.claude/skills/fragment-authoring/` | Entry work is committed and PR'd in the registry repository, then bumped here. The authoring skills keep their paths (they resolve inside the submodule) and say where to commit |

## Changes elsewhere

| Unit | Where | Change |
| --- | --- | --- |
| G1 Create the repository | Maintainer, then an agent | The maintainer creates `steamfield/stacks-registry` (public, empty). An agent filters a fresh clone of `steamfield/stacks` (never the working checkout), adds the tooling, CI and `legacy-commit-map.txt`, pushes `main` and the rewritten `v*` tags. The maintainer sets `registry-ok` as the required check and branch protection. First tag: `registry-2026.MM.DD` on the content equal to 0.14.0's bundled registry |
| G3 Deploy from the registry | `stacks-api`, in a session there | D-G7, its tests in `tests/production.test.ts`, `docs/operations.md` ("Production", "Publishing a new index") |

## Acceptance

- In the filtered repository, `git log --diff-filter=A` dates for five sampled entries equal the
  dates `build:index` produced here, and `v0.14.0` archives to the same tree as `git archive v0.14.0
  packages/cli/registry` here (compare digests).
- `build:index` with the registry as a submodule and on today's layout produce the same
  `index.json` payload (apart from `generatedAt` and `commit`), `names.json` (plus D-G2's source)
  and `directory.json`.
- Registry CI: a fork PR adding an entry with a warning fails `validate`; one adding a frontmatter
  key the `minCli` CLI rejects fails the `minCli` leg; one referencing a fragment the registry
  removed fails `validate` (the reason for no path); one changing a fragment proves the canaries;
  the workflow file grants `contents: read` only and references no secret.
- `prove` in the CLI repository names the registry commit in `repoCommit`.
- `stacks submit --repo <a test fork of the registry repository>` opens a draft PR with files at the
  root and `authors.json` updated.
- In the CLI repository: a fresh `git worktree add` plus `bun install` has a populated registry;
  the gate passes; `bun run pack` produces a tarball whose `registry/` has none of the tooling paths
  and the same escaped dotfiles as 0.14.0's (compare file lists).
- `release.yml`'s verify job refuses an untagged submodule commit, one not served, and one whose
  bundled ids are missing from the live `names.json`.

## Sequencing

1. With remote-first group 1: G2a, G2b and G2d, in parallel. They land in 0.14.0 because the
   registry CI and the first deploy from the new repository use 0.14.0's scripts (D-G4's checkout
   of `v<pinned>`, D-G7's `--cli-ref`).
2. The rest of the remote-first RFC, then CLI 0.14.0.
3. G1: create the registry repository and its first `registry-*` tag. From here, freeze
   `packages/cli/registry` in this repository: anything merged there has to be replayed in the new
   repository.
4. G3, then `prod:deploy --cli-ref v0.14.0 --registry-ref <first registry tag>`; check the live
   index `commit` is that tag's commit.
5. G2c, G2e and G2f, then CLI 0.15.0, the first release built from the submodule.

## Risks

- Submodules cost contributors to this repository something: `git clone --recurse-submodules`, a
  detached HEAD inside the submodule, a manual bump. `prepare.ts` and D-G10's runbook step cover the
  common cases; an agent editing an entry from here commits inside the submodule, which G2f writes
  down where agents read it.
- rr syncs the working tree to its hosts, and the submodule's `.git` file points into the parent's
  `.git/modules`. Tests that run git against the registry need a real repository on the host. Run
  `rr check` once after G2e; tests that fail remotely build their own temporary repositories, as
  most index script tests already do.
- A registry change can still break the CLI's tests, now found at the bump rather than at the
  content PR. That is the intended trade: contributors never wait on the CLI gate.
- The pinned CLI's `validate` gains new warning classes only when Dependabot bumps it; that bump PR
  is where the registry fixes them.

## Out of scope

Signing the index in CI and deploying on registry tags (phase 5.2), per-entry ownership checks in CI
beyond CODEOWNERS, third-party git sources (phases 3.2a and 3.2b).

## Review (2026-11-15)

One `ce:devils-advocate` pass over both RFCs. Applied here: the scripts that registry CI and the
first deploy need ship in 0.14.0 (Sequencing); `prove` records the registry commit, PR proofs are
information only and imported proofs come from `main` and tags (D-G4, G2b); `validate` runs with no
path under `STACKS_REGISTRY_DIR` (D-G4); bumps are a runbook step because Dependabot can't track
tags (D-G10); tooling files, `.gitignore`, `.git` and `node_modules` are kept out of the package
(layout); typecheck and Biome rules move with the content (D-G4, D-G5); a names source for the
current checkout (D-G2); `v0.14.0` imported (D-G1); "served" checked against `names.json` (D-G6);
no `--registry` flags, the registry always sits at `packages/cli/registry` (the mechanism section).
