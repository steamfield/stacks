# Plan: index-first registry and registry-scoped tests

Skill: deliver. Profile: deliver. On resume, re-read shared/lane-dag.md before anything else.
plan_graph: /Users/riley/.claude/plugins/cache/claude-essentials/ce/6.0.6/shared/scripts/plan_graph.py
Started: 2026-11-26. Timebox: none. Landing branch: deliver/index-first-registry (worktree `.claude/worktrees/deliver-index-first`), cut from `feat/ios-stacks` at bc7733ba because phase 5 needs the iOS stacks, which aren't on `main` yet.
Gate: `rr check` (~30s, clone is opted in to rr). Filtered tests: `bun run test:unit tests/<file>.test.ts` in `packages/cli` (local; a single file is allowed outside rr). Typecheck: `bun run typecheck` (repo root).
Runner: `rr` for every whole-suite run (`rr check`, `rr test-cli`); scoped files, lint and typecheck run locally.
Worktree setup: `bun install --frozen-lockfile`.
Suppressions: biome-ignore, @ts-expect-error, test.skip, it.skip, describe.skip, .only
Manifests: package.json, bun.lock

Repo overrides of the deliver defaults (`.claude/rules/agent-ops.md`, `.claude/delegate.md`): implementation lanes go to Codex through the `foreman` skill with `.claude/delegate/contract.md` as the contract template (sol, high effort). Codex runs the one `code-reviewer` pass on its own lane, so there is no separate Claude lane review; I still run `check-lane`, the brief check and the shape check before merging. Shared contracts in `packages/format/src` and `src/errors.ts`, and all harness edits (`.claude/`, CI workflows, `.rr.yaml`, lefthook, `tsconfig*.json`, `biome.json`), are mine, in scaffolds or inline. The phase 1 boundary review and the final review run as the profile says. Lanes run no gate (the command guard denies whole-suite runs to `CODEX_DELEGATE=1`). Each phase's tests come from Codex test-author runs (`.claude/delegate/contract-tests.md`, one per lane, per `.claude/rules/cli/testing.md` "Process and gate"), reviewed by me and committed in the scaffold. The foreman runs are named `idx-t<phase><lane>` for test authors and `idx-<phase><lane>` for implementers, with contracts under the session scratchpad's `contracts/`.

## Context

A new or edited stack reaches users only through an npm release of the CLI, followed by a `stacks-api` deploy and a Worker rebuild. Right now that means 0.15.0 is on npm (2026-11-25) while production serves an index from 2026-11-16, and `/stacks/phaser-game/` returns 404. Users on 0.14 never get the game stacks at all. On top of that, a content-only change has to touch CLI test fixtures (`tests/fixtures/search/golden.json`, `bundled-brief-digests.ts`, `tsconfig.registry.json`, literal assertions in about 15 tests) and run the whole CLI suite.

The fix comes in two parts. The first executes the reviewed remote-first index RFC (`plans/remote-first-index-rfc-2026-11-15.md`), refreshed against v0.15.0, so that released CLIs read the signed hosted index and content ships by deploy. The second separates the tests that check registry content from the tests that check CLI behavior, so a content PR runs only the content checks. The registry repo split (`plans/registry-repo-rfc-2026-11-15.md`) is deferred until there's an outside contributor to serve.

## Spec

Released CLIs from 0.16.0 read the signed index at `stacks.steamfield.io`. `new` and `add` revalidate it before reading the registry, record the index commit they used in `.stacks/sources.json`, and say in their report when they fell back to a cached index or the bundled one. Separately, registry content checks run as their own Vitest project, and CI skips the CLI behavior suite when a change touches only `packages/cli/registry/**`.

