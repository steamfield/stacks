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
- B10 Agent permissions. The composed `.claude/settings.json` allows every declared non-destructive command; a stack with no adapter gains one. Allowed: the aggregate, test, single test, lint, format/lint-fix, typecheck, coverage, audit, build, dev-bg/dev-stop/dev-status, logs, clean. Left prompting: install (changes dependencies), dev and start (never return), deploy, release, shared-database migrations, data deletes, paid or live third-party calls. OpenCode rules use the `"<cmd>"` plus `"<cmd> *"` pair.
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
Scaffold: bb25fa3b
Tag: stack-audit/phase-1
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
| a | M | packages/cli/src/core/validate/checks/dx-baseline.ts, packages/cli/tests/validate-dx-baseline.test.ts, packages/cli/tests/fixtures/registry-single-entry-baseline.json, packages/cli/tests/preview.test.ts | contracts, packages/cli/src/core/validate/checks/headings.ts, packages/cli/src/core/validate/checks/commands.ts | packages/cli/tests/validate-dx-baseline.test.ts, packages/cli/tests/bundled-registry.test.ts | codex | merged | foreman/stack-audit-dx-check | the case list passes, lint and typecheck clean |
| b | M | packages/cli/registry/stacks/go-api/, packages/cli/registry/search/stacks/go-api.json | contracts, plans/stack-audit-2026-11-26-survey.md | packages/cli/tests/bundled-registry.test.ts | opus | merged | deliver/stack-audit-1b | go-api meets B1-B12, no dx-* notes, validate clean |
| c | M | packages/cli/registry/stacks/typescript-api/, packages/cli/registry/search/stacks/typescript-api.json | contracts, plans/stack-audit-2026-11-26-survey.md | packages/cli/tests/bundled-registry.test.ts | opus | merged | deliver/stack-audit-1c | typescript-api meets B1-B12, validate clean |
| d | M | packages/cli/registry/stacks/python-api/, packages/cli/registry/search/stacks/python-api.json | contracts, plans/stack-audit-2026-11-26-survey.md | packages/cli/tests/bundled-registry.test.ts | opus | merged | deliver/stack-audit-1d | python-api meets B1-B12, validate clean |
| e | M | packages/cli/registry/fragments/agent-ops/, packages/cli/registry/fragments/git-hooks/, packages/cli/registry/fragments/ci-github/, packages/cli/registry/fragments/claude-harness/, packages/cli/registry/search/fragments/agent-ops.json, packages/cli/registry/search/fragments/git-hooks.json, packages/cli/registry/search/fragments/ci-github.json, packages/cli/registry/search/fragments/claude-harness.json | contracts, plans/stack-audit-2026-11-26-survey.md | packages/cli/tests/bundled-registry.test.ts | opus | merged | deliver/stack-audit-1e | the four fragments follow the brief rule and support B5-B10, validate clean |

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

### Phases 2-4 scope (after the pilot)

The pilot benches showed no setup-speed gain and no net brief saving; the value was in the commands, allow lists and the fixed dev scripts. So the rest of the run lands only those: missing B1 aggregate, B2 format and B3 audit commands, B10 allow lists on every stack (an adapter where a stack has none), B4 only where a wrapper would leave the real server on the port, and the B5 fragment gaps if they hold. No brief or search-card rewrites except to fix a false claim or add a sentence naming a new command; the fragment lanes are dropped.

B4 applies to `make` stacks with a serve step (astro-blog, astro-product-site, django, django-api, go-htmx, quarkus-api, rust-api, spring-boot-api, spring-boot-web, streamlit). `scripts` stacks' dev servers (vite, next, nuxt, wrangler, nest) are single processes a caller can stop, so they don't need it; the check narrows to match (lane 2/a).

### Phase 2: the narrowed check, Go, Rust, Python and JVM stacks

Demo: `bun run dev validate` lists no `dx-*` note for these stacks, and every B4 stack's `dev-cycle` step passes in a fresh scaffold.
Depends on: phase 1
Scaffold: 6221687c (no new contracts; anatomy's "Developer experience" and go-api's dev-bg.sh are the contracts)
Tag: stack-audit/phase-2

