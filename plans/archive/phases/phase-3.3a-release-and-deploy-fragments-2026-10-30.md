# Phase 3.3a: Release and deploy fragments

Status: EXECUTED 2026-10-27 (every traced acceptance test, and `bun-release`'s empty-scope
guidance). Unproved: every release and deploy fragment's bench proof, which needs real
`bun run bench --preset default` runs and is the maintainers'. Drafted 2026-10-26. Re-scoped 2026-10-26: D28 is superseded, so
`package_scope`, `--scope` and `Settings.package_scope` are built in
[1.2a](phase-1.2a-new-scaffold-and-templates-2026-10-30.md) as part of v1, with no
`schema_version: 2` and no `template-version` check; and 1.6a brings the bundled release
and deploy fragments into v1, so this file gives each its bench proof and keeps the
proof rule rather than authoring them. Body rewritten to match 2026-10-26
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | Every release and deploy fragment in the bundled catalog has a green bench run of a composition that includes it, recorded in the ledger. This file also defines the proof rule every bundled entry beyond the gate set follows |
| Traces to | Job 4: "add a known-good piece (CI, agent hooks, Postgres) without it overwriting what's there"; Job 1: "I want a project set up the way I'd set it up myself, with tests, lint, CI and agent config"; open question "Who is the bundled registry for?" |
| Depends on | [2.0b](phase-2.0b-bench-2026-10-30.md) (every entry is proved with a bench run, and release and deploy fragments need its `--preset default` passthrough, since `--sandbox` drops their categories), [2.0c](phase-2.0c-run-ledger-2026-10-30.md) (the ledger records the proof), [2.2](phase-2.2-deterministic-rot-checks-2026-10-30.md) (reference, import and dated-phrase checks on the content), [1.6c](phase-1.6c-first-release-2026-10-30.md) (the shipped format and the catalog 1.6a brought into v1) |
| Blocks | [3.3c](phase-3.3c-service-vendor-and-effect-fragments-2026-10-30.md) (it cites this file's proof rule), [3.3b](phase-3.3b-bundled-stack-expansion-2026-10-30.md) soft (where a stack defaults to one of these fragments) |
| Decisions needed | D6 (curated catalog) assumed; if the bundled set is the maintainers' own stack instead, these fragments go to a user directory or a source and only the proof rule stays. D5 and D7 apply unchanged |
| Settles | The proof rule for every bundled entry beyond the gate set; the order release and deploy fragments are proved in |

## Scope

In:

- A bench proof under the rule below for each bundled fragment whose `category` is
  `release` or `deploy`, each in its own change. The service, vendor, Effect and tooling
  fragments are [3.3c](phase-3.3c-service-vendor-and-effect-fragments-2026-10-30.md)'s.
- Fixes the bench runs call for, made in those fragments' entry files.
- A composition test per fragment against every bundled stack it applies to.
- The package README's fragment table.

Out:

- Writing the fragments (1.6a), the `package_scope` variable, `--scope` and
  `Settings.package_scope` (1.2a, in v1).
- Service, vendor and Effect fragments (3.3c), stacks (3.3b), the agent harness fragment
  (3.4a) and apps (3.5b).
- Any fragment that needs a paid account for `verify` to pass. A deploy fragment's verify
  builds and smoke-tests locally; publishing steps carry the `prod` tag.
- CI changes in this repo (D23). Release fragments ship CI content for the generated
  project; they don't touch `.github/workflows/` here.
- Dependency versions anywhere (D1, D3). Fragments name tools; agents choose versions.

## Design

### Where this fits

1.6a brought the whole bundled catalog into v1 and 1.6b proved the gate stacks with real
runs. Every other entry is well formed but unproved. This sub-phase and 3.3c prove the
fragments, 3.3b the remaining stacks, 3.4a the agent harness fragment and 3.5b the apps.
This one takes release and deploy, which share the default-preset bench mode. 2.0b makes
proving each one a single command; 2.2's checks catch the defects that only show up in a
composition.

### The proof rule for a bundled entry

Every entry beyond the gate set is proved in its own change, and the change is mergeable
only when all of this holds:

1. `validate` over the bundled registry: zero errors and zero warnings (1.5 and 2.2), with
   the fragment composed alone against each stack it applies to (1.5's per-fragment
   composition dry run, 2.2's `compose-each`).
2. D5: the fragment's body within 1.5's fragment cap, and every stack's composed brief
   with this fragment as its one optional fragment within 1.5's cap for that case.
3. D7: the fragment's own verify steps carry a `layer`, and a fragment that adds a server
   adds a `serve` step with `expect: { http, within }`.
4. A `pass` ledger record (2.0c) from a 2.0b bench run of one composition that includes
   it, with the run note in [plans/runs/](../../runs/README.md). For `deploy` and `release`
   fragments the run uses `bench --preset default`, since `--sandbox` drops them; the
   steps that would publish carry the `prod` tag and are skipped by default, and the run
   proves the build and the local smoke steps.
5. 2.2's `ledger-unproven` is a note for stacks, not fragments, so this rule is checked by
   the composition test, which asserts a `pass` record exists whose `with` includes the
   fragment.

An entry that can't meet the rule within the session stays unproved, and this file's
status line names it with the reason; the next agent picks it up. Within this sub-phase,
prove the cheapest first: a release fragment whose bench run only builds an artifact
before one that builds a container image.

### What a bench run checks in these categories

1.6a's entry content rules apply unchanged. A release or deploy fragment also has to
show, in its bench run:

- It never publishes from a verify step. Verify proves the release build and any install
  script against the local artifacts; publishing runs only from the generated project's
  CI on a tag, and those steps carry `prod`.
- A fragment that publishes a package names it with `{{package_scope}}` and says in prose
  what to do when the scope is empty (publish unscoped).
- An install script verifies the checksum before it moves anything into place and prints
  the expected and actual digests on mismatch. The fragment's verify runs it against a
  locally built archive with a deliberately wrong checksums file and expects a non-zero
  exit.
- Two release fragments for the same toolchain list each other in `conflicts`.

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/registry/fragments/<id>/` for each release and deploy fragment | Fixes from bench runs |
| `packages/cli/tests/registry.test.ts` | Composition and ledger tests |
| `packages/cli/registry/runs.json`, `plans/runs/` | One bench record and note per fragment |
| `packages/cli/README.md` | Fragment table |

## Acceptance tests

1. For each release and deploy fragment and each bundled stack it applies to:
   `new <stack> --with <fragment> --no-launch --json` succeeds; dry runs cover the
   matrix, and one real write per fragment changes only project files and the CLI's
   state record, runs only the CLI's fixed git commands, and records step layers;
   `validate` reports zero errors and zero warnings.
2. A release fragment that ships an install script rejects a local asset with a wrong
   checksums file, reports expected and actual digests, and moves nothing; a matching
   checksum succeeds and installs the executable. No fragment verify step runs the
   installer.
3. Two release fragments that conflict, composed together on a stack both apply to:
   `ComposeConflict` reason `conflicts` (fixture registry when none are bundled).
4. A fragment using `{{package_scope}}`, composed with `--scope @acme`, renders `acme`;
   with no scope, its prose explains the unscoped path.

### Realistic edge cases

5. A checksum mismatch preserves an existing executable in an install directory with spaces and shell metacharacters.

## Exit criteria

- Acceptance tests pass; `bun run check` green from the repo root.
- Every bundled release and deploy fragment is proved under the rule, or the ones that
  aren't are listed in this file's status line with the reason.

## What this plan may get wrong

- Default-preset bench runs install and build more than sandbox runs. If a release or
  deploy run hits the bench's time cap, raise `--max-minutes` for that run in its note
  rather than shrinking the proof rule.
- macOS signing can't be proved by a bench run without the maintainers' certificates. A
  fragment proves the unsigned path and the prose; a signed release is the generated
  project's maintainers' job.
- 2026-10-26: this plan first authored five new release and deploy fragments and built
  the `package_scope` variable (D28), with `Settings.packageScope`, an entry
  `schemaVersion: 2` for entries that use it, and a `template-version` check. The amended
  D18 put `package_scope` in v1 (built by 1.2a, no version bump, no check), and 1.6a now
  brings the catalog's release and deploy fragments into v1, so this file only proves
  them and owns the proof rule. The proof rule's budget numbers now point at 1.5's caps
  rather than restating D5's, since the roadmap's Feature gaps row proposes changing
  them, and a `serve` step's check is `expect`, not a probe.

- 2026-10-27: Ledger `pass` records including every release/deploy fragment are
  maintainer exit criteria, requiring real `bun run bench --preset default` runs and
  notes. Automated composition tests do not supply that proof.
- 2026-10-27: The catalog has `bun-release` and `goreleaser` (release), and
  `cloudflare-pages` and `docker-deploy` (deploy). `bun-release` uses `package_scope`
  and ships the only installer; it consumes a binary asset plus `SHA256SUMS`, not an
  archive. Its only verify step currently builds; the missing installation test and
  empty-scope guidance remain acceptance requirements. No bundled fragment declares
  `conflicts`, so that rule uses a fixture registry. None of these four has `requires`.
  Empty `applies_to` means all stacks; otherwise ids or tags match.
- 2026-10-27: `new` runs fixed git discovery/init commands and writes an out-of-project
  state record by design. The safety assertion allows exactly those effects, not
  entry commands, installers or tools. Dry runs cover every pair cheaply; real writes
  cover each fragment once.

- 2026-10-27: The plan's "its own verify, against a fixture archive" is read as the
  shipped `install.sh` tested directly against a local release server, not as a fragment
  verify step. A verify step that ran the installer would, in a real project, reach
  api.github.com and write into `~/.local/bin`, and the fragment's own guidance keeps
  network access outside automated verification; the project's installer tests are the
  agent's, against its `startStubReleases` server.