In scope (RFC decisions kept, with v0.15.0 corrections):
- D-R1 keys: two Ed25519 keys (`stacks-index-2026a` for releases, `stacks-index-2026b` as an offline backup) in `packages/format/src/index-keys.ts::INDEX_PUBLIC_KEYS`. The maintainer supplies the public PEMs only.
- D-R2 `packages/cli/registry/registry.json` `{ formatVersion: 1, minCli }`, shipped at `0.15.0` (today's `VERSION`) and raised to `0.16.0` by the release bump. `build:index` copies `minCli` into the index header and fails when the file is missing or its `minCli` exceeds `VERSION`. A `validate` check covers roots that hold `allowlist.json`. CI gets a `registry-min-cli` job.
- D-R3: `new` and `add` call `RemoteIndex.refresh` before the first registry read. For `new` that means before `commands/new.ts::resolveArguments`, since the picker reads `Registry.all`. Refresh sends `If-None-Match`, uses a 3,000 ms deadline and ignores backoff. Read commands keep the 24-hour cache.
- D-R4: an `index_fallback` warning `{ code, id: "index", reason, cachedAt? }` goes in the `new` and `add` results and their stdout reports, but only when an index root is configured. Source builds and tests with no `STACKS_INDEX_URL` have no index root (`service.ts::unconfiguredIndex`), so they emit no warning and record `index: null`. `verifyIndex` maps every failed signature check to the new `signature` outcome, whether the key is unknown or the signature is bad. Decode failures stay `invalid`. `signatureValid` keeps its boolean result, so `core/allowlist.ts` is untouched.
- Refresh and the registry's later reads: `RemoteIndex` memoizes the refresh outcome for the invocation. After a refresh, `current` serves what refresh left (the fresh body, the revalidated body, or the cached body after a failure) and makes no second request. A failed refresh records `lastAttempt` and `lastOutcome` but no backoff. The worst case added to `new` is 3 s for refresh plus 3 s for the `all` budget.
- D-R5: `.stacks/sources.json` `{ formatVersion: 1, index: { commit, generatedAt, fetchedAt } | null, entries: [{ kind, id, origin, digest, part? }] }`. `part` is new since the RFC and names a workspace part's mount.
- D-R6: `doctor` reports the index `commit`, `generatedAt`, `minCli` and `etag` through `RemoteStatus`.
- D-R7: search's `next` hints `stacks update` only when a cached index lacks the id or the last outcome was `unsupported`.
- D-R8: the official index URL is set only in published builds, through `build.ts::CLI_BUILD.officialIndexUrl`, gated on the renamed `STACKS_PUBLISHED_BUILD` (env `STACKS_PUBLISH=1`). It's built from `HOSTED_API_URL`.
- D-R9: `remote/merge.ts::remoteRegistry.all` resolves with concurrency 8. Each entry that has a bundled copy races its cached resolution against one 3,000 ms deadline shared across the invocation's `all` calls, and that deadline covers fragment and part pins. If the deadline wins, that `all` result uses the bundled copy. The download keeps going in the invocation's scope, so a later `get` for the same id (from `compose/selection.ts` during `new`) gets the index copy, and `sources.json` records the origin each entry actually resolved to. Index-only entries have no bundled fallback, so they always download (still at concurrency 8). Their number is bounded by how many entries were added since the CLI was released. No metadata-only entry type is added.
- New since the RFC: the allowlist (`core/allowlist.ts::Allowlist.layer`) follows the index origin and is enabled only when `AppConfig.remoteIndexUrl` is defined. Otherwise `bun run dev`, `prove` and `bench` would fetch the production allowlist once keys ship, because `apiUrlFor` returns `HOSTED_API_URL` for every build.
- Test split: one Vitest config with two projects. `behavior` covers everything in `tests/` except `tests/registry/`, and `registry` covers `tests/registry/**`. Shared helpers default to fixture registries. Tests that check real content move under `tests/registry/`. Tests that hard-code bundled ids or counts derive them from the registry instead. `tsconfig.registry.json` stops listing stacks by hand. A `changes` job in CI skips `cli-tests` when only `packages/cli/registry/**` changed, and `ci-ok` treats a skipped job as passing. A `bun run digests` script regenerates the brief digests.
- Production proof gate restored (user decision, 2026-11-26): the first deploy that 0.16 CLIs read drops `--include-unproven` in `stacks-api`. As a result, content ships by deploy only once it's proven. `scripts/index/proof.ts::publicationEntries` publishes an entry only when its current digest has a ledger proof, and otherwise keeps the previous entry. A content PR therefore reaches users after its bench run lands in `runs.json`. flutter, ios-objc, ios-swiftui, ios-uikit and react-native have no ledger run today, so they stay out of the index until they're benched.

- The five unbenched stacks (flutter, ios-objc, ios-swiftui, ios-uikit, react-native) are brought up to a full dev setup before they're benched (user request, 2026-11-26). The bar:
  - a formatter and a strict linter, both enforced by verify steps;
  - the strictest type and compiler settings the language offers;
  - the current standard test framework for the language, with unit tests plus UI/integration and end-to-end layers wherever the platform has them;
  - coverage reported by a command and held to a floor recorded in the project's config (default 80% of lines in unit-tested code; the user can change it);
  - generated CI that runs the verify steps on a runner able to run them (macOS for Apple builds);
  - git hooks, agent config, and the config, error and logging patterns the stacks already ship.

  The same bar goes into `.claude/skills/stack-authoring/` as a checklist, so new stacks are held to it.

Out of scope: the registry repository split (G1 to G3, G2a to G2f); signing in CI (phase 5.2); `create --from index` and `create`'s picker (they still use `defaultRoots`); `verify` warning about newer index content; a scheduled canary; any edit to `stacks-api` code from this repo.

Assumptions: the release is 0.16.0. `minCli` starts at 0.16.0. Both the brief digests and the golden set stay as content checks (now under the `registry` project) rather than being deleted.

Error model:
- Index refresh never fails a command. When an index root is configured, every failure (timeout, network, not_found, invalid, signature, unsupported, offline) becomes `index_fallback` with that reason, and the command continues on the cached index or the bundled one. With no index root configured there's no warning. Exit codes don't change. The warning goes on stdout in the report; agent-mode stderr stays empty.
- `build:index` exits non-zero with a message naming the file when `registry.json` is missing, malformed, or has a `minCli` above `VERSION`.
- `validate` on an official root (one that holds `allowlist.json`) emits an error finding (exit 2) for the same three cases. User roots get no finding.
- An unreadable, malformed or newer `.stacks/sources.json` during `add` gets replaced, never reported as an error. A project without the file is valid everywhere.
- Interruption during `new` rolls back `sources.json` along with the other written files (`project/writer.ts::openProject`).
- No new error tags.

## Contracts (scaffold commits)

Phase 1 scaffold (mine):
- `core/cached-fetch.ts`: export `Revalidation = { source: "fresh" | "revalidated" | "cached" | "none"; reason?: CacheFailure | "offline"; cachedAt?: string }`; `CachedResource` gains `revalidate(options: { deadline: Duration.Duration; ignoreBackoff: boolean }): Effect<Revalidation>` (stub). `CacheFailure` gains `"signature"`.
- `core/registry/remote/service.ts`: `RemoteIndex` gains `refresh: Effect<Revalidation>` (stub).
- `core/registry/remote/verification.ts`: `RemoteOutcome` gains `"signature"`; `cliMeetsMinimum` is exported (lane b imports it).
- `constants.ts`: `INDEX_REFRESH_DEADLINE_MS = 3_000`.
- Root `scripts/release.ts`: `--min-cli`, with its test in `tests/scripts/release.test.ts`.
- `schemas/remote-index.ts`: `RemoteStatus.lastOutcome` gains `"signature"`; optional keys `commit`, `generatedAt`, `minCli`, `etag` (`Schema.optionalKey`).
- `schemas/registry-meta.ts` (new): `RegistryMeta = { formatVersion: 1, minCli: string }`, strict decode.
- `core/validate/checks/registry-meta.ts` (new): `registryMetaChecks: Check`, registered in `core/validate/index.ts`.
- `.github/workflows/ci.yml`: the `registry-min-cli` job (D-R2), mine.
- Phase 1 tests (below), written by me and read before commit.

Layout added across the run:

    packages/cli/
      registry/registry.json            registry-level metadata: formatVersion, minCli
      src/schemas/registry-meta.ts      RegistryMeta schema; decode only
      src/schemas/sources.ts            ProjectSources schema for .stacks/sources.json
      src/core/registry/meta.ts         reads registry.json and identifies official roots
      src/core/search/hint.ts           decides when cached index state warrants an update hint
      src/core/validate/checks/registry-meta.ts   validate finding for registry.json
      src/core/project/sources.ts       builds and writes .stacks/sources.json; the only writer of it
      scripts/brief-digests.ts          regenerates tests/registry/fixtures/bundled-brief-digests.ts
      tests/registry/                   content checks (the `registry` Vitest project)
      tests/fixtures/registry-search/   small fixture registry with search cards and vocabulary

## Phases

### Phase 1: the index revalidates and reports itself (MVP)

Scaffold: 3a0594df
Tag: idx-phase-1

Demo: with a local server as `STACKS_INDEX_URL` (untrusted, so no signature check), `bun run dev doctor --json` shows `commit`, `generatedAt`, `minCli` and `etag`. The signature outcome is shown by `remote-index-refresh.test.ts`, which sets the official URL and a test key through `tests/helpers/remote-index.ts::remoteCli`. `bun run dev list --json` against an index where every entry is drifted finishes inside the budget. `bun run build:index --unsigned --out /tmp/x --previous none` fails without `registry.json`.

Test cases:
- revalidate with a stored ETag and body sends `If-None-Match`; a 304 refreshes `cachedAt`, keeps the body, and returns `revalidated`.
- A stored ETag with a missing or undecodable body sends no `If-None-Match`; a 200 returns `fresh`. A 304 to a request that carried no `If-None-Match` is a `network` failure, with no second request.
- A 200 replaces the body and stores the new ETag; returns `fresh`.
- revalidate ignores a backoff a read recorded when `ignoreBackoff` is true; `current()` still honors it.
- revalidate timeout with a cache returns `cached` with reason `timeout` and `cachedAt`; with no cache returns `none` with reason `timeout`.
- Offline returns `none` or `cached` with reason `offline` and makes zero requests.
- A state file written before this change (no `etag`) decodes.
- A bad signature and an unknown keyId are outcome `signature`; bad JSON stays `invalid`. Existing `remote-index.test.ts` "a bad %s" cases update accordingly.
- After a refresh that timed out, failed on the network, or got a 304, a later `Registry` read in the same invocation makes no second index request (one test per case).
- A failed refresh records `lastOutcome` without setting a backoff.
- An index signed with the second shipped key verifies.
- `doctor --json` decodes with `RemoteStatus` and carries commit, generatedAt, minCli and etag after a fetch.
- `build:index` fails when `registry.json` is missing, malformed, or `minCli > VERSION`; it writes `minCli` from the file into the index header.
- `validate` on a root with `allowlist.json` and no `registry.json` gives an error finding; on a user root without either, none.
- `list` against an index whose every entry differs from bundled makes at most 8 concurrent bundle requests and returns within 3,000 ms plus slack (TestClock), with unresolved entries as bundled copies.
- After the deadline lapses in `all`, a `get` for a lapsed id returns the index copy once its download finishes.
- An index-only entry is listed after its download, even past the deadline.
- A workspace's part pins count against the same budget.
- `list` within 24 hours of a fetch makes no index request.
- search `next` keeps `show`/`new` for an API hit with no cached index; gives `stacks update` when a cached index lacks the id or the last outcome is `unsupported`.

| Lane | Size | Owns files | Reads | Tests | Model | Status | Branch | Done when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a | M | packages/cli/src/core/cached-fetch.ts, packages/cli/src/core/registry/remote/service.ts, packages/cli/src/core/registry/remote/verification.ts, packages/cli/src/schemas/remote-index.ts, packages/cli/src/core/doctor.ts, packages/cli/tests/remote-index.test.ts, packages/cli/tests/cached-fetch.test.ts, packages/cli/tests/cached-fetch-persistence.test.ts | contracts, packages/cli/tests/helpers/remote-index.ts | packages/cli/tests/remote-index-refresh.test.ts, packages/cli/tests/doctor-index.test.ts | opus | merged | foreman/idx-1a | refresh and doctor tests pass; typecheck clean |
| b | M | packages/cli/registry/registry.json, packages/cli/scripts/build-index.ts, packages/cli/src/core/validate/checks/registry-meta.ts, packages/cli/tests/registry-meta-regressions.test.ts | contracts, packages/cli/src/core/validate/checks/deps.ts | packages/cli/tests/registry-meta.test.ts, packages/cli/tests/build-index-min-cli.test.ts | sonnet | merged | foreman/idx-1b | registry-meta and build-index tests pass; `build-index*.test.ts` still pass |
| c | M | packages/cli/src/core/registry/remote/merge.ts, packages/cli/src/core/search/report.ts, packages/cli/src/core/search/run.ts, packages/cli/src/commands/search.ts, packages/cli/src/core/registry/registry.ts, packages/cli/src/commands/add.ts, packages/cli/tests/remote-index-scope.test.ts | contracts | packages/cli/tests/remote-index-bounded.test.ts, packages/cli/tests/search-hint-index.test.ts | opus | merged | foreman/idx-1c | bounded and hint tests pass; `remote-index.test.ts`, `workspace-index.test.ts`, `search-api-index.test.ts` still pass |

#### Lane a brief

- Goal: make the cached index revalidate on demand, report signature failures distinctly, and expose index header facts to `doctor`.
- Interface: implement `CachedResource.revalidate` and `Revalidation` in `core/cached-fetch.ts`; `RemoteIndex.refresh` in `core/registry/remote/service.ts` (calls revalidate with `{ deadline: INDEX_REFRESH_DEADLINE_MS, ignoreBackoff: true }`, memoized per invocation, and after it `current` makes no request; with no index root it returns `{ source: "none" }` and no reason); `RemoteOutcome` `"signature"` in `verification.ts::verifyIndex`; `RemoteStatus` optional fields filled from the verified `RegistryIndex` (`commit`, `generatedAt`, `minCli`) and the stored ETag; `core/doctor.ts::remoteIndexStatus` passes them through.
- Behavior: `State` gains `etag` via `Schema.optionalKey`. `requestText` sends `If-None-Match` only when both an ETag and a body are stored. 304 means success: rewrite state's `cachedAt`/`lastOutcome: ok`, not the body. The deadline becomes a parameter of `withinDeadline` (default stays `CACHED_FETCH_DEADLINE_MS`); refresh uses `INDEX_REFRESH_DEADLINE_MS`, which the scaffold adds to `constants.ts`. `signatureValid` returning false (unknown key or bad signature) → `signature`; decode failure → `invalid`. Don't change `signatureValid`'s signature. Offline → no request, reason `offline`.
- Decisions already made: no `--refresh` flag; read commands unchanged.
- Out of scope: wiring into `new`/`add` (phase 2), bounded `all` (lane c).
- Done when: the two scaffold test files pass, owned existing tests updated for `signature`, `bun run typecheck` and `bun run lint` clean.

#### Lane b brief

- Goal: the registry declares the oldest CLI that can read it, and both `build:index` and `validate` enforce it.
- Interface: `schemas/registry-meta.ts::RegistryMeta` (scaffold); `core/validate/checks/registry-meta.ts::registryMetaChecks`; `scripts/build-index.ts` reads `<registry>/registry.json` with that schema.
- Behavior: `registry.json` ships as `{ "formatVersion": 1, "minCli": "0.15.0" }`, equal to today's `VERSION`, so `build:index` and `bundled-registry.test.ts`'s zero-findings check keep passing; `bun run release 0.16.0 --min-cli` raises it at release (scaffold). Tests write their own registry fixtures. Version comparison reuses `verification.ts::cliMeetsMinimum` (import, don't copy). The validate check runs only on a root that holds `allowlist.json` (the same marker as `checks/deps.ts::readAllowlist`) and reports missing, malformed, and minCli above the running `VERSION` as error findings with the file path.
- Decisions already made: index-level minCli only; no per-entry field.
- Out of scope: the CI job (scaffold), raising minCli later.
- Done when: both scaffold test files pass; existing `build-index*.test.ts` pass (adjust none; if one fails because its fixture registry lacks `registry.json`, report it rather than editing it).

Scaffold note: root `scripts/release.ts` gains `--min-cli`, which sets `registry.json`'s `minCli` to the version being released, with its test in `tests/scripts/release.test.ts` in the same commit (mine; a release-script change needs a test).

#### Lane c brief

- Goal: `list` and every `Registry.all` reader stay inside a fixed time on any drift between the index and the bundled registry, and search stops suggesting entries the CLI can't open.
- Interface: `remote/merge.ts::remoteRegistry.all`; `core/search/report.ts::next`; reads `RemoteIndex.cached` and `RemoteIndex.status`.
- Behavior: resolve index entries with `concurrency: 8`. One 3,000 ms deadline (`INDEX_REFRESH_DEADLINE_MS`, from the scaffold) starts at the first `all` call and is shared by every `all` call in the invocation; pins (fragments and parts) count against it. An entry with a bundled copy races its existing `Effect.cached` resolution against the deadline: losing returns the bundled copy for that `all` result only, and the resolution keeps running in the remote registry's scope so a later `get` awaits the index copy. Never cache the fallback. Index-only entries are awaited without the race. No new entry type. Each bundle request keeps its own `CACHED_FETCH_DEADLINE_MS` (1,500 ms) deadline, so the shared deadline bounds cumulative time across queued downloads, not one slow request. `next`: keep `show`/`new` unless a cached index exists and lacks the hit's id, or `status.lastOutcome === "unsupported"`; then the hint is `stacks update`.
- Out of scope: refresh, picker changes.
- Done when: the two scaffold test files pass, plus the existing remote, workspace-index and search-api-index tests.

### Phase 2: new and add use a fresh index and record it

Demo: `bun run dev new typescript-cli /tmp/p --no-launch --json` with `STACKS_INDEX_URL` pointed at a local 304 server makes one index request and writes `.stacks/sources.json` with the index commit. With the server down, the report says `Index unreachable (timeout); used the cached index from …` on stdout, and the exit code is 0.
Depends on: phase 1

Scaffold: 8857bd21
Tag: idx-phase-2

Scaffold (mine): `schemas/new.ts` adds `index_fallback` to the closed `warnings.code` literals plus `reason` and `cachedAt` as `Schema.optionalKey`; `schemas/add.ts` adds the same optional keys to its strict warning; `schemas/sources.ts::ProjectSources`; `core/project/provenance.ts` holds `IndexHeader`, `IndexProvenance` (`{ revalidation: Revalidation; index: IndexHeader | undefined }`), `NO_INDEX_PROVENANCE` and the stubs `readIndexProvenance` and `indexFallbackWarning`; `core/project/sources.ts` holds the stub `projectSources`; `NewOptions.provenance` and `AddOptions.provenance` are required, and the commands pass `NO_INDEX_PROVENANCE` until lane a wires the refresh; the MCP mirror in `packages/mcp/src/schemas/cli.ts`.

Split between the lanes: lane a owns the refresh and the warning (who reads the index, what the report says), lane b owns `sources.json` and the brief line (what the project records). Lane b's tests call `scaffold` and `add` directly with hand-built `IndexProvenance` values, or go through `runCli` with no index configured, so they don't need lane a. Lane a's tests go through `runCli` against a local index server and assert requests, warnings, streams and exit codes, never `sources.json`. The tests needing both (the recorded commit after a real refresh, `origin: "index"` after a lapsed deadline) are written by lane a's test author in `tests/new-index-sources.test.ts`, which neither lane has to pass; it goes green at phase landing.

Test cases (from RFC acceptance, refreshed): a cached index under 24h plus a 200 with a newer index means `new` uses the newer content and records its commit. A 304 means exactly one request, and the cached commit gets recorded even when every entry resolved to its bundled copy. A timeout uses the cache, reports the age, and exits 0. No cache means bundled, reported, with `index: null`. `new` after a `list` backoff still makes its request. `--offline` makes zero requests with reason `offline`. A bad signature falls back with reason `signature`. An index-only entry resolves for `show`, `new` and `add`. `add` on a 0.15 project with no `sources.json` writes it. `add` with a malformed `sources.json` replaces it. An interrupted `new` leaves no `sources.json`. A workspace `new` records its part stacks with `part`. Agent-mode stderr is empty on a fallback. Picker runs refresh before the catalog read. With no index configured, `new` emits no `index_fallback` and records `index: null`. When the `all` deadline lapses during `new`, the chosen stack is still composed from the index copy and `sources.json` records `origin: "index"` for it.

| Lane | Size | Owns files | Reads | Tests | Model | Status | Branch | Done when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a | M | packages/cli/src/core/project/provenance.ts, packages/cli/src/commands/new.ts, packages/cli/src/commands/add.ts, packages/cli/src/core/scaffold/report.ts, packages/cli/src/core/add/report.ts | contracts, packages/cli/src/core/registry/remote/service.ts, packages/cli/tests/helpers/remote-index.ts | packages/cli/tests/new-index-refresh.test.ts, packages/cli/tests/add-index-refresh.test.ts | opus | merged | foreman/idx-2a | both test files pass; `new.test.ts`, `add.test.ts`, `remote-index.test.ts` still pass; typecheck and lint clean |
| b | M | packages/cli/src/core/project/sources.ts, packages/cli/src/project-layout.ts, packages/cli/src/core/scaffold/new.ts, packages/cli/src/core/add/index.ts, packages/cli/src/core/add/write.ts, packages/cli/src/core/brief/render.ts, packages/cli/src/core/brief/text.ts, packages/cli/tests/compose-files.test.ts, packages/cli/src/core/compose/compose.ts, packages/cli/src/core/compose/types.ts, packages/cli/src/core/project/writer.ts, packages/cli/tests/writer-rollback-acceptance.test.ts | contracts, packages/format/src/bundle.ts | packages/cli/tests/project-sources.test.ts | opus | merged | foreman/idx-2b | the test file passes; `new.test.ts`, `add.test.ts`, `brief.test.ts`, `workspace*.test.ts` pass except the brief digest and `written` assertions the phase landing regenerates (listed in the hand-off) |

#### Lane a brief

- Goal: `new` and `add` refresh the index once before their first registry read and report a fallback in the result.
- Interface: implement `core/project/provenance.ts::readIndexProvenance` (calls `RemoteIndex.refresh`, then reads `RemoteIndex.cached` for the header and `RemoteIndex.status` for `cachedAt` as `fetchedAt`; `index` is undefined when no verified index is in use) and `indexFallbackWarning` (undefined when `revalidation.source` is `fresh` or `revalidated`, or when there is no `reason`, which is the unconfigured case; otherwise `{ code: "index_fallback", id: "index", reason, cachedAt? }` with `cachedAt` only when `source` is `cached`). `commands/new.ts` calls `readIndexProvenance` before `resolveArguments` (the picker reads `Registry.all`) and passes the result as `provenance`; `commands/add.ts` calls it before `projectRegistry`. Each command appends the warning to `result.warnings` before rendering and output, so lane b's `scaffold` and `add` never build it.
- Behavior: the report line goes in the stdout report with the other warnings (`core/scaffold/report.ts`, `core/add/report.ts`), never stderr. Wording by reason: `timeout`, `network`, `not_found` give `Index unreachable (<reason>)`; `invalid` gives `Index invalid`; `signature` gives `Index signature failed`; `unsupported` gives `Index needs a newer stacks (run stacks update)`; `offline` gives `Offline`. Then `; used the cached index from <YYYY-MM-DD HH:MM> UTC (<age> old).` when a cache was used (age in whole minutes under an hour, hours under two days, days after; time from `Clock`, passed into the renderer as a value) or `; used the registry bundled with stacks <VERSION>.` otherwise. Same text in human and agent mode; `--json` carries only the warning object. Exit codes never change.
- Decisions already made: no `--refresh` flag; read commands keep the 24-hour cache; `create` is out of scope.
- Out of scope: `sources.json`, the brief, `scaffold`/`add` internals (lane b).
- Done when: see the table.

#### Lane b brief

- Goal: every `new` and `add` records what it composed and which index vouched for it in `.stacks/sources.json`, and the brief names that index.
- Interface: implement `core/project/sources.ts::projectSources` (entries sorted by kind, then id, then part; `index` is `provenance.index ?? null`); `project-layout.ts` adds `SOURCES_PATH` (`.stacks/sources.json`) to `projectFiles`, so `new`'s `written` and the brief's file list include it (committed like the manifest, not in `IGNORE`); `scaffold` writes it inside `openProject` before the manifest so rollback removes it; `add` reads an existing file leniently (missing, unreadable, malformed or a newer `formatVersion` is replaced, never an error) and writes it with `core/add/write.ts::writeOrReplace`, merging prior entries with the newly added ones (a re-added id takes the new row); entry rows carry the origin each entry actually resolved to (`Entry.origin` after composition) and `digest` from `@steamfield/stacks-format`'s `bundleDigest` over the entry's files; a workspace stack's part stacks get one row each with `part` set to the part name. The brief prints `Index <commit, first 7 chars>, generated <YYYY-MM-DD HH:MM> UTC.` under the stack heading when `provenance.index` is set, and nothing otherwise (fixed text in `core/brief/text.ts`). A dry run writes no `sources.json`.
- Decisions already made: CLI-only schema; no format package change; an older CLI's `add` leaving the file stale is accepted.
- Out of scope: refresh, warnings, the reports (lane a); regenerating the brief digests and MCP fixtures (phase landing).
- Done when: see the table.

(MCP fixtures (`packages/mcp/scripts/capture-fixtures.ts`), `core/result-schemas.ts`, `core/validate/compositions/budget.ts` and the regenerated brief digests are handled inline at phase landing, so neither lane owns them.)

### Phase 3: released CLIs read the index

Demo: `STACKS_PUBLISH=1 bun run build` then `node dist/stacks doctor --json` names `https://stacks.steamfield.io/v1/index.json` as the default URL. Against today's production (still signed with the laptop key) `new --json` reports `index_fallback` with reason `signature`, which shows the wiring works. The full path goes green after the `stacks-api` signing change (Release, step 3). `bun run dev list --json` makes no index or allowlist request.
Depends on: phase 2
Keys received 2026-11-27 (R1).

| Lane | Size | Owns files | Reads | Tests | Model | Status | Branch | Done when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a | M | packages/cli/src/build.ts, packages/cli/scripts/build.ts, packages/cli/src/constants.ts, packages/cli/src/core/allowlist.ts, packages/cli/tests/helpers/cli.ts | | | opus | pending | | |
| b | S | packages/cli/docs/architecture.md, packages/cli/docs/concepts.md, packages/cli/docs/reference/commands.md, packages/cli/docs/reference/configuration.md, packages/cli/CHANGELOG.md | | | sonnet | pending | | |

(Scaffold, mine: `packages/format/src/index-keys.ts` keys plus a format version bump (0.10.0) in its own commit, and the rename of `STACKS_PUBLISH_TELEMETRY`/`STACKS_PUBLISHED_TELEMETRY` to `STACKS_PUBLISH`/`STACKS_PUBLISHED_BUILD` across `release.yml`, `scripts/build.ts`, `src/build.ts`, the `constants.ts` comment and AGENTS.md; lane a adds the index URL gating on it. Root `AGENTS.md` telemetry paragraph and map updates happen inline at the end of the run.)

### Phase 4: registry content checks run on their own

Demo: add a throwaway stack under `packages/cli/registry/stacks/` in a QA checkout. `bunx vitest run --project behavior` passes with no edits to any test file. `bunx vitest run --project registry` fails, naming the missing search card and golden queries. `git diff --name-only origin/main` touching only `packages/cli/registry/**` makes the CI `changes` job skip `cli-tests` (checked with `act` or a dry-run script; otherwise on the PR).
Depends on: phase 2

| Lane | Size | Owns files | Reads | Tests | Model | Status | Branch | Done when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| b | L | packages/cli/tests/registry/, packages/cli/scripts/brief-digests.ts, packages/cli/tests/agent-harness.test.ts, packages/cli/tests/bundled-file-headers.test.ts, packages/cli/tests/bundled-registry.test.ts, packages/cli/tests/codex-api-harness.test.ts, packages/cli/tests/eval-checkpoint.test.ts, packages/cli/tests/eval-report.test.ts, packages/cli/tests/gate-findings.test.ts, packages/cli/tests/library-qa-acceptance.test.ts, packages/cli/tests/library-qa-guidance.test.ts, packages/cli/tests/library-qa-recipes.test.ts, packages/cli/tests/mobile-dev-ownership.test.ts, packages/cli/tests/mobile-dev-zombie.test.ts, packages/cli/tests/registry-api-harness.test.ts, packages/cli/tests/search-golden.test.ts, packages/cli/tests/search-golden-coverage.test.ts, packages/cli/tests/search-metadata-holdout.test.ts, packages/cli/tests/search-relevance.test.ts, packages/cli/tests/shipped-hooks-advisory.test.ts, packages/cli/tests/shipped-hooks-destructive.test.ts, packages/cli/tests/shipped-hooks-stack-guards.test.ts, packages/cli/tests/shipped-hooks-wrappers.test.ts, packages/cli/tests/helpers/shipped-hooks.ts, packages/cli/tests/fixtures/bundled-brief-digests.ts, packages/cli/tests/fixtures/search/, packages/cli/tests/fixtures/eval-dry-run-terra.txt, packages/cli/tests/boundaries.test.ts, packages/cli/tests/build-directory.test.ts, packages/cli/tests/bundled-compositions.test.ts, packages/cli/tests/dependency-reader-extra.test.ts, packages/cli/tests/native-adapters.test.ts, packages/cli/tests/plain-language-metadata.test.ts, packages/cli/tests/registry-meta.test.ts, packages/cli/tests/registry.test.ts, packages/cli/tests/search-metadata-regressions.test.ts, packages/cli/tests/search-metadata-validation.test.ts, packages/cli/tests/search-penalties.test.ts, packages/cli/tests/search.test.ts | | | opus | pending | foreman/idx-4b | |
| a | M | packages/cli/tests/helpers/search-metadata.ts, packages/cli/tests/helpers/search-command.ts, packages/cli/tests/helpers/search-api.ts, packages/cli/tests/helpers/search-fixture.ts, packages/cli/tests/fixtures/registry-search/, packages/cli/tests/search-api.test.ts, packages/cli/tests/search-api-ux.test.ts, packages/cli/tests/search-api-regressions.test.ts, packages/cli/tests/search-api-index.test.ts, packages/cli/tests/search-hint-index.test.ts, packages/cli/tests/search-edge.test.ts, packages/cli/tests/search-eval-command.test.ts, packages/cli/tests/search-metadata-copy.test.ts, packages/cli/tests/search-metadata-decorate.test.ts, packages/cli/tests/search-metadata-editorial.test.ts, packages/cli/tests/search-privacy.test.ts, packages/cli/tests/search-ranking.test.ts | | | opus | pending | | |
| c | M | packages/cli/tests/helpers/native-adapters.ts, packages/cli/tests/helpers/create.ts, packages/cli/tests/fixtures/registry-adapters/, packages/cli/tests/add.test.ts, packages/cli/tests/brief.test.ts, packages/cli/tests/create.test.ts, packages/cli/tests/library-qa-recovery.test.ts, packages/cli/tests/native-adapter-input.test.ts, packages/cli/tests/native-adapter-lifecycle.test.ts, packages/cli/tests/native-adapter-regressions.test.ts, packages/cli/tests/new-variants.test.ts, packages/cli/tests/show.test.ts | | | opus | pending | | |

Lane order (2026-11-27, from the test classification): b runs first and alone. It does the moves (`git mv` of the 21 content test files, the `shipped-hooks` helper, the brief digests, `fixtures/search/` and the eval transcript into `tests/registry/`, then their imports and runtime paths), pulls the content tests out of the 12 mixed files into `tests/registry/`, fixes the mixed files' few hard-coded behavior tests, makes every content test pass the real registry to the helpers explicitly (`records(bundled)`, `options(home, bundled)`, an explicit stack and registry for `scaffoldAdapters`), and writes `scripts/brief-digests.ts`. Then a and c run in parallel: each turns its helpers' defaults to a fixture registry and fixes the behavior tests that hard-code real content. Because b made the content tests explicit, a and c touch nothing under `tests/registry/`. Any other behavior file a or c must touch because a default changed is named in its hand-off.

(Scaffold, mine: `packages/cli/vitest.config.ts` projects, `packages/cli/package.json` scripts (`test:registry`, `test:behavior`, `digests`), `packages/cli/tsconfig.registry.json` moved to `packages/cli/registry/tsconfig.json` (`rootDirs` can't be globbed, and the hooks need it to resolve `./_lib`; inside `registry/` a content change stays inside it), the paths in `scripts/release.ts`, `scripts/search-eval.ts`, `tests/search-eval-pool.test.ts` and the docs pointed at `tests/registry/fixtures/` ahead of lane b's moves, the command guard denying `test:behavior`, `test:registry` and `rr test-registry` like the other whole suites, `.rr.yaml` (`check-cli` runs `behavior`; new `check-registry` and `test-registry` tasks), `.github/workflows/ci.yml` `changes` job and the `ci-ok` rule. The moves went to lane b rather than the scaffold, because pre-commit runs the moved files' macOS tests and their imports only resolve once fixed. Root `scripts/release.ts` calls `scripts/brief-digests.ts` instead of its own `rewriteDigests`; that's mine, with its test. Phase 4 runs after phase 2, because phase 2 regenerates the brief digests and changes `written`, which `brief.test.ts` and `new-variants.test.ts` see. It can run alongside phase 3, since they share no file.)

### Phase 5: the five mobile stacks meet the full dev-setup bar

Scaffold: 015ed55c
Tag: idx-phase-5

Demo: `bun run dev validate --json` has zero findings, and `bun run dev new <id> /tmp/<id> --no-launch` for each of the five shows the new pieces (Swift Testing in ios-uikit, a Maestro flow in react-native, coverage floors, macOS CI guidance), each run by a verify step. Benching happens after the merge (release step 5).
Depends on: phase 1

Each lane starts by auditing its stacks in two passes and reports what it finds before fixing anything. The first pass checks the bar in the Spec. The second checks general best practices and conventions for that stack, against current official docs (context7 or the platform's own docs) rather than memory:
- project layout and naming;
- the architecture the platform recommends (Flutter's architecture guide, Apple's SwiftUI/UIKit and concurrency guidance, React Native's and React Navigation's docs);
- idiomatic error handling and state management;
- accessibility basics (labels and Dynamic Type or text scaling);
- secrets kept out of source;
- each tool's own recommended config.

Each finding names the file and the source it contradicts. The user expects most of these to already hold, so a pass that finds nothing is a valid result. I accept or reject each finding before the lane fixes it. Lanes run as the `stack-creator` agent (the repo's agent for revising registry entries), follow the `stack-authoring` skill, ship no version literals, back every new file with a verify step, and stay within the 2,000-word stack budget. Known gaps:
- ios-uikit: unit tests move from XCTest to Swift Testing (XCUITest stays XCTest).
- react-native: a Maestro end-to-end flow on the iOS simulator as a verify step.
- All five: a coverage command with a floor.
- `ci-github`: guidance for a macOS runner when a stack's verify uses `xcodebuild`, `xcrun` or a simulator.

A `ci-github` change triggers the canary rule (D42), so the four canaries are re-proven along with the bench.

| Lane | Size | Owns files | Reads | Tests | Model | Status | Branch | Done when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a | M | packages/cli/registry/stacks/ios-uikit/, packages/cli/registry/stacks/ios-objc/ | | | opus | merged | | |
| b | M | packages/cli/registry/stacks/ios-swiftui/, packages/cli/registry/stacks/flutter/ | | | opus | merged | | |
| c | M | packages/cli/registry/stacks/react-native/, packages/cli/registry/fragments/ci-github/ | | | opus | merged | | |

(Inline, mine: the bar as a checklist in `.claude/skills/stack-authoring/`, plus any search-card or dependency-card updates for new tools such as Maestro, since cards and `allowlist.json` are shared files. Phase 5 runs alongside phases 2 to 4, because it owns no file they own.)

## Release and handoffs (after the user approves the merge; not lanes)

1. Maintainer: generate both key pairs (`openssl genpkey -algorithm ed25519`), keep the private halves offline, and hand over the public PEMs (needed before phase 3).
2. Publish `@steamfield/stacks-format` with the keys (the release workflow's manual run from `main`).
3. A `stacks-api` session (I start it with a brief) does four things there. It signs with `stacks-index-2026a`, and `signingKeys` fails instead of generating a key. It passes release, backup and legacy keys as `STACKS_INDEX_PUBLIC_KEYS`. It requires `--ref`. It drops `--include-unproven` (user decision). It also adds one `prod:ship --ref <ref>` command covering deploy, Worker build and the live page check.
4. `bun run release 0.16.0 --min-cli`, commit, push. Then `prod:ship --ref <release commit>`. Check the live `keyId` is `stacks-index-2026a`, and that `/stacks/phaser-game/` (proven 2026-11-25) returns 200. Then tag `v0.16.0`.
5. Bench the five unproven stacks (maintainer runs `bun run bench`), so they rejoin the index on the next deploy.

## Verification

- Each phase: `rr check` green on the landing branch before its tag, with counts read as `.claude/rules/cli/verification.md` asks.
- End of run: the phase demos above. `new` and `add` in all three audiences (human through `bun run human -- new … --no-launch`, agent, `--json`) against a local index server answering 200, 304, 500 and a tampered signature, plus `--offline`. The published-build checks from phase 3. The phase 4 throwaway-stack check.
- MCP: `packages/mcp/e2e/schema-drift.test.ts` passes with the new warning fields.

## Log

- 2026-11-26 plan critique (devils-advocate, opus): 8 findings, all applied. Signature demos fixed and every failed signature check mapped to `signature`. Metadata-only entries dropped in favor of a non-cached deadline race. Budget scope made per invocation, with a `get`-after-lapse test. No warning without an index root. Refresh memoized, so no second request. Lane ownership fixed (`cliMeetsMinimum` exported, `compose-files.test.ts`, add internals, phase 2 contracts in a scaffold). Phase 4 now depends on phase 2. The proof gate's effect on deploy-shipped content and on the five unproven stacks is stated.