| Lane | Size | Owns files | Reads | Tests | Model | Status | Branch | Done when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a | S | packages/cli/src/core/validate/checks/dx-baseline.ts, packages/cli/tests/validate-dx-baseline.test.ts, packages/cli/skills/stacks-author/references/anatomy.md, packages/cli/plugin/skills/stacks-author/references/anatomy.md | contracts | packages/cli/tests/validate-dx-baseline.test.ts | codex | merged | foreman/stack-audit-b4-make | B4 applies only to make stacks, tests updated, lint and typecheck clean |
| b | M | packages/cli/registry/stacks/go-cli/, packages/cli/registry/stacks/go-grpc/, packages/cli/registry/stacks/go-htmx/, packages/cli/registry/stacks/go-library/, packages/cli/registry/stacks/go-mcp/, packages/cli/registry/stacks/go-tui/, packages/cli/registry/search/stacks/go-htmx.json | contracts, packages/cli/registry/stacks/go-api/ | packages/cli/tests/bundled-registry.test.ts, packages/cli/tests/dev-bg-shared-body.test.ts | opus | merged | deliver/stack-audit-2b | ROI brief |
| c | M | packages/cli/registry/stacks/rust-api/, packages/cli/registry/stacks/rust-cli/, packages/cli/registry/stacks/rust-library/, packages/cli/registry/stacks/rust-tui/, packages/cli/registry/stacks/rust-wasm/, packages/cli/registry/search/stacks/rust-api.json | contracts, packages/cli/registry/stacks/go-api/ | packages/cli/tests/bundled-registry.test.ts, packages/cli/tests/dev-bg-shared-body.test.ts | opus | merged | deliver/stack-audit-2c | ROI brief |
| d | M | packages/cli/registry/stacks/python-cli/, packages/cli/registry/stacks/python-data/, packages/cli/registry/stacks/python-library/, packages/cli/registry/stacks/streamlit/, packages/cli/registry/stacks/django/, packages/cli/registry/stacks/django-api/, packages/cli/registry/search/stacks/streamlit.json, packages/cli/registry/search/stacks/django.json, packages/cli/registry/search/stacks/django-api.json | contracts, packages/cli/registry/stacks/python-api/ | packages/cli/tests/bundled-registry.test.ts, packages/cli/tests/dev-bg-shared-body.test.ts | opus | merged | deliver/stack-audit-2d | ROI brief |
| e | M | packages/cli/registry/stacks/java-cli/, packages/cli/registry/stacks/java-library/, packages/cli/registry/stacks/quarkus-api/, packages/cli/registry/stacks/spring-boot-api/, packages/cli/registry/stacks/spring-boot-web/, packages/cli/registry/search/stacks/quarkus-api.json, packages/cli/registry/search/stacks/spring-boot-api.json, packages/cli/registry/search/stacks/spring-boot-web.json | contracts, packages/cli/registry/stacks/go-api/ | packages/cli/tests/bundled-registry.test.ts, packages/cli/tests/dev-bg-shared-body.test.ts | opus | merged | deliver/stack-audit-2e | ROI brief |

#### Lane 2/a brief

- Goal: `backgroundGap` in `dx-baseline.ts` reports `dx-background` only for stacks whose runner is `make` (tag `make`), keeping every other condition (tag `web` or `api`, a serve-phase step). Scripts stacks get no `dx-background` finding.
- Tests: update the B4 cases in `tests/validate-dx-baseline.test.ts`: a scripts stack with a serve step and no background commands gets no finding; the make cases stay.
- Docs: in both identical `anatomy.md` copies, "Developer experience", B4 says it applies to `make` stacks with a serve step, because a wrapper (`go run`, `manage.py runserver`, `cargo run`, `mvn spring-boot:run`, `quarkus dev`, `streamlit run`, `astro dev` under make) can leave the real server on the port; a scripts stack may ship the pair (typescript-api, react-router do) but isn't required to.
- Out of scope: other checks, the severity constant, registry entries.
- Done when: `bun run test:unit tests/validate-dx-baseline.test.ts tests/bundled-registry.test.ts`, `bun run lint`, `bun run typecheck` pass.

#### Stack lanes ROI brief (phases 2 and 3)

