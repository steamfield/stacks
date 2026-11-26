# Plan: bundled registry audit (stacks and fragments)

Skill: deliver. Profile: deliver. On resume, re-read shared/lane-dag.md before anything else.
plan_graph: /Users/riley/.claude/plugins/cache/claude-essentials/ce/6.0.6/shared/scripts/plan_graph.py
Started: 2026-11-26. Timebox: none. Landing branch: deliver/stack-audit (worktree `.claude/worktrees/deliver-stack-audit`).
Gate: `rr check` (about 30 s; the clone is opted in to rr). Filtered tests: `bun run test:unit tests/<file>.test.ts` in `packages/cli`. Typecheck: `bun run typecheck`.
Runner: rr for the gate and whole suites; scoped tests, lint and typecheck run locally.
Worktree setup: `bun install --frozen-lockfile` at the worktree root.
Suppressions: biome-ignore, @ts-expect-error, @ts-ignore
Manifests: bun.lock

## Spec

Audit every bundled stack (46) and fragment (27) so each one stands up a high-quality project an agent can work in without friction, with a brief that carries only what the agent can't infer, and accurate metadata (frontmatter, search cards, dependency cards). The maintainer and every coding agent that scaffolds from the registry are the users.

In scope:
- Evidence: a static audit of every entry; a Codex bench proof (`bun run bench`, default model and effort) for every stack whose files, Setup or verify steps change materially.
- Brief rule: the body carries only what an agent can't learn from the shipped files or its own knowledge (decisions, setup order, rules new code must keep, gotchas a bench run paid for). Prose restating code, config, the Makefile or `docs/` is cut. No new word target; `BUDGET` stays.
- DX baseline (below), harness-neutral, applied to every stack, with its mechanically checkable part enforced by a new `validate` check.
- agent-ops (directly or through a required fragment) in every stack's default composition where its `applies_to` admits the stack; git-hooks and ci-github likewise.
- Consolidation: merge stacks whose difference fits in one `decisions` entry or one optional fragment. The survey found no pair that meets this bar (see Log); lanes report any they find.
- Search cards: hand-fix any claim a change made false, then `bun run decorate --restamp <id>`. Dependency cards and allowlist rows for new deps are written inline at phase landing from what lanes report.
- A pause after phase 1 for the maintainer to review the baseline and the three pilot stacks.

Out of scope: new stacks or fragments; renaming ids; CLI behavior beyond the new check; changing `BUDGET`; pushing or releasing.

