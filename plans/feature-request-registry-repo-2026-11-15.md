# Feature request: move stack and fragment definitions into their own repository

Status: DECIDED 2026-11-15. RFC written: [registry-repo-rfc-2026-11-15.md](registry-repo-rfc-2026-11-15.md),
which is what to execute; this file is the request it answers. Priority: high. Lands after
[the remote-first index RFC](remote-first-index-rfc-2026-11-15.md).

## Decision

Stack and fragment definitions (`packages/cli/registry`) move out of the CLI monorepo into a
repository of their own. The move happens alongside the remote-first index work, not before it:
until released CLIs read the hosted index, a merged community stack reaches users only through a
CLI npm release, wherever its source lives, so moving first adds the cost and none of the benefit.

## Why

The goal is a catalog that grows through community contributions, where a user (or an agent acting
for them) can submit a stack easily. The submitting side already exists: `stacks validate
--submission` checks an entry and `stacks submit` forks, clones and opens a draft PR. The friction
is everything after the PR:

- The PR lands in the CLI monorepo. `core/submit/submit.ts::DEFAULT_REPO` is `steamfield/stacks`,
  so a content PR runs the whole CLI gate and sits among the Effect code, hooks and maintainer
  harness. A registry repository can run a small, fork-safe check (validate, the zero-warning rule,
  a scaffold proof, search-card checks) over plain content.
- Content ships on the CLI's release schedule. The bundled registry changes only with the npm
  package. Once the signed index is authoritative, index deploys need a pinned content ref; today
  stacks-api builds from whatever checkout `STACKS_CLI_DIR` points at. Tags in a registry repository
  are that ref.
- Ownership is clearer: CODEOWNERS, `authors.json` with real contributors, and a contribution guide
  in a repository that holds only entries.

## Costs to design for

- The CLI's tests read the bundled registry: `tests/bundled-registry.test.ts` (zero warnings),
  `tests/fixtures/bundled-brief-digests.ts`, the ledger, `scripts/prove.ts`, `scripts/decorate.ts`,
  `scripts/ledger-import.ts`, `scripts/index/` and `build:index`. The CLI build has to fetch a
  pinned registry release (or use a submodule).
- An entry-format change becomes three ordered releases: `@steamfield/stacks-format`, then the
  registry, then the CLI.
- Prerequisites from the remote-first request: `INDEX_PUBLIC_KEYS` is empty and `bin.ts` passes no
  `officialUrl`, so released CLIs don't read the hosted index yet.

## Interim step

Until the split, PRs that touch only `packages/cli/registry/**` should run only the registry checks
in CI rather than the full gate. Cheap, and it removes most of the contributor-facing friction now.

## Next step: the RFC

Write `plans/registry-repo-rfc-<date>.md` recommending one design for: the repository layout
(`stacks/`, `fragments/`, `search/`, `deps/`, `allowlist.json`, `authors.json`, `runs.json`,
`removed.json`, CONTRIBUTING, PR template, CODEOWNERS); fork-safe PR CI with no secrets; how the
CLI gets its bundled registry at build and test time and what changes in the tests and scripts
listed above; the new `DEFAULT_REPO`; stacks-api building the index from a pinned registry ref
(remote-first item 6); how a format change lands across the three repositories; and the sequencing
against the remote-first request. Verify each claim against the code and run one
`ce:devils-advocate` pass.

## Constraints

- D2: the CLI never runs a command from an entry. Nothing in the split changes that.
- Trust (`.claude/rules/architecture.md`, "Trust model"): entries from the official index and the
  shipped bundle stay trusted; a fork's or PR's content is untrusted until merged and signed.
- Publishing stays the maintainer's step (`bun run release`, index deploy).
