# Bundled stack audit

Status: EXECUTED 2026-10-29 except task 8. Fix guide tasks 1 to 7 (findings 1 to 6 and 8) landed together; the changed compositions await a bench run. Task 8 (finding 7, the dev-logs fragment) is blocked: moving `scripts/logs.ts` and `scripts/dev-logs.ts` out of the stacks broke repository typecheck, because other stack-owned scripts import them by relative path before composition, and the attempt put `typescript-api --with rr` at 6,001 of 6,000 words. It needs a different extraction design or should be dropped. The two CLI questions it raised are settled. `--with` of a fragment that doesn't fit stays a warning, per phase 1.1's recorded decision (an explicit request beats an author's guess about fit), which the narrowed `applies_to` lists now make accurate. `validate --brief` had turned the caller's own `--with` and `--without` warnings into stack errors ("fragments.optional names <fragment>", exit 2); it now returns them as warnings and exits 0, as `new` does.

All ten stacks define testing tools and a concrete proving slice. The useful work is tightening what verification actually proves, correcting fragment contracts, and sharing a small amount of duplicated infrastructure. There is no evidence here for replacing the testing frameworks or adding a database, auth provider, or deployment target to every stack.

## Scope and evidence

Audited the working tree at commit `767d69f`, including the then-uncommitted registry revision and `astro-api` → `astro-fullstack` rename. Read all ten stack recipes, the fragment recipes they compose with, file inventories, relevant shipped helpers, acceptance documents, agent rules and Makefiles. Used the stack-authoring and fragment-authoring skills, the product statement, concepts, authoring guide, and composition/verification implementation to establish what a stack promises.

A devils-advocate pass then checked every finding against the registry and CLI source at `4203b84`. Its corrections are folded into the findings below; where it was itself wrong (finding 7's list of identical files), the finding says so.

Stacks intentionally leave application code and current dependency versions to the implementing agent. An absent generated config, application implementation, or pinned version is therefore not a finding.

Evidence levels in this report:

- **Composition reproduced:** ran the source CLI's brief preview and inspected the result.
- **Source confirmed:** the recipe or shipped file directly establishes the gap. Runtime consequences are explained, not presented as observed failures of a generated project.
- **Maintenance opportunity:** duplication or uneven guidance delivery with a concrete consolidation path; not a claim that the current project is broken.

No generated project was built, no external service was provisioned, and no live account or native-device behavior was tested. This is a recipe/composition audit, not a fresh bench certification. Dependency compatibility against today's upstream releases remains the implementing agent's job.

## Findings

### 1. Postgres test harness: ownership fixed, lock order and teardown still unsafe

**Priority: high. Affects `python-react --with postgres`. Source confirmed.**

The original finding (fixed lock, prefix deletion, a shared `<project>_template` migrated after the lock was released) is resolved. `10dcf1c` removed the unreachable Drizzle paragraph and the Go/TypeScript dependency roles, and `4203b84` rewrote the [Postgres fragment](../packages/cli/registry/fragments/postgres/FRAGMENT.md)'s "Test harness" around a run-owned template (`<project>_tpl_<runid>`), exact-name cleanup, dropping the template on a failed migration, and an overlapping-runs regression test.

Two problems remain:

- **Lock order.** Step 1 says "Release the lock, then close every connection to the template." That is backwards. Workers of the same run share the run id and therefore the lock; worker B takes the lock the moment worker A releases it, sees the template exists, and issues `CREATE DATABASE ... TEMPLATE`, which fails with "source database is being accessed by other users" if A's migration engine or pool is still connected. Connections must be closed (engine disposed) before the lock is released. The mobile guide doesn't settle this order either.
- **Teardown stops `db-test`.** The harness opens with "Two runs can share `db-test` (two agents, a watch run beside a full one)", but the fragment's verify teardown is `make db-down`, which is `docker compose stop` and stops both services. `db-test`'s data dir is tmpfs, so a verify finishing in one terminal deletes every database a concurrent pytest run is using.

A smaller related gap: two worktrees of one project get different compose project names but the same host ports (`PORT_DB` 5432, `PORT_DB_TEST` 5433), so the second `db-up` fails on a port conflict. The fragment doesn't say that a second checkout sets its own ports in `.env`.

The rewrite also made the fragment longer than when the audit measured budgets, so `python-react --with postgres --sandbox` needs a fresh `validate --brief` before the finding closes.

### 2. Go's integration suite is defined but omitted from verify, CI and vet

**Priority: medium. Affects `go-cli`. Source confirmed.**

The [stack](../packages/cli/registry/stacks/go-cli/STACK.md) requires black-box binary tests under `tests/integration/` with the `integration` build tag. The [shipped Makefile](../packages/cli/registry/stacks/go-cli/files/Makefile.tmpl) runs them only through `test-integration`:

```make
vet:
    go vet ./...
test:
    go test ./...
test-integration:
    go test -tags integration ./tests/integration/...
coverage:
    go test -race -coverprofile=coverage.out -covermode=atomic ./...
ci: fmt-check lint coverage vuln build
```

Neither verify nor the `ci` target nor the prescribed CI steps call `test-integration`. The smoke target runs only `--help` and `--version`; it does not exercise config precedence, real exit codes, or error/output behavior. Configuring the integration tag for golangci-lint does not execute the tests.

Two refinements from review. `make vet` runs `go vet ./...` without `-tags integration`, and the stack's own Gotchas say tagged files are invisible to vet, so the integration tests are never vetted. And `go test -tags integration ./tests/integration/...` passes when the directory has no tests, so adding it to verify without a guard lets verify go green on an empty suite.

### 3. Fragments compose onto stacks they have no instructions for

**Priority: medium. Affects `bun-release` on every Bun stack, and more mildly `docker-deploy` and `openrouter-ai`. Composition reproduced with `astro-blog`.**

[`bun-release`](../packages/cli/registry/fragments/bun-release/FRAGMENT.md) declares `applies_to: [bun]`. Its contract assumes a compiled CLI, an `update --check` command, prefixed release configuration, and `doctor --json`. Bun is also the package manager for `astro-blog`, `react-router`, `typescript-api`, `python-react`, `tauri-react` and others that have none of those. [`fitsStack`](../packages/cli/src/core/compose/selection.ts) matches the stack id or any one tag, so

```sh
bun run dev validate --brief astro-blog --with bun-release --sandbox --json
```

composes the CLI self-update instructions and the `release-build-all` step into a static blog's brief.

The same tag-based matching affects two more fragments. `docker-deploy` (`applies_to: [python-react, api]`) fits `mobile-expo` through its `api` tag and composes there with no branch for its Hono/Bun API, only generic text. `openrouter-ai` (`applies_to: [typescript]`) fits `astro-blog`, a static site with no server to hold the key. These produce vague guidance rather than wrong guidance, but the cause is the same.

What narrowing `applies_to` changes, corrected from the first version of this finding: an explicit `--with` of a fragment that doesn't fit is not an error for `new` or `validate --brief`. `selectWith` pushes a `with_not_applicable` warning and keeps the fragment in the composition. Only `add` refuses, with an `applies_to` conflict. Narrowing therefore turns the silent case into a warned one for `new` and a refusal for `add`; it does not make `new` fail. Whether `--with` of a fragment that doesn't fit should become an error is a separate CLI decision, left open here.

A two-tag list such as `[bun, cli]` still means either tag, so narrowing has to use stack ids or a tag only the intended stacks carry.

### 4. Sandbox verification skips the builds that prove the web deliverable, and the ledger counted those runs green

**Priority: high (raised from medium). Affects `astro-blog` and `python-react`. Source confirmed.**

Both stacks tag their local `make build` step `prod`: [Astro](../packages/cli/registry/stacks/astro-blog/STACK.md) and [Python/React](../packages/cli/registry/stacks/python-react/STACK.md). Under `--sandbox`, [compose](../packages/cli/src/core/compose/compose.ts) marks `prod` steps `skipByDefault` and [verify planning](../packages/cli/src/core/verify/plan.ts) skips them unless `--all` is supplied, while keeping the run's scope `full`.

For Astro, the recipe calls the production build its integration test for every route, RSS, sitemap and OG image. For Python/React, it is the static SPA artifact check. A dev-server probe and unit tests can pass without either build succeeding, and these builds need no deployment credentials.

Review raised the priority. All eight records in [`registry/runs.json`](../packages/cli/registry/runs.json) are `"preset": "sandbox"`, and the astro-blog record shows the build step `"status": "skipped"`. The only bench proofs for these two stacks never ran the build, and they were counted green because a default skip keeps scope `full`. Validation can't catch it either: `LAYERS` in `core/validate/compositions.ts` covers install, lint, typecheck and test, and `baseSteps` excludes steps skipped by default.

`tauri-react`'s `build` (native bundle) and the `prod` steps in `docker-deploy` and `goreleaser` stay tagged: they have platform prerequisites or produce release artifacts.

### 5. Browser smoke tests are outside verify for both SSR/SPA web stacks

**Priority: medium. Affects `react-router` without an app fragment, and `python-react`. Source confirmed.**

The [React Router stack](../packages/cli/registry/stacks/react-router/STACK.md) promises a Playwright smoke against the production build, provides `e2e`, includes it in `check`, and requires it in CI, and its own Claude rule calls e2e "the only one that runs the real client in a browser." Its verify list runs install, lint, typecheck, Vitest, build and a development `/healthz` probe, and never calls `e2e` or `check`. A base project can reach green verify with a failing browser smoke. The `openrouter-chat` app adds its own e2e step; that doesn't cover the base composition.

The first version of this audit accepted `python-react`'s exclusion because its recipe documents it ("`make e2e`, not verify"). Review pointed out that documenting a gap doesn't close it: python-react's browser smoke is just as unproven. One rule should cover both stacks. The rule this audit adopts: a web stack that ships a browser smoke runnable without credentials runs it in verify, because verify is the definition of done.

### 6. Tauri's cross-platform library promise lacks a check

**Priority: low (lowered from medium). Affects `tauri-react`. Source confirmed.**

The [platform decision and Rust guidance](../packages/cli/registry/stacks/tauri-react/STACK.md) say library crates must `cargo check` on macOS, Linux and Windows. The [Makefile](../packages/cli/registry/stacks/tauri-react/files/Makefile.tmpl)'s `typecheck-rust` checks only the host target; `--all-targets` covers Cargo target kinds, not operating systems. CI has one Rust job, on the bundle platform.

The first recommendation (library jobs on three OS runners) is too heavy a default for a starter whose only library crate is a pure `core` crate with no platform code. The recipe already anticipates a cheaper route ("Record anything else (a release build, a Linux cross-check) as a new target"): one host can `cargo check --target <triple>` the library crates for each promised platform, excluding the Tauri shell crate. The gap is latent until platform code arrives, hence the lower priority.

One tension the first version missed: the recipe also says "Prefer crates with bundled C libraries." Their build scripts compile C for the target, so a cross-target `cargo check` breaks once such a crate is added unless that target's C toolchain is present. The recipe has to say what happens then.

### 7. The two Effect HTTP stacks duplicate their dev-log tooling and more

**Priority: medium maintenance opportunity. Affects `typescript-api` and `astro-fullstack`. File comparison confirmed with `cmp`.**

Byte-identical across `stacks/typescript-api/files/` and `stacks/astro-fullstack/files/`: `scripts/logs.ts` (174 lines), `scripts/dev-logs.ts` (156), `scripts/prepare.ts`, `.claude/hooks/dev-server-status.ts`, `tests/hooks/helpers/dev.ts`, and in `adapters/codex/`, `.codex/hooks.json` and `tests/hooks/codex-wiring.test.ts`.

Near-identical, differing only where the stacks really differ (one server versus an API plus a web server): `.claude/hooks/guard-api-commands.ts` (`dev:server` versus `dev:api` in two strings), `scripts/dev-pid.ts` (one port versus two), `tests/hooks/dev-bg.test.ts`, `tests/hooks/dev-logs.test.ts` (425 versus 427 lines) and `adapters/codex/tests/hooks/codex-session-start.test.ts`. The devils-advocate listed some of these as identical by line count; `cmp` shows they are not. In particular the log modules' tests have diverged, because they drive each stack's own `dev.ts`.

The two `effect-api.md` guides largely repeat middleware, error-table, config, logging and service rules, and the two testing guides differ mainly in layout paths. Moving unchanged prose into a required fragment reduces maintenance copies, not composed brief length, and `astro-fullstack --with rr --sandbox` is at 5,997 of 6,000 words, so any extraction that adds a fragment heading and body to that brief has to remove at least as many words from the stack.

The scope this audit recommends: extract only the self-contained, byte-identical pair `scripts/logs.ts` and `scripts/dev-logs.ts` (they import nothing from the stack) into a fragment both stacks require. Leave the launch logic, PID layout, guards, Codex wiring and every test in the stacks; their differences are real, and the tests exercise stack-owned launch code. Defer the HTTP guidance split until there is budget evidence that it shortens a brief.

### 8. Detailed React Router and Tauri guidance is available only to Claude

**Priority: medium. Affects `react-router` and `tauri-react`. File inventory and guidance comparison confirmed.**

Both stacks give every agent the base recipe and shared agent-ops files, but their detailed references live only under `adapters/claude/.claude/rules/`:

- React Router: [server Effect rules](../packages/cli/registry/stacks/react-router/adapters/claude/.claude/rules/app/effect-server.md), [routes](../packages/cli/registry/stacks/react-router/adapters/claude/.claude/rules/app/routes.md), [testing](../packages/cli/registry/stacks/react-router/adapters/claude/.claude/rules/app/testing.md), [TypeScript](../packages/cli/registry/stacks/react-router/adapters/claude/.claude/rules/app/typescript.md) and [verification](../packages/cli/registry/stacks/react-router/adapters/claude/.claude/rules/app/verification.md).
- Tauri: [frontend](../packages/cli/registry/stacks/tauri-react/adapters/claude/.claude/rules/frontend.md), [IPC](../packages/cli/registry/stacks/tauri-react/adapters/claude/.claude/rules/ipc.md) and [Rust](../packages/cli/registry/stacks/tauri-react/adapters/claude/.claude/rules/rust.md.tmpl).

These hold React Router's callback/runtime and route-test conventions and Tauri's transport, channel and test-writing details. Codex, Cursor and other targets never receive them. `typescript-api` already uses the portable pattern: substantive guides under [`files/docs/guidance/typescript-api/`](../packages/cli/registry/stacks/typescript-api/files/docs/guidance/typescript-api/index.md), and Claude rules such as `adapters/claude/.claude/rules/src/effect-api.md` reduced to a one-line pointer.

The React Router TypeScript rule also asserts "This is TypeScript 7" and a fixed `ES2023` library configuration, although setup installs current compatible dependencies. The [TypeScript CLI guide](../packages/cli/registry/stacks/typescript-cli/files/docs/guidance/typescript-cli/typescript.md.tmpl) states these conditionally on the installed compiler and generated config.

## Coverage of every stack

| Stack | Testing and agent setup reviewed | Findings |
| --- | --- | --- |
| `astro-blog` | Vitest, happy-dom, Testing Library, schema/content tests, Astro check, static build and basic agent-ops. | 3 (as a target of `bun-release` and `openrouter-ai`), 4. No evidence that it needs a heavier harness or mandatory Playwright suite. |
| `astro-fullstack` | Vitest projects, typed client/island tests, real Node and web-handler HTTP matrix, static-file acceptance, shared guidance and Claude/Codex hooks. | 7. Brief is at the word budget with `rr`. |
| `cloudflare-react-router` | Workers Vitest integration, real framework HTTP coverage, scheduled-handler tests, local build/serve and isolated D1 testing when selected. | None stack-specific. |
| `go-cli` | Table-driven testify tests, config precedence, tagged binary integration tests, race/coverage target and smoke. | 2. |
| `mobile-expo` | Bun API tests with real Postgres, Jest/Expo component tests, real providers/hooks, offline Clerk boundary, migration/import-graph/CI acceptance, bundle checks. | 3 (as a target of `docker-deploy`). Its database ownership was the model for finding 1. Brief is at the word budget with `rr`. |
| `python-react` | pytest/HTTPX, lifespan tests, Vitest/Testing Library/MSW, generated OpenAPI client checks, coverage floors and a Playwright smoke. | 1, 4, 5. |
| `react-router` | Vitest real-layer tests, component environment, Playwright production smoke, runtime/logging tests and specialized Claude guards. | 5, 8. |
| `tauri-react` | Cargo tests, paused-time channel tests, Vitest transport tests, Playwright mock-transport E2E, bindings drift and crate-edge checks. | 6, 8. Native window validation is honestly marked manual. |
| `typescript-api` | Vitest with two real HTTP transports, explicit acceptance matrix, lint probes, helper tests and portable guidance. | 7. No default database or auth provider, intentionally. |
| `typescript-cli` | Node Vitest, isolated HOME/config/env, real command-tree tests, compiled Bun binary tests, independent config/logging acceptance and portable guidance. | None. The only intended target of `bun-release`. |

Two suspected mobile issues were rejected after reading its [acceptance document](../packages/cli/registry/stacks/mobile-expo/files/docs/acceptance/mobile-expo.md): excluding Clerk switches the auth suite to an anonymous-provider test, and excluding CI switches the CI suite to assert intentional absence.

## Validation performed and limits

From the repository root, at `767d69f`:

```sh
bun run dev validate --json
bun run dev validate --brief python-react --with postgres --sandbox --json
bun run dev validate --brief astro-blog --with bun-release --sandbox --json
bun run dev validate --brief typescript-cli --without effect --sandbox --json
bun run dev validate --brief mobile-expo --with rr --sandbox --json
```

All five exited 0. Whole-registry validation covered 10 stacks and 20 fragments with 0 errors, 0 warnings and 12 notes: eleven about changed or absent ledger proofs, one that `docker-deploy`'s Astro branch is reachable only through explicit `--with`. The Postgres preview reflected the fragment before `4203b84`.

Budget observations at that commit: `mobile-expo --with rr --sandbox` was 5,998 / 6,000 words and `astro-fullstack --with rr --sandbox` 5,997 / 6,000. Don't solve findings by appending prose to those briefs.

The [handoff](HANDOFF.md) already records stale proofs from the metadata revision. After the fixes below land, bench the affected compositions before calling them proven; a shared-fragment change affects every stack that includes it.

## Fix guide

This section is written for the coding agent that implements the findings. Do the tasks in order; each ends with what must be true before moving on. Every path is relative to the repo root unless it starts with a stack or fragment directory.

### Before you start

Read `AGENTS.md`, `.claude/rules/architecture.md`, `.claude/skills/stack-authoring/SKILL.md`, `.claude/skills/fragment-authoring/SKILL.md` and `.claude/skills/stack-authoring/search-card.md`, and `packages/cli/docs/authoring.md` (the entry format: frontmatter fields, `files/`, `adapters/`, `stacks:when` blocks, `.tmpl` variables).

Rules that apply to every task:

- Entries describe behavior; they never pin a dependency version or freeze a config format. Say what to check and where to look ("check the installed pytest-xdist"), not one release's API names.
- Makefile recipes in `.tmpl` files are indented with a real tab character. Check with `grep -nP '^ +[^ #]' <file>` that you introduced no space-indented recipe lines.
- After every task run, from the repo root, `bun run dev validate` (must report 0 errors and 0 warnings) and the `validate --brief` commands the task names. Every brief must stay inside its budget: 6,000 words, or 9,000 with an app. The JSON output's word counts are on stderr in human mode only, so read the `findings` array for `budget` findings.
- Changing a gate stack's brief (`astro-blog`, `go-cli`, `python-react`, both presets) changes its entry in `packages/cli/tests/fixtures/bundled-brief-digests.ts`. Regenerate each changed key as that file's header comment describes (sha256 of the `brief` string from `bun run dev validate --brief <stack> [--sandbox] --json`, UTF-8, no trailing newline), and add one sentence to the header comment: these digests changed on 2026-10-29 for the stack audit fixes and await a bench run.
- Don't edit `packages/cli/registry/runs.json`. New ledger notes about changed fingerprints are expected.
- Scoped tests, from `packages/cli`: `bun run test:unit tests/bundled-compositions.test.ts tests/bundled-registry.test.ts tests/compose.test.ts tests/registry-hooks.test.ts tests/registry-api-harness.test.ts`. Run them after each task. Don't run the full gate.

### Task 1: Postgres lock order, teardown and ports (finding 1)

File: `packages/cli/registry/fragments/postgres/FRAGMENT.md`.

1. In "Test harness" step 1, replace "Release the lock, then close every connection to the template (`CREATE DATABASE ... TEMPLATE` fails while anything is connected)." with wording that closes first: close every connection to the template (dispose the migration engine or pool) before releasing the lock, because `CREATE DATABASE ... TEMPLATE` fails while anything is connected and the next worker clones as soon as it gets the lock. Keep it one or two sentences.
2. Make verify's teardown stop only the development database. In the Makefile targets paragraph, change `db-down` from `docker compose stop` to stopping the `db` service only (`docker compose stop db`), and say why in a clause: `db-test` may be serving another run's tests, and its tmpfs data dies with it. Add one sentence saying `db-test` keeps running until `docker compose down`, which a person runs. Update the `db-down` entry under `commands:` to "Stop the development database". The teardown step itself (`make db-down`) stays.
3. In the `.env.example` paragraph, add one sentence: a second checkout of the same project (another worktree) sets its own `PORT_DB` and `PORT_DB_TEST` in `.env`, because the host ports are shared.
4. Run `bun run dev validate --brief python-react --with postgres --sandbox --json` and `bun run dev validate --brief python-react --with postgres --json`. Both must exit 0 with no `budget` finding. If either is over budget, shorten the "Test harness" prose without removing a rule, and say in the hand-off what you cut.

Done when: the lock sentence closes before it releases, `db-down` stops only `db`, and both briefs validate.

### Task 2: Go integration tests in vet, verify, `ci` and CI (finding 2)

Files: `packages/cli/registry/stacks/go-cli/files/Makefile.tmpl`, `packages/cli/registry/stacks/go-cli/STACK.md`.

1. `vet`: change the recipe to `go vet -tags integration ./...` so tagged files are vetted too. Update its `## ` help text and the `vet` line under `commands:` in STACK.md to say tagged integration tests are included.
2. `test-integration`: before the `go test` line, add a guard that fails when there are no integration tests, for example
   `@grep -rqs --include='*_test.go' '^func Test' tests/integration || { echo "test-integration: no tests under tests/integration"; exit 1; }`.
   Keep the existing `go test -tags integration ./tests/integration/...` line after it.
3. `ci`: add `test-integration` to the prerequisites, after `coverage`: `ci: fmt-check lint coverage test-integration vuln build`. Update the `ci` line under `commands:` in STACK.md to list it.
4. Verify list in STACK.md: add `- { name: test-integration, layer: test, run: make test-integration }` directly after the `test` step.
5. The CI paragraph inside `<!-- stacks:when with=ci-github -->` lists the CI steps. Add `make test-integration` after `make coverage`.
6. Run `bun run dev validate --brief go-cli --json` and `--sandbox --json`; regenerate the two `go-cli` digests.

Done when: verify, `make ci` and the CI paragraph all run the integration suite, vet covers tagged files, and an empty `tests/integration/` fails.

### Task 3: Narrow fragment applicability (finding 3)

Files: `packages/cli/registry/fragments/bun-release/FRAGMENT.md`, `packages/cli/registry/fragments/docker-deploy/FRAGMENT.md`, `packages/cli/registry/fragments/openrouter-ai/FRAGMENT.md`, their search cards under `packages/cli/registry/search/fragments/` if a card names the stacks, and a test.

1. `bun-release`: set `applies_to: [typescript-cli]`.
2. `docker-deploy`: set `applies_to` to the stack ids its body has a branch for. Find them with `grep -n 'stacks:when' packages/cli/registry/fragments/docker-deploy/FRAGMENT.md` plus the unconditional text that names a stack (the `python-react` parts). Expect `python-react`, `typescript-api` and `astro-fullstack`; use what the file actually says. `mobile-expo` must not be in the list.
3. `openrouter-ai`: replace `[typescript]` with the stack ids that list it under `fragments.default` or `fragments.optional` (`grep -n openrouter-ai packages/cli/registry/stacks/*/STACK.md`), plus every stack an app fragment that `requires: [openrouter-ai]` applies to (`grep -ln 'openrouter-ai' packages/cli/registry/fragments/*/FRAGMENT.md`, then read those apps' `applies_to`, resolving tags to the stacks carrying them). `astro-blog` must not be in the list. If a stack you remove lists the fragment as default or optional, stop: that's a contradiction to report, not to resolve.
4. Check nothing else broke: `bun run dev validate` must report no `optional-fits` or `compose` finding. A stack that lists one of these fragments as optional must still fit it.
5. Add a test to `packages/cli/tests/bundled-compositions.test.ts`, following that file's existing patterns for running the CLI against the bundled registry: for each pair (`astro-blog`, `bun-release`), (`react-router`, `bun-release`), (`mobile-expo`, `docker-deploy`), (`astro-blog`, `openrouter-ai`), `validate --brief <stack> --with <fragment> --json` reports a `with_not_applicable` warning for that fragment. Add one `add` case (an `astro-blog` project, `add bun-release`) asserting the `applies_to` conflict; `packages/cli/tests/add.test.ts` around the existing `reason: "applies_to"` assertion shows how. Run the new tests against the old `applies_to` values first and confirm they fail, then restore the fix.
6. Search cards: open `packages/cli/registry/search/fragments/bun-release.json`, `docker-deploy.json` and `openrouter-ai.json`. If a card's text claims the fragment works with stacks it no longer applies to, correct it per `search-card.md`. Otherwise leave it.

Don't change `selectWith` or make `--with` of a fragment that doesn't fit an error; that's an open CLI decision.

Done when: the four pairs warn, `add` refuses, and validate is clean.

### Task 4: Run the local builds under sandbox (finding 4)

Files: `packages/cli/registry/stacks/astro-blog/STACK.md`, `packages/cli/registry/stacks/python-react/STACK.md`.

1. In each, remove `, tags: [prod]` from the `build` verify step, leaving `- { name: build, layer: build, run: make build }`.
2. Search each body for text that says the build is skipped in a sandbox or runs only in production (`grep -n -i 'prod\|sandbox' <file>`) and correct it. Don't touch `tauri-react`, `docker-deploy` or `goreleaser`.
3. Add an assertion to `packages/cli/tests/bundled-compositions.test.ts`: composing `astro-blog` and `python-react` with the sandbox preset yields a `build` step with `skipByDefault: false`. Use the composition the file already builds for its preset loop if there is one. Confirm it fails before step 1.
4. Regenerate the `astro-blog` and `python-react` digests for both presets.

Done when: neither stack's sandbox manifest skips its build, and `tauri-react`'s build is still tagged `prod`.

### Task 5: Browser smoke in verify for both web stacks (finding 5)

Files: `packages/cli/registry/stacks/react-router/STACK.md`, `packages/cli/registry/stacks/python-react/STACK.md`, `packages/cli/registry/stacks/react-router/adapters/claude/.claude/rules/app/verification.md` (or its replacement from task 7).

1. `react-router`: add `- { name: e2e, layer: test, run: bun run e2e }` directly after the `build` step. The `e2e` script builds again and serves the production build on its own test port, so it doesn't collide with the `web` serve step's `PORT_WEB`. Leave the double build; the hand-off should mention it.
2. `python-react`: add `- { name: e2e, layer: test, run: make e2e }` directly after the `build` step. Replace "`make e2e`, not verify" in the Testing section with a sentence saying verify runs the Playwright smoke. In the Playwright line, keep `webServer` starting `make dev-api` and `make dev-web`; add a clause that it must stop both when the run ends, because verify's `api` and `web` serve steps start the same ports afterwards.
3. Update the react-router `verification.md` rule (or the guide it becomes in task 7) so it lists e2e among the steps verify runs.
4. Run `validate --brief` for both stacks in both presets; regenerate the `python-react` digests.

Done when: both verify lists run the browser smoke and neither recipe says otherwise.

### Task 6: Tauri library cross-check (finding 6)

Files: `packages/cli/registry/stacks/tauri-react/files/Makefile.tmpl`, `packages/cli/registry/stacks/tauri-react/STACK.md`.

1. In STACK.md setup step 2 (the `rust-toolchain.toml` sentence), add that the toolchain file lists the targets `x86_64-unknown-linux-gnu`, `aarch64-apple-darwin` and `x86_64-pc-windows-msvc` so `make install` fetches them.
2. Add a Makefile target after `typecheck-rust`:
   ```make
   check-targets: ## cargo check the library crates for every promised platform
   	for t in x86_64-unknown-linux-gnu aarch64-apple-darwin x86_64-pc-windows-msvc; do \
   		cargo check --workspace --exclude $(APP_CRATE) --target $$t || exit 1; \
   	done
   ```
   Add `check-targets` to `.PHONY` and to the `check` prerequisites, and update the comment block at the top of the Makefile that lists what verify and CI call.
3. STACK.md: add `check-targets` under `commands:` ("cargo check the library crates for Linux, macOS and Windows"), add a verify step `- { name: check-targets, layer: typecheck, run: make check-targets }` after the typecheck step, and add `check-targets` to the Rust CI job's list in the CI paragraph.
4. Resolve the C-library tension in the Rust guidance sentence that says "Prefer crates with bundled C libraries": add that a crate whose build script compiles C needs that target's C toolchain for `check-targets`, so adding one means either installing the cross toolchain or moving that target's check to a CI runner on that OS, recorded in AGENTS.md.
5. Run `validate --brief tauri-react` in both presets.

Done when: `make check`, verify and CI run `check-targets`, and the C-library caveat is stated.

### Task 7: Portable guidance for React Router and Tauri (finding 8)

Copy the `typescript-api` pattern. Read `packages/cli/registry/stacks/typescript-api/files/docs/guidance/typescript-api/index.md`, one of its guides, and `packages/cli/registry/stacks/typescript-api/adapters/claude/.claude/rules/src/effect-api.md` first.

1. React Router: move the body of each file in `packages/cli/registry/stacks/react-router/adapters/claude/.claude/rules/app/` (`effect-server.md`, `routes.md`, `testing.md`, `typescript.md`, `verification.md`) to `packages/cli/registry/stacks/react-router/files/docs/guidance/react-router/<same name>`, without the `paths:` frontmatter. Use `git mv` and then edit, so history follows. Recreate each Claude rule as its original `paths:` frontmatter plus a one-line pointer in the same form as typescript-api's `effect-api.md`, with a correct relative link (count the directory levels from the rule file to the project root).
2. Write `files/docs/guidance/react-router/index.md`: one line per guide saying when to read it, modeled on typescript-api's index.
3. Tauri: the same for `frontend.md`, `ipc.md` and `rust.md.tmpl` into `packages/cli/registry/stacks/tauri-react/files/docs/guidance/tauri-react/`. `rust.md.tmpl` stays a `.tmpl` because it uses template variables; keep the extension when you move it.
4. In each STACK.md, add one sentence where the recipe introduces its conventions, pointing at `docs/guidance/<stack>/index.md` and telling the agent to link it from AGENTS.md. Check whether the stack's README or AGENTS template already lists docs and add the index there instead if so. Count the words you add; the brief must stay in budget.
5. Fix the frozen claims in the moved React Router `typescript.md`: replace "This is TypeScript 7" and the fixed `ES2023` library setting with conditional wording that depends on the installed compiler and the generated `tsconfig`, following `packages/cli/registry/stacks/typescript-cli/files/docs/guidance/typescript-cli/typescript.md.tmpl`.
6. Keep Claude-only mechanisms (hooks, write-time guards) described as Claude-only; move knowledge, not hook wiring.
7. Run `bun run dev validate` (the shipped-references check confirms each link resolves) and `validate --brief` for both stacks. `packages/cli/tests/registry-hooks.test.ts` must still pass.

Done when: no React Router or Tauri Claude rule holds more than its frontmatter and a pointer, every agent gets the guides, and the TypeScript guide has no fixed compiler version.

### Task 8: Extract the dev-log scripts into a fragment (finding 7)

Do this last; it is the only task that adds an entry. Follow `.claude/skills/fragment-authoring/SKILL.md` for naming, description and search card.

1. Create `packages/cli/registry/fragments/dev-logs/FRAGMENT.md`: `schema_version: 1`, `id: dev-logs`, `kind: fragment`, `category: tooling` (not dropped by `--sandbox`), `applies_to: [typescript-api, astro-fullstack]`, `tools: [bun]` only if the scripts need it (read their shebang and the stacks' `logs` command). Declare no verify steps and no commands: the stacks keep the `logs` command they already declare.
2. `git mv packages/cli/registry/stacks/typescript-api/files/scripts/logs.ts packages/cli/registry/fragments/dev-logs/files/scripts/logs.ts`, the same for `dev-logs.ts`, and delete the two copies under `stacks/astro-fullstack/files/scripts/`. Run `cmp` on the pairs first and stop if they are no longer identical.
3. Add `dev-logs` to `fragments.required` in both stacks' STACK.md.
4. Body: move the stacks' sentences that describe the log files' behavior (session records, levels, the `logs` query flags) out of each STACK.md and into the fragment body, so the composed brief does not grow. Keep stack-specific sentences (which log files their servers write, the `jq` debugging queries) in the stacks.
5. Measure before and after: run `bun run dev validate --brief astro-fullstack --with rr --sandbox --json`, `bun run dev validate --brief astro-fullstack --json` and `bun run dev validate --brief typescript-api --json` before you start this task and again at the end. If any brief grows past its budget, cut duplicated prose until it fits. If it can't fit without dropping a rule, revert this task entirely and report it as blocked with the numbers.
6. Write the search card `packages/cli/registry/search/fragments/dev-logs.json` per `search-card.md`.
7. Leave every test file, `dev-pid.ts`, `dev.ts`, `dev-bg.ts`, the guards and the Codex wiring in the stacks. `packages/cli/tests/registry-api-harness.test.ts` runs the stacks' shipped tests and must pass, which proves the moved scripts still compose to the same paths.

Done when: the two scripts exist once, both stacks compose them at `scripts/logs.ts` and `scripts/dev-logs.ts`, every brief is within budget, and the harness tests pass.

### Finishing

1. Run `bun run lint` and `bun run typecheck` at the repo root.
2. Run the scoped tests listed under "Before you start".
3. Report, per task: files changed, the `validate --brief` word counts before and after for every brief you touched, and the digests you regenerated.
4. Don't update this file's Status line, `plans/HANDOFF.md` or `runs.json`; the orchestrator does that after review.