Assumptions (overridable):
- Audit lanes are `stack-creator` agents (Claude, opus), the repo's agent for revising registry entries; the one code lane (the validate check) goes to Codex through foreman per `.claude/rules/agent-ops.md`. Codex writes that lane's tests from the case list below, rather than the scaffold carrying them, because the repo routes test authoring to Codex.
- The new check is bundled-registry policy: it runs only when `view.asBundled`, so `stacks create` skeletons, user registries and `stacks submit` are unaffected (the baseline is still documented for every author in anatomy). It lands as `note` severity in phase 1 (the bundled-registry test fails on any warning, and most stacks don't meet the baseline yet) and is raised to `warning` in phase 5, when every stack does.
- Benches run sequentially from one QA checkout of the phase tag on branch `deliver/stack-audit-bench` (`bun run bench` needs a clean package, and stacks share default ports), never from the landing checkout. That branch collects the `runs.json` records and `plans/runs/` notes after each run note is read, and merges into the landing branch after each batch; no lane edits `runs.json`, so the merge doesn't conflict.
- The fragments every default composition carries (agent-ops, git-hooks, ci-github, claude-harness) are audited in phase 1, so the pilot proofs aren't staled by a later fragment change to their verify steps (`fingerprint.ts::proofFingerprint` hashes composed steps). The remaining fragments (phase 2) land before the stack fan-out (phases 3 and 4) because their text and `stack=` branches shape the composed briefs the stack lanes trim.
- Go keeps `vuln` (B3 accepts `audit` or `vuln`); renaming touches about 30 files and the goreleaser fragment for no agent-facing gain.

Error model: content lanes report failures through `bun run dev validate` findings and the registry tests. The new check reports `Finding`s with fixed messages naming the missing command or fragment and the fix; it never throws for a stack that lacks a runner tag (it skips the runner-dependent rules for it).

## DX baseline

Every stack meets these; B1 to B5 are checked by `dx-baseline`, the rest by lane review.

- B1 Aggregate command. A `make` stack declares `ci`; a `scripts` stack declares `check`. Either runs everything CI runs. A stack using `check` for a tool's own check (`astro check`, `cargo check`) on a `make` runner keeps it and adds `ci`.
- B2 Fix command. `format` is declared and applies the formatter and the linter's safe fixes, or a separate `lint-fix` exists.
- B3 Dependency audit. `audit` (or Go's existing `vuln`) is declared, using a tool that needs no account or API key (govulncheck, cargo-deny, pip-audit, `bun audit`/`npm audit`, or osv-scanner for JVM, whose OWASP dependency-check needs an NVD key). It may need the network and isn't a verify step.
- B4 Background server. A stack tagged `web` or `api` with a `serve`-phase verify step declares a background start and a stop (`dev:bg`, `dev:stop` on `scripts`; `dev-bg`, `dev-stop` on `make`), following typescript-api's and react-router's convention: start reuses a server already running and healthy, otherwise runs the serve command in its own process group, records `logs/dev.pid` and writes output to `logs/dev.log` (gitignored), waits for the health URL, and on failure stops its group before exiting non-zero; stop signals the recorded process group, never a bare wrapper pid (`go run`, `uvicorn --reload`, `runserver`, `spring-boot:run` leave the real server holding the port otherwise). A `dev-cycle` check-phase verify step runs start then stop, so the shipped script is exercised. On a `make` stack it's a small POSIX shell script (bash `set -m` gives the child its own group; macOS has no `setsid`). The body tells agents to use them instead of killing processes.
- B5 Fragments. agent-ops, git-hooks and ci-github each reach the stack's default composition.
- B6 Single-test command. The body's Commands or Testing section shows one concrete single-test (or single-file) invocation.
- B7 Coverage floor. A stack with a unit-test layer declares `coverage` and enforces a floor; CI runs it (ci-github already does when it exists).
- B8 Logs readable from a file in development (B4's `logs/dev.log`, or a `--log-file`/`LOG_FILE` for CLIs and TUIs that own the terminal).
- B9 Toolchain pin. Setup records each toolchain version in the file the tools and CI read (`.node-version`, `.python-version`, `.java-version`, `go.mod`, `rust-toolchain.toml`, `.golangci-lint-version`).
- B10 Agent permissions. The composed `.claude/settings.json` allows every declared non-destructive command; a stack with no adapter gains one.
- B11 `.env.example` and a config doc whenever the slice reads env.
- B12 Lint is a real code linter (not only a format check or a build enforcer) with its config shipped.

## Contracts (scaffold commit)

    packages/cli/src/core/validate/checks/dx-baseline.ts   dxBaselineChecks: Check; stubbed, registered in index.ts
    packages/cli/src/core/validate/index.ts                 adds dxBaselineChecks to `checks` (scaffold owns it)
    packages/cli/skills/stacks-author/references/anatomy.md  "Developer experience" section: B1-B12 and the brief rule
    packages/cli/plugin/skills/stacks-author/references/anatomy.md  identical copy
    .claude/skills/stack-authoring/SKILL.md, .claude/skills/fragment-authoring/SKILL.md  point at the section; audit checklist

`dxBaselineChecks` returns no findings unless `view.asBundled`. For each validated stack it reads the stack's base composition in the `default` preset from `(yield* view.composed).snapshots` (the plan with `added` undefined), as `checks/commands.ts` does: `composition.commands` for B1 to B4 (so commands a fragment adds count), `composition.fragments` for B5 (so `requires` and `applies_to` are already resolved by composition), and the stack entry's own tags and `verify` for the runner and serve rules. It does not resolve fragments itself. Findings use `finding(entry, {...})` with check ids `dx-aggregate`, `dx-format`, `dx-audit`, `dx-background`, `dx-fragments`, severity from one exported constant `DX_SEVERITY` (`"note"` in phase 1), `file: entryFile(view, entry)`, no line.

## Phases

### Phase 1: baseline, its check, core fragments and three pilot stacks (MVP)

Demo: `bun run dev validate` in `packages/cli` lists `dx-*` notes for unaudited stacks and none for go-api, typescript-api and python-api; their composed briefs (`bun run dev validate --brief <id>`) are shorter; each pilot has a fresh green Codex bench record taken after the core fragments landed.
Test cases (lane a, `tests/validate-dx-baseline.test.ts`, each through the real `validate` on a temporary registry validated as bundled, the way `bundled-registry.test.ts` or `validate.test.ts` sets that up):
- a `make` stack without `ci` gets `dx-aggregate`; with `ci` it doesn't.
- a `scripts` stack without `check` gets `dx-aggregate`; a `scripts` stack with only `ci` still gets it.
- a command a default fragment declares counts (a fragment declaring `check` clears `dx-aggregate` for a `scripts` stack).
- a stack with neither runner tag gets no `dx-aggregate`, `dx-format` or `dx-audit` finding.
- missing `format` and missing `lint-fix` gives `dx-format`; either one present clears it.
- missing both `audit` and `vuln` gives `dx-audit`; either clears it.
- a stack tagged `web` or `api` with a `serve`-phase step and no background pair gets `dx-background` naming both missing commands; `make` expects `dev-bg`/`dev-stop`, `scripts` expects `dev:bg`/`dev:stop`; one present names only the other.
- a stack with a serve step but neither `web` nor `api` tag (a desktop app), and a stack without a serve step, get no `dx-background`.
- agent-ops absent from the default composition: `dx-fragments`; present as `default` or `required`: clear; reachable only through a required fragment's `requires`: clear; listed only as `optional`: finding. Same for git-hooks and ci-github, one finding per missing fragment.
- a workspace stack (with `parts`) gets only `dx-fragments`, never the command rules.
- the same registry validated as a user root (not bundled) gets no `dx-*` finding.
- fragments are never checked; every finding has severity `DX_SEVERITY`.
Lane a also runs every existing test file that pins full finding lists (`grep -ln "findings).toEqual" tests/`) and they must pass unchanged.

| Lane | Size | Owns files | Reads | Tests | Model | Status | Branch | Done when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a | M | packages/cli/src/core/validate/checks/dx-baseline.ts, packages/cli/tests/validate-dx-baseline.test.ts | contracts, packages/cli/src/core/validate/checks/headings.ts, packages/cli/src/core/validate/checks/commands.ts | packages/cli/tests/validate-dx-baseline.test.ts, packages/cli/tests/bundled-registry.test.ts | codex | pending | | the case list passes, lint and typecheck clean |
| b | M | packages/cli/registry/stacks/go-api/, packages/cli/registry/search/stacks/go-api.json | contracts, plans/stack-audit-2026-11-26-survey.md | packages/cli/tests/bundled-registry.test.ts | opus | pending | | go-api meets B1-B12, no dx-* notes, validate clean |
| c | M | packages/cli/registry/stacks/typescript-api/, packages/cli/registry/search/stacks/typescript-api.json | contracts, plans/stack-audit-2026-11-26-survey.md | packages/cli/tests/bundled-registry.test.ts | opus | pending | | typescript-api meets B1-B12, validate clean |
| d | M | packages/cli/registry/stacks/python-api/, packages/cli/registry/search/stacks/python-api.json | contracts, plans/stack-audit-2026-11-26-survey.md | packages/cli/tests/bundled-registry.test.ts | opus | pending | | python-api meets B1-B12, validate clean |
| e | M | packages/cli/registry/fragments/agent-ops/, packages/cli/registry/fragments/git-hooks/, packages/cli/registry/fragments/ci-github/, packages/cli/registry/fragments/claude-harness/, packages/cli/registry/search/fragments/agent-ops.json, packages/cli/registry/search/fragments/git-hooks.json, packages/cli/registry/search/fragments/ci-github.json, packages/cli/registry/search/fragments/claude-harness.json | contracts, plans/stack-audit-2026-11-26-survey.md | packages/cli/tests/bundled-registry.test.ts | opus | pending | | the four fragments follow the brief rule and support B5-B10, validate clean |

#### Lane a brief

- Goal: implement `dxBaselineChecks` and its tests so `validate` reports which stacks miss B1 to B5.
- Interface: `export const DX_SEVERITY: Severity = "note"` and `export const dxBaselineChecks: Check` in `dx-baseline.ts` (already registered). Return no findings unless `view.asBundled`. Runner: tag `make` means make naming, else tag `scripts` means scripts naming, else no runner. Read each validated stack's base `default`-preset composition from `(yield* view.composed).snapshots` as `checks/commands.ts` does: commands from `composition.commands`, fragments from `composition.fragments`; tags and `verify` from the stack entry. Never resolve `requires` or `applies_to` yourself. Use `finding`/`entryFile` from `../view`.
- Behavior: exactly the phase 1 test cases. Messages are fixed text naming what is missing and the fix, e.g. `declares no ci command; add one that runs everything CI runs`, `serve step but no dev-bg and dev-stop commands; add a background start that logs to logs/dev.log and a stop that signals only its pid`, `agent-ops is not in the default composition; add it to fragments.default`. Severity is always `DX_SEVERITY`.
- Decisions already made: note severity now; warning in phase 5 (one-line change to the constant, not this lane's).
- Out of scope: any other check, schema changes, changing other checks' severities, docs.
- Done when: `bun run test:unit tests/validate-dx-baseline.test.ts tests/bundled-registry.test.ts` plus every file `grep -ln "findings).toEqual" tests/` lists pass unchanged, and `bun run lint`, `bun run typecheck` pass. No gate (repo rule for delegates).

#### Lane e brief

- Goal: bring the four fragments every default composition carries to the brief rule and make them carry the baseline items that belong in a fragment rather than in each stack.
- Read first: the `fragment-authoring` skill and what it points at, this plan's Spec and DX baseline, the survey, each fragment's `FRAGMENT.md`, `files/`, `adapters/`, `stacks/` overlays and search card in full, and the composed brief of go-api, typescript-api and python-api (`bun run dev validate --brief <id>` from `packages/cli`) to see what each fragment adds.
- Behavior: cut fragment prose an agent doesn't need or that the shipped files already say (agent-ops' "What to add" is 422 words in go-api's brief; the brief's fixed sections already cover some of it). Make agent-ops tell the agent to allow every declared non-destructive command and add a single-test command to AGENTS.md (B6, B10) in as few words as it takes. Keep every verify step unless it's wrong; a changed fragment verify step stales every proof, so change one only for a real defect and list it. Fix `stack=` branches that describe code a stack no longer ships, and claude-harness's `fragment-no-verify` note if a check for its deliverable is possible. Check frontmatter claims and search cards; fix false ones and restamp.
- Decisions already made: no new fragments; don't edit stacks (report needed stack changes); `applies_to` widening that admits a stack is fine if the fragment works there, and should be reported.
- Out of scope: other fragments, CLI source, `runs.json`.
- Done when: `bun run dev validate` shows nothing for these fragments but ledger notes; `bun run dev validate --brief <id>` renders for every stack that composes them; the registry and search tests named in the stack brief pass. Hand back: words before and after per fragment and for the three pilot composed briefs, any verify step changed and why, and reported stack changes.

#### Lanes b, c, d brief (one stack each)

- Goal: bring one stack to the DX baseline and the brief rule, with accurate metadata, ready for a bench proof.
- Read first: the `stack-authoring` skill and what it points at (public `stacks-author` anatomy including its new "Developer experience" section, `references/checkout-checks.md`, `references/conversion-lessons.md`), this plan's Spec and DX baseline, the stack's line in the survey, and the stack's `STACK.md`, `files/` and search card in full.
- Behavior: meet B1 to B12, changing `files/` (Makefile or `package.json` scripts, configs, shipped code and docs) and frontmatter (`commands`, `verify`, `fragments`, `tools`, `deps`, `decisions`). The background pair (B4) ships as a small script in `files/` with tests where the stack has a test layer for scripts, matching how typescript-api does it if it already has one. Rewrite the body under the brief rule: keep the standard sections (What stacks wrote, Layout if needed, Setup, Conventions, Testing, Commands, Gotchas), cut sentences the shipped files already say, keep every Gotcha that still applies, update `stacks:when with=` blocks to match. Check every frontmatter claim (description, tags, tools, deps, decisions) against the shipped slice and fix what's false. Then fix the search card's false claims and restamp it.
- Decisions already made: keep the id; no new word target; don't edit fragments (report needed fragment changes); don't write dependency cards or allowlist rows (report each new dep name and its role); no new verify step that needs the network.
- Out of scope: other stacks, fragments, CLI source, `runs.json`, running the bench.
- Done when: in `packages/cli`, `bun run dev validate` shows no finding for the stack except ledger notes, `bun run dev validate --brief <id>` and `--sandbox` render, `bun run test:unit tests/bundled-registry.test.ts tests/registry.test.ts tests/search-golden.test.ts tests/search-metadata-holdout.test.ts tests/search-golden-coverage.test.ts` pass, and a fresh scaffold proof per `references/fresh-scaffold-proof.md` reaches green verify. Hand back: files changed, body words before and after, composed brief words before and after, each baseline item with its evidence, reported fragment changes and new deps, and anything you couldn't make work.

### Phase 2: fragments

Demo: `bun run dev validate` clean apart from notes; each fragment body and its composed contribution shorter or unchanged, with no stale `stack=` branches.
Depends on: phase 1

| Lane | Size | Owns files | Reads | Tests | Model | Status | Branch | Done when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a | M | packages/cli/registry/fragments/claude-harness-docs/, packages/cli/registry/fragments/ce-plugin/, packages/cli/registry/fragments/rr/, packages/cli/registry/fragments/code-docs/, packages/cli/registry/fragments/docker-deploy/ | contracts | packages/cli/tests/bundled-registry.test.ts | opus | pending | | |
| b | M | packages/cli/registry/fragments/goreleaser/, packages/cli/registry/fragments/npm-release/, packages/cli/registry/fragments/bun-release/, packages/cli/registry/fragments/cloudflare-pages/ | contracts | packages/cli/tests/bundled-registry.test.ts | opus | pending | | |
| c | M | packages/cli/registry/fragments/rest-api/, packages/cli/registry/fragments/openapi-client/, packages/cli/registry/fragments/postgres/, packages/cli/registry/fragments/drizzle-postgres/, packages/cli/registry/fragments/cloudflare-d1/, packages/cli/registry/fragments/effect/, packages/cli/registry/fragments/effect-otlp/, packages/cli/registry/fragments/effect-schema/, packages/cli/registry/fragments/effect-sql-postgres/ | contracts | packages/cli/tests/bundled-registry.test.ts | opus | pending | | |
| d | M | packages/cli/registry/fragments/clerk/, packages/cli/registry/fragments/posthog/, packages/cli/registry/fragments/openrouter-ai/, packages/cli/registry/fragments/openrouter-chat/, packages/cli/registry/fragments/openrouter-chat-cli/ | contracts | packages/cli/tests/bundled-registry.test.ts | opus | pending | | |

(Briefs written while phase 1 runs; each lane also owns its fragments' search cards under `packages/cli/registry/search/fragments/`.)

### Phase 3: Go, Rust, Python and JVM stacks

Depends on: phase 2

| Lane | Size | Owns files | Reads | Tests | Model | Status | Branch | Done when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a | M | packages/cli/registry/stacks/go-cli/, packages/cli/registry/stacks/go-grpc/, packages/cli/registry/stacks/go-htmx/, packages/cli/registry/stacks/go-library/, packages/cli/registry/stacks/go-mcp/, packages/cli/registry/stacks/go-tui/ | contracts | packages/cli/tests/bundled-registry.test.ts | opus | pending | | |
| b | M | packages/cli/registry/stacks/rust-api/, packages/cli/registry/stacks/rust-cli/, packages/cli/registry/stacks/rust-library/, packages/cli/registry/stacks/rust-tui/, packages/cli/registry/stacks/rust-wasm/ | contracts | packages/cli/tests/bundled-registry.test.ts | opus | pending | | |
| c | M | packages/cli/registry/stacks/python-cli/, packages/cli/registry/stacks/python-data/, packages/cli/registry/stacks/python-library/, packages/cli/registry/stacks/streamlit/, packages/cli/registry/stacks/django/, packages/cli/registry/stacks/django-api/ | contracts | packages/cli/tests/bundled-registry.test.ts | opus | pending | | |
| d | M | packages/cli/registry/stacks/java-cli/, packages/cli/registry/stacks/java-library/, packages/cli/registry/stacks/quarkus-api/, packages/cli/registry/stacks/spring-boot-api/, packages/cli/registry/stacks/spring-boot-web/ | contracts | packages/cli/tests/bundled-registry.test.ts | opus | pending | | |

(Each lane also owns its stacks' search cards. Briefs follow the phase 1 stack brief, written during phase 2.)

### Phase 4: TypeScript, web, apps and games

Depends on: phase 2

| Lane | Size | Owns files | Reads | Tests | Model | Status | Branch | Done when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a | M | packages/cli/registry/stacks/hono-api/, packages/cli/registry/stacks/nestjs-api/, packages/cli/registry/stacks/typescript-cli/, packages/cli/registry/stacks/typescript-library/, packages/cli/registry/stacks/typescript-mcp/ | contracts | packages/cli/tests/bundled-registry.test.ts | opus | pending | | |
| b | M | packages/cli/registry/stacks/nextjs/, packages/cli/registry/stacks/nuxt/, packages/cli/registry/stacks/sveltekit/, packages/cli/registry/stacks/react-router/, packages/cli/registry/stacks/cloudflare-react-router/, packages/cli/registry/stacks/react-vite/ | contracts | packages/cli/tests/bundled-registry.test.ts | opus | pending | | |
| c | M | packages/cli/registry/stacks/astro-blog/, packages/cli/registry/stacks/astro-product-site/, packages/cli/registry/stacks/astro-fullstack/, packages/cli/registry/stacks/decks/ | contracts | packages/cli/tests/bundled-registry.test.ts | opus | pending | | |
| d | M | packages/cli/registry/stacks/mobile-expo/, packages/cli/registry/stacks/tauri-react/, packages/cli/registry/stacks/phaser-game/, packages/cli/registry/stacks/threejs-game/ | contracts | packages/cli/tests/bundled-registry.test.ts | opus | pending | | |

### Phase 5: workspaces, enforcement and proofs

Depends on: phase 3, phase 4

| Lane | Size | Owns files | Reads | Tests | Model | Status | Branch | Done when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a | S | packages/cli/registry/stacks/hono-react/, packages/cli/registry/stacks/python-react/ | contracts | packages/cli/tests/bundled-registry.test.ts | opus | pending | | |

Inline: raise `DX_SEVERITY` to `"warning"` and fix whatever the bundled-registry test then reports; dependency cards and allowlist rows for every reported dep; `bun run bench:pending` from a QA checkout for every remaining changed stack, reading each run note before committing its record.

## Log

- Plan critique (devils-advocate, 8 findings, all confirmed against the code): (1) a non-bundled check would change `create.test.ts`'s pinned findings, and (2) a warning would block `stacks submit` via `submit.ts::MAINTAINER_WARNINGS`, so the check is bundled-only; (3) B4 now follows the existing `logs/dev.pid` and process-group convention and reuses a healthy server; (4) B4 gets a `dev-cycle` verify step so the shipped script is exercised; (5) the `vuln` rename is dropped; (6) the check reads composed snapshots instead of re-resolving fragments, and the unreachable `applies_to` test case is gone; (7) the core fragments moved into phase 1 and the bench branch is defined; (8) B4 is limited to `web`/`api` stacks and B3 names key-free audit tools, osv-scanner for JVM.
- Survey (`plans/stack-audit-2026-11-26-survey.md`): no stack pair meets the merge bar; django vs django-api is closest but differs by a file set a `decisions` entry can't switch. No merges planned unless a lane finds one.