- Goal: close each owned stack's `dx-*` notes and give it a B10 allow list, changing as little as possible.
- Read first: anatomy's "Developer experience" section (`packages/cli/skills/stacks-author/references/anatomy.md`, it wins over the B-list here), this plan's DX baseline, each owned stack's `STACK.md`, its `files/` runner (Makefile or `package.json`) and adapters, and `bun run dev validate --json` from `packages/cli` filtered to the stack. The references: go-api (Make, `scripts/dev-bg.sh`, Claude adapter allow list at `adapters/claude/.claude/settings.json`), python-api (Make in Python), typescript-api (scripts).
- Behavior:
  - B1: add `ci` (make) or `check` (scripts) running every offline check CI runs, never the audit.
  - B2: add `format` (formatter plus the linter's safe fixes) or `lint-fix`.
  - B3: add `audit` with a key-free tool (pip-audit, `bun audit`/`npm audit`, cargo-deny or cargo-audit, osv-scanner for JVM; Go keeps `vuln`). Not a verify step, not in the aggregate. A new tool goes in `tools` or `deps` and is reported.
  - B4 (make stacks with a serve step only): copy go-api's `scripts/dev-bg.sh` byte for byte below `# --- shared body ---`, write only the settings and `launch`/`healthy` above it for this stack, mode 100755 in git (`git update-index --chmod=+x`). Add the `dev-bg`, `dev-stop`, `dev-status` targets and commands, and a `dev-cycle` verify step in go-api's shape (layer `check`, timeout 3m, refuses while a recorded server runs). `logs/` gitignored.
  - B5: where `dx-fragments` fires, add the fragment to `fragments.default` if it works for the stack; otherwise report why not.
  - B10: the Claude adapter's `.claude/settings.json` allows the declared non-destructive commands listed in B10 (and their `make <t>` or `bun run <s>` forms), nothing that installs, serves in the foreground, deploys or deletes data. A stack with no Claude adapter gains one with `merge: [.claude/settings.json]`.
  - Body: add at most one sentence per new command where the Commands section lists commands, and for B4 the go-api Commands line telling agents to use dev-bg/dev-stop/dev-status and never kill servers by name. No other prose changes unless a sentence is false. The search card changes only for a false claim (then restamp with `bun run decorate --restamp <id>`).
  - CI note: if the stack's ci-github note names steps, keep it true for the new aggregate.
- Decisions already made: keep ids; don't edit fragments, CLI source, `runs.json`, dep cards or the allowlist (report each new dep); no verify step that needs the network.
- Done when, in `packages/cli`: `bun run dev validate` shows no `dx-*` note for the owned stacks (`dx-background` on scripts stacks is gone after lane 2/a merges; ignore it), `bun run dev validate --brief <id>` renders for each, `bun run test:unit tests/bundled-registry.test.ts tests/registry.test.ts tests/dev-bg-shared-body.test.ts tests/search-golden.test.ts` pass, and each B4 stack gets a fresh scaffold proof per `references/fresh-scaffold-proof.md` reaching green verify including `dev-cycle`. Hand back: per stack, the commands added and their tool, allow-list entries, B4 settings, fragments added, new deps, and anything that didn't work.

### Phase 3: TypeScript, web, content, apps and games

Demo: `bun run dev validate` lists no `dx-*` note for these stacks; the B4 stacks' `dev-cycle` passes in a fresh scaffold.
Depends on: phase 2

| Lane | Size | Owns files | Reads | Tests | Model | Status | Branch | Done when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a | M | packages/cli/registry/stacks/hono-api/, packages/cli/registry/stacks/nestjs-api/, packages/cli/registry/stacks/typescript-cli/, packages/cli/registry/stacks/typescript-library/, packages/cli/registry/stacks/typescript-mcp/ | contracts, packages/cli/registry/stacks/typescript-api/ | packages/cli/tests/bundled-registry.test.ts | opus | pending | | ROI brief |
| b | M | packages/cli/registry/stacks/nextjs/, packages/cli/registry/stacks/nuxt/, packages/cli/registry/stacks/sveltekit/, packages/cli/registry/stacks/react-router/, packages/cli/registry/stacks/cloudflare-react-router/, packages/cli/registry/stacks/react-vite/ | contracts, packages/cli/registry/stacks/typescript-api/ | packages/cli/tests/bundled-registry.test.ts | opus | pending | | ROI brief |
| c | M | packages/cli/registry/stacks/astro-blog/, packages/cli/registry/stacks/astro-product-site/, packages/cli/registry/stacks/astro-fullstack/, packages/cli/registry/stacks/decks/, packages/cli/registry/search/stacks/astro-blog.json, packages/cli/registry/search/stacks/astro-product-site.json | contracts, packages/cli/registry/stacks/go-api/ | packages/cli/tests/bundled-registry.test.ts, packages/cli/tests/dev-bg-shared-body.test.ts | opus | pending | | ROI brief |
| d | M | packages/cli/registry/stacks/mobile-expo/, packages/cli/registry/stacks/tauri-react/, packages/cli/registry/stacks/phaser-game/, packages/cli/registry/stacks/threejs-game/ | contracts, packages/cli/registry/stacks/typescript-api/ | packages/cli/tests/bundled-registry.test.ts | opus | pending | | ROI brief |

### Phase 4: workspaces, enforcement and proofs

Depends on: phase 3

| Lane | Size | Owns files | Reads | Tests | Model | Status | Branch | Done when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a | S | packages/cli/registry/stacks/hono-react/, packages/cli/registry/stacks/python-react/ | contracts | packages/cli/tests/bundled-registry.test.ts | opus | pending | | root allow lists and aggregate cover both parts |

Inline: fix the two pilot brief nits (typescript-api's Setup names `effect-api.md` without `docs/guidance/typescript-api/`; python-api names both uvicorn and uvicorn[standard]); raise `DX_SEVERITY` to `"warning"` and fix whatever the bundled-registry test then reports; dependency cards and allowlist rows for every reported dep; bench every B4 stack from a QA checkout (its `dev-cycle` step is new), reading each run note before committing its record.

## Log

- Plan critique (devils-advocate, 8 findings, all confirmed against the code): (1) a non-bundled check would change `create.test.ts`'s pinned findings, and (2) a warning would block `stacks submit` via `submit.ts::MAINTAINER_WARNINGS`, so the check is bundled-only; (3) B4 now follows the existing `logs/dev.pid` and process-group convention and reuses a healthy server; (4) B4 gets a `dev-cycle` verify step so the shipped script is exercised; (5) the `vuln` rename is dropped; (6) the check reads composed snapshots instead of re-resolving fragments, and the unreachable `applies_to` test case is gone; (7) the core fragments moved into phase 1 and the bench branch is defined; (8) B4 is limited to `web`/`api` stacks and B3 names key-free audit tools, osv-scanner for JVM.
- 1/a q1: `preview.test.ts` validates a fixture registry as bundled and pins zero findings. Decided: the check skips preview mode (`view.composition` set); fixture data (never assertions) may change so a clean fixture still validates clean.
- Survey (`plans/stack-audit-2026-11-26-survey.md`): no stack pair meets the merge bar; django vs django-api is closest but differs by a file set a `decisions` entry can't switch. No merges planned unless a lane finds one.
- Phase 1 lane reviews: every lane got changes requested. Shared dev-bg lessons for every later B4 lane, now in go-api's merged `files/scripts/dev-bg.sh` (the Make reference; python-api uses the same names): trap via globals installed before launch; 3 s abort grace (the verify runner SIGKILLs 5 s after SIGTERM), longer only for dev-stop; SECONDS-based waits; `LC_ALL=C ps -o lstart=` start time in `logs/dev.pid`, required to match; `logs/dev.lock` serializing starts; remove the pid file only when it names this run; reuse only a recorded server on the requested host/port; stop a group whose leader died. typescript-api's `dev-bg.ts` follows the same rules except it doesn't reap a leaderless group (known gap). Proven on macOS bash 3.2 only.
- ci-github (1/e): the aggregate is the default CI call, but each job installs what its targets need first and a stack's own CI note wins where it splits jobs or names steps. Stack lanes in phases 3-4 rewrite their notes to fit.
- Phase 1 boundary review (5 findings, all accepted): B1, B3 and B4 are now specified in anatomy's "Developer experience" section, which wins over the B-list above where they differ. The audit is out of the aggregate and runs as its own CI step. B4 adds `dev-status`/`dev:status`, a fixed behavior list, a `dev-cycle` shape (layer `check`, 3m, refuses while a recorded server runs), and `scripts/dev-bg.sh` split at `# --- shared body ---`, with a byte-identical body enforced by a registry test. The pilots' allow lists drop install and serve and add clean. The probe's ignore moves into claude-harness's own temp dir. Not taken: adding `added` to `Composed` (lane 1/a decision stands).
- New deps reported: pip-audit (python-api `deps.dev`) needs a dep card and allowlist row.
- After the pilot (user decision): land only what phase 1 showed pays off: the missing commands, allow lists, B4 where a wrapper leaves the server on the port, and fragment gaps. Brief and card rewrites, the fragment lanes and a new bench task are dropped. B4 narrows to `make` stacks (lane 2/a); phases renumbered 2-4.
- 2/b: B1 applied to existing aggregates too: `vuln` left every Go stack's `ci` (CI runs it as its own step). go-tui `golden` and go-library `api-baseline` stay off the allow lists because they overwrite baselines a person should review.
- 2/c: Rust stacks also dropped `audit` from `ci` (same B1 reading as 2/b) and gained `lint-fix` (clippy --fix, then fmt). Not done, outside ROI scope: no Rust stack has a coverage floor (B7); rust-cli lacks a single-test example (B6).
- 2/d: django's `ci` includes `build` (collectstatic; offline, verify runs it, writes only gitignored `staticfiles/`). Python B4 scripts probe health with the project's `.venv/bin/python`, not curl.
- 2/e: JVM `fmt` renamed `format`; JVM dev-bg launches a copy of the jar from `target/dev-bg/` because a rebuild rewrites `target/app.jar` under the running JVM. Found, not fixed (outside scope): quarkus-api's shipped code doesn't compile on Quarkus 4 (Jackson 3 imports, `target/quarkus.log` no longer written); proofs used the 3.x stream. `make audit` on Quarkus 3.40 reports a real Guava advisory.
- Phase 2 gate: rr ran cli and bench partitions green; the other five were blocked by another session's stuck lock, so lint, typecheck, root tests (325), MCP tests (112) and both e2e suites ran locally with STACKS_LOCAL_GATE=1, all green.
