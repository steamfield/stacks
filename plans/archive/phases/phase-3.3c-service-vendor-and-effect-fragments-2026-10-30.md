# Phase 3.3c: Service, vendor and Effect fragments

Status: EXECUTED 2026-10-27 (every traced acceptance test). Unproved: every service,
vendor and tooling fragment's bench proof, which needs real sandbox bench runs and is the
maintainers'. Drafted 2026-10-26. Re-scoped 2026-10-26: 1.6a brings the bundled
service, vendor, Effect and tooling fragments into v1, so this file gives each a bench
proof under 3.3a's rule instead of authoring them. Body rewritten to match 2026-10-26
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | Every service, vendor, Effect and tooling fragment in the bundled catalog has a green bench run of a composition that includes it, under the proof rule in 3.3a |
| Traces to | Job 4: "add a known-good piece (CI, agent hooks, Postgres) without it overwriting what's there"; Job 1: "I want a project set up the way I'd set it up myself, with tests, lint, CI and agent config"; open question "Who is the bundled registry for?" |
| Depends on | [3.3a](phase-3.3a-release-and-deploy-fragments-2026-10-30.md#the-proof-rule-for-a-bundled-entry) (the proof rule this file cites), [2.0b](phase-2.0b-bench-2026-10-30.md) (bench runs; these fragments are proved under `--sandbox`), [2.0c](phase-2.0c-run-ledger-2026-10-30.md) (the ledger), [2.2](phase-2.2-deterministic-rot-checks-2026-10-30.md) (reference, import and dated-phrase checks on the content), [1.6c](phase-1.6c-first-release-2026-10-30.md) (the shipped format and the catalog 1.6a brought into v1) |
| Blocks | [3.3b](phase-3.3b-bundled-stack-expansion-2026-10-30.md) soft (where a stack defaults to one of these fragments) |
| Decisions needed | D6 (curated catalog) assumed; if the bundled set is the maintainers' own stack instead, these go to a user directory or a source. Whether personal-tooling fragments ship at all is open (roadmap, Feature gaps). D5 and D7 apply unchanged |
| Settles | The order these fragments are proved in |

## Scope

In:

- A bench proof under 3.3a's rule for each bundled fragment whose `category` is
  `service`, `vendor` or `tooling` (the Effect fragments are `tooling`), each in its own
  change.
- Fixes the bench runs call for, made in those fragments' entry files.
- A composition test per fragment against every bundled stack it applies to.
- The package README's fragment table rows for these fragments.

Out:

- Writing the fragments (1.6a).
- Release and deploy fragments (3.3a), stacks (3.3b), the agent harness fragment (3.4a)
  and apps (3.5b), even where an app requires one of these fragments.
- Any fragment that needs a paid account for `verify` to pass. A vendor or service
  fragment's verify uses the provider's local emulator or test mode; one with neither is
  not bundled.
- CI changes in this repo (D23).
- Dependency versions anywhere (D1, D3). Fragments name tools; agents choose versions.

## Design

### Where this fits

3.3a defines the proof rule and proves release and deploy fragments. This sub-phase
proves the service, vendor and tooling pieces: a local database is the one job 4 names,
and the rest are what a stranger expects next. None of their categories is dropped by
`--sandbox`, so each is proved with a sandbox bench run.

### Proof rule

[3.3a's proof rule](phase-3.3a-release-and-deploy-fragments-2026-10-30.md#the-proof-rule-for-a-bundled-entry)
applies unchanged. A fragment that can't meet it within the session stays unproved and
is named in the status line; the next agent picks it up. Order: a local database service
first (job 4 names it), then tooling fragments, then vendor fragments, whose emulators
are the least predictable.

### What a bench run checks in these categories

1.6a's entry content rules apply unchanged. A fragment here also has to show, in its
bench run:

- A service fragment's tests run against the real service started locally; the prose
  says why a mock would make the green meaningless. The local service is started the way
  1.3a allows long-lived processes to start (a `serve` step with `expect`), never from a
  setup step.
- A vendor fragment's code lives behind one module, so removing the fragment later is one
  deletion. Its verify runs in the provider's test mode or emulator and needs no account;
  any step that needs a real key carries `prod`.
- A tooling fragment for a library carries a discovery step ("read the installed
  package's exports before writing imports") instead of an API listing, so its prose
  doesn't age with the library's releases.
- A fragment that `requires` another is composed without naming the other, and the
  requirement is pulled in (1.1).

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/registry/fragments/<id>/` for each service, vendor and tooling fragment | Fixes from bench runs |
| `packages/cli/tests/registry.test.ts` | Composition tests |
| `packages/cli/registry/runs.json`, `plans/runs/` | One bench record and note per fragment |
| `packages/cli/README.md` | Fragment table |

## Acceptance tests

1. For each service, vendor and tooling fragment and each bundled stack it applies to:
   `new <stack> --with <fragment> --no-launch --json` succeeds; dry runs cover the
   matrix, and one real write per fragment changes only project files and the CLI's
   state record, runs only fixed CLI git commands, and records step layers;
   `validate` reports zero errors and zero warnings.
2. A fragment with `requires`, composed with `--with` alone, brings its requirement in
   without relying on the stack's defaults.

### Realistic edge cases

3. A service fixture shipping a template renders the expected bytes under a project path containing spaces and non-ASCII characters without escaping the target.
4. A service fragment whose file collides with an existing stack file fails with `ComposeConflict` before writing either file.

## Exit criteria

- Acceptance tests pass; `bun run check` green from the repo root.
- Every bundled service, vendor and tooling fragment is proved under the rule, or the
  ones that aren't are listed in this file's status line with the reason.

## What this plan may get wrong

- Proving each fragment is a lot of bench time. If runs take longer than expected, prove
  the local database fragment first and leave the vendor fragments unproved rather than
  shrinking the proof rule.
- Vendor and edge-database emulators change faster than the rest of a stack. Their prose
  has to stay at the level of "start the provider's local emulator", and 2.2's
  dated-phrase check is the tripwire.
- 2026-10-26: this plan first authored six new fragments from a table (a database
  service, an edge database, analytics, auth and two Effect fragments). 1.6a now brings
  the catalog's service, vendor and tooling fragments into v1, so this file proves them
  instead and names none; the catalog's contents are the maintainers' choice. `package_scope`
  is in v1 (D18 as amended), so "no format change" no longer needs saying.

- 2026-10-27: Ledger `pass` records including every service/vendor/tooling fragment
  remain maintainer exit criteria requiring real sandbox bench runs and notes; they
  are excluded from the traced acceptance numbers.
- 2026-10-27: Services are `cloudflare-d1`, `postgres`; vendors are `clerk`,
  `openrouter-ai`, `posthog`; tooling is `effect`, `effect-schema`, `git-hooks`, `rr`.
  `effect` requires `effect-schema`; the dependency test uses a bundled stack without
  either in its defaults. Empty `applies_to` (`git-hooks`, `rr`) matches every stack,
  otherwise ids and tags match. No entry in these categories uses `package_scope`,
  ships an install script or declares `conflicts`; the file-collision edge uses a
  fixture registry. D7 and the CLI's state/git allowances are recorded in 3.3b/3.3a.

- 2026-10-27 (review): All current service/vendor/tooling fragments are prose-only;
  their bundled writes exercise stack-owned files. A service fixture with a shipped
  template supplies the actual fragment-file rendering edge case.
