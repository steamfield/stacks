# Phase 3.3b: Bundled stack expansion

Status: EXECUTED 2026-10-27 (every traced acceptance test, the committed gate-stack brief
digests). Unproved: the bench proofs for `cloudflare-react-router`, `mobile-expo`,
`react-router`, `tauri-react` and `typescript-cli`, which need real bench runs and are the
maintainers'. Drafted 2026-10-26. Re-scoped 2026-10-26: 1.6a brings every bundled
stack into v1, including those beyond the gate set, so this file gives each of those a
bench proof and keeps the backlog. A stack too large for the budget now splits its slice
into an app fragment (1.1), not a D26 app entry. Body rewritten to match 2026-10-26
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | Every bundled stack outside the gate set has a green bench run under D5 and D7, recorded in the ledger, and a backlog section names the next entries so later sessions pick them up without rediscovering them |
| Traces to | Job 1: "When I start a new project, I want it set up the way I'd set it up myself"; open question "Who is the bundled registry for?"; assumption 2, "version-less prose rots much more slowly than versioned templates", which needs more than three stacks to test |
| Depends on | [2.0b](phase-2.0b-bench-2026-10-30.md) (bench runs), [2.2](phase-2.2-deterministic-rot-checks-2026-10-30.md) (rot checks on the content), [3.3a](phase-3.3a-release-and-deploy-fragments-2026-10-30.md) and [3.3c](phase-3.3c-service-vendor-and-effect-fragments-2026-10-30.md) soft (a stack whose defaults include one of their fragments waits for that fragment's proof; one that doesn't can go first), [3.5b](phase-3.5b-two-phase-brief-2026-10-30.md) soft (a stack that offers an app is proved without it here; the app's own proof is 3.5b's), [2.0c](phase-2.0c-run-ledger-2026-10-30.md) (the ledger the proof rule checks) |
| Blocks | Nothing |
| Decisions needed | D6 (curated catalog) assumed; which stacks ship is the maintainers' choice (roadmap, Feature gaps). D5 and D7 unchanged. If a stack can't fit its proving slice in 1.5's composed cap, the part past the base moves into an app fragment (`category: app`, 1.1) or the stack is cut, not given a bigger budget |
| Settles | Each stack's proving slice as checked by its bench run; the order stacks are proved in; the backlog order |

## Scope

In:

- A bench proof under [3.3a's proof rule](phase-3.3a-release-and-deploy-fragments-2026-10-30.md#the-proof-rule-for-a-bundled-entry)
  for each bundled stack outside the gate set, with stacks in place of fragments: 2.2's
  `ledger-unproven` note must be absent for each (a `pass` record for the default
  composition under `--sandbox`).
- Fixes the bench runs call for, in those stacks' entry files and, within the rule
  below, in the shared default fragments.
- The backlog section below.

Out:

- Writing the stacks (1.6a).
- Apps a stack offers (3.5b proves them).
- Device or simulator runs in verify. A mobile verify that needs a simulator can't run on
  a headless machine; the proving slice stops at tests and the export build, and the
  prose says how to run on a device.
- Signing and store submission for desktop and mobile. Prose names them as the project's
  own later steps.
- The backlog entries themselves.

## Design

### Where this fits

The gate stacks (1.6a, 1.6b) test assumption 1 at two brief sizes. More stacks are how
assumption 2 gets tested across toolchains that move at different speeds, and how the
catalog becomes something a stranger wants (D6). Each stack is a surface that can rot,
so each is proved (2.0b) and watched by 2.2's ledger notes from then on.

### What each bench run checks

1.6a's entry content rules and 3.3a's proof rule apply. In addition, each run note
checks by hand that:

- The proving slice named in the stack's Setup was built, and covers every D7 layer.
- A stack with two toolchains (a native shell and a web UI, say) gets hooks and CI that
  cover both, through `stacks:when tag=...` blocks in the default fragments.
- `tools` lists every CLI the agent needed on `PATH`, so 1.2a's missing-tools list and
  the `--without` hint were accurate.
- Every step that needs a production account (edge hosting, app stores) carries `prod`,
  is skipped under `--sandbox`, and the stack verifies against a local emulator.
- A dev server is a `serve` step with `expect: { http, within }`; a native shell's debug
  build is a `build` step, not a `serve` step.

### Order

Cheapest to prove first: stacks closest to the gate stacks' toolchains, then stacks with
a second toolchain, then desktop and mobile, whose SDK installs are slowest. A stack that
misses the proof rule in one session stays unproved and is named in the status line.

### Backlog

Entries designed but not scheduled. Each needs a maintainer to move it into a sub-phase;
they are listed so no one rediscovers them.

| Entry | Kind | Notes |
|---|---|---|
| `mcp-server` | stack | A Model Context Protocol server in TypeScript with stdio transport, a protocol conformance test, and an inspector-based smoke step |
| `slide-deck` | stack | A web slide deck built from Markdown with a static export and a visual smoke test |
| `plugin-marketplace` | stack | A repository that publishes agent plugins and skills, with a manifest validation step |
| `ts-fullstack` | stack | A TypeScript API and frontend in one workspace; overlaps a gate stack in shape, so it waits for evidence that users want it |
| `otel` | fragment | OpenTelemetry tracing with a local collector and a test that asserts one span |
| `deps-bot` | fragment | A dependency-update bot configured by intent (grouping, schedule, automerge for patch updates that pass CI) |
| `agent-action` | fragment | A GitHub Action that runs a coding agent on issues or pull requests, with its permissions spelled out |
| `mcp-registry` | fragment | Publishing an MCP server's metadata to a registry from a tag |

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/registry/stacks/<id>/` for each stack outside the gate set | Fixes from bench runs |
| Shared default fragments under `packages/cli/registry/fragments/` | `tag=` blocks for a stack's toolchain where its run needs them, within D5 |
| `packages/cli/tests/registry.test.ts` | Composition, size and brief-identity tests |
| `packages/cli/registry/runs.json`, `plans/runs/` | One bench record and note per stack |
| `packages/cli/README.md` | Stack table, with each stack's proof |

## Acceptance tests

1. For each stack outside the gate set and both presets: `new --no-launch --json`
   succeeds, `briefWords` is under 1.5's cap, and the manifest has every D7 layer
   (with a `serve` step carrying `expect` where the stack has a server). Only the
   CLI's fixed git commands run.
2. `validate` over the bundled registry reports zero errors and zero warnings.
3. Each gate stack's canonical brief in both presets is byte-identical to a committed
   digest list generated through `validate --brief <stack> [--sandbox] --json`.
4. Adding a shared fragment's `stacks:when` branch for another stack leaves an
   unaffected gate stack's canonical brief bytes and its composition fingerprint
   unchanged in both presets, so its ledger proof still holds.

### Realistic edge cases

5. Scaffolding from a symlinked working directory with spaces under an agent ignores inherited git repository variables and initializes only the target repository.

## Exit criteria

- Acceptance tests pass; `bun run check` green from the repo root.
- Every bundled stack outside the gate set is proved under the rule, or this file's
  status line lists which aren't and why.

## What this plan may get wrong

- Desktop and mobile toolchains install slowly and need large SDKs; a bench run may hit
  the 60-minute cap on install alone. If so, raise `--max-minutes` for that stack in its
  run note rather than trimming the slice.
- Mobile verify without a simulator proves less than the web stacks do. If the
  maintainers want device-level proof, it needs a runner with a simulator, which is
  phase 5 work.
- Shared fragments growing `tag=` blocks for every toolchain push existing stacks toward
  the composed cap only if the blocks apply to them; if a block leaks, the brief-identity
  test fails.
- 2026-10-26: this plan first designed and authored three new stacks (an edge-hosted
  React app, a desktop app, a mobile app) and sent a stack too large for the budget to
  D26's `app` entry kind. The amended D18 and D13 changed both: 1.6a brings every bundled
  stack into v1, so this file proves the stacks beyond the gate set rather than writing
  them, and a slice past the budget becomes a `category: app` fragment composed by 1.1.
  The catalog's stacks are the maintainers' choice, so this file names none; how many
  there are sets how long this sub-phase takes.

- 2026-10-27: Ledger `pass` records and the absence of `ledger-unproven` notes
  require maintainer bench runs; they are exit criteria outside the traced numbers.
  Brief digests freeze today's canonical output, not evidence of a successful bench.
  Regenerate a gate stack's digests only after an intentional brief change is proved.
- 2026-10-28: QA-05/QA-11 intentionally change Astro checker/lifecycle guidance;
  QA-07 aligns Python wire casing and its acceptance tests. Refresh those four
  canonical brief digests after their focused regressions pass. They freeze prose,
  not runtime proof; do not update the historical ledger.
- 2026-10-28: The follow-up app eval checkpoint replaces direct dry-run commands
  in both app manifests. openrouter-ai owns dependency-free report v1 validation
  and the process/file checkpoint; vendor-only compositions gain no verify step.
  This independently checks report completeness and aggregates, while app
  runners, stubs and scorers stay agent-owned. See plans/qa-gap-closure.md.
- 2026-10-27: No packed tarball exists until 0.2. Existing coverage is
  `e2e/binary.test.ts` (the compiled binary reads a trusted registry from its installed
  prefix), `tests/bench.test.ts` (the fresh prefix contains the dev binary and registry),
  and `tests/registry.test.ts` (git ignores no registry files), rather than a tarball
  file-list equality test. Distribution remains a maintainer exit criterion.
- 2026-10-27: 1.6b and binary tests identify the gate set as `astro-blog`, `go-cli`,
  `python-react`; expansion covers `cloudflare-react-router`, `mobile-expo`,
  `react-router`, `tauri-react`, `typescript-cli`. D7 is absent from the settled README
  decisions log: its proposal in `requirements.md` and implemented validator require
  install, lint, typecheck and test, plus a probed serve for web/api stacks. `check`,
  build and docs are not additional required D7 layers. The tests follow that existing
  behavior. Updating real ledger records and run notes remains maintainer follow-up.

- 2026-10-27: This plan said the fingerprint changes when a shared fragment gains a
  branch for another stack. It doesn't: `compose.ts` resolves body conditionals before
  `fingerprint.ts` hashes the bodies, so an inapplicable branch changes neither the
  brief nor the fingerprint, and no `ledger-changed` note follows. That is the better
  contract (proof attaches to what the agent was given), so item 4 asserts it and the
  run notes need no rerun for such a fix.
