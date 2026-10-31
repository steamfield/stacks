# R13 search relevance, 2026-10-28

Status: three metadata rounds complete; relevance bar partially met. Single review pass resolved; changes uncommitted. Local working-tree ranking only; final API pass belongs to the orchestrator.

## Method and baseline

The following 42 expectations were written from `bun run dev list --json` before running any of these queries. None reuses an existing golden holdout query. Grades compare the expected kind; an unrelated stack on a fragment-only need is also recorded when it creates a misleading strong first result. Unsupported named technologies remain limitations even when a nearby foundation is acceptable. No-match requires `noStrongMatch: true` and no strong hit of either kind.

Baseline commands in `packages/cli`: `bun run search:eval` and `bun run search:eval --split tune`, both exit 0.

| Set | MRR | Recall@3 | Fragment recall@5 | First | No-match |
| --- | --- | --- | --- | --- | --- |
| Original total (47) | 1.0000 | 0.9800 | 1.0000 | 36/36 | 4/4 |
| Original tune (30) | 1.0000 | 0.9667 | 1.0000 | 22/22 | 3/3 |
| Original holdout (17) | 1.0000 | 1.0000 | 1.0000 | 14/14 | 1/1 |

## Expectations, recorded before execution

| ID | Category | Query | Expected first | Reason |
| --- | --- | --- | --- | --- |
| R01 | product | a SaaS for teams with auth and Stripe subscriptions | stack:react-router | General browser application foundation; billing and web auth need custom implementation. |
| R02 | product | an internal dashboard for handling support tickets | stack:react-router | Server-rendered forms suit an internal CRUD application; Python or Workers are fair alternatives. |
| R03 | product | a blog with a CMS for our company news | stack:astro-blog | Content publishing fits; an external CMS integration remains application work. |
| R04 | product | a desktop file organizer with a Rust engine | stack:tauri-react | Desktop UI with native Rust logic. |
| R05 | product | an iPhone habit tracker with an API I own | stack:mobile-expo | Phone frontend and owned backend. |
| R06 | product | a static documentation site with interactive API examples | stack:astro-api | Static content with islands and a separate typed API. |
| R07 | stack | next.js with postgres | stack:react-router | Closest server React alternative, but Next.js and Postgres are not included. |
| R08 | stack | python api and react frontend | stack:python-react | Explicit Python backend and React client. |
| R09 | stack | a golang command line utility using cobra | stack:go-cli | Go and Cobra are the recipe. |
| R10 | stack | a node service with Effect HttpApi and OpenAPI | stack:typescript-api | Standalone typed HTTP service. |
| R11 | stack | Astro pages with an Effect backend in a bun workspace | stack:astro-api | Exact static frontend and shared API contract shape. |
| R12 | stack | Bun compiled TypeScript command line program | stack:typescript-cli | Compiled TypeScript CLI. |
| R13 | constraint | TypeScript only, no Python, for a server rendered React dashboard | stack:react-router | TypeScript SSR application, no Python backend. |
| R14 | constraint | deploy a server rendered React app to Cloudflare Workers | stack:cloudflare-react-router | Workers SSR runtime is explicit. |
| R15 | constraint | a markdown blog with no Docker dependency | stack:astro-blog | Static publishing does not need containers. |
| R16 | constraint | a CLI in Go that does not need Node installed | stack:go-cli | Standalone Go binary, not a Node application. |
| R17 | constraint | a local desktop app, no hosted backend, React and Rust | stack:tauri-react | Native desktop IPC without a server. |
| R18 | constraint | a browser dashboard with Python services, not server rendered pages | stack:python-react | Separate Python API and client-rendered React. |
| R19 | fragment | add CI to my existing repo | fragment:ci-github | Existing check commands run in GitHub Actions. |
| R20 | fragment | add e2e browser tests to my existing React repo | no match | No standalone browser-testing fragment; existing stacks have tests but do not add them to arbitrary repos. |
| R21 | fragment | deploy my existing app to Fly.io | no match | No Fly deployment fragment; container publishing alone does not deploy there. |
| R22 | fragment | add Google sign in to my Expo app | fragment:clerk | Expo authentication fragment. |
| R23 | fragment | add a SQL database and migrations to my Worker | fragment:cloudflare-d1 | D1 persistence and migrations for Workers. |
| R24 | fragment | publish my Go executable to Homebrew | fragment:goreleaser | Go archives with optional Homebrew tap publishing. |
| R25 | fragment | add pre commit linting to this repository | fragment:git-hooks | Lefthook staged-file checks. |
| R26 | fragment | track pageviews and signup events in our frontend | fragment:posthog | Typed browser event analytics. |
| R27 | fragment | run slow checks on another computer using ssh | fragment:rr | Remote execution of existing commands. |
| R28 | fragment | add streaming model replies and conversation export to my React Router site | fragment:openrouter-chat | Browser chat application fragment. |
| R29 | fragment | add checksum installation and self update to my Bun CLI | fragment:bun-release | Compiled Bun distribution and updates. |
| R30 | fragment | give my API consistent resource names and cursor pagination | fragment:rest-api | HTTP resource design conventions. |
| R31 | agent | The user wants a full stack mobile application for iOS and Android, React Native screens, a Hono backend, shared TypeScript schemas and Postgres storage | stack:mobile-expo | Phone application and backend match the full recipe. |
| R32 | agent | Please find a stack for a Python FastAPI service with a Vite React frontend, generated OpenAPI client types and a single command to run checks | stack:python-react | Explicit Python and React architecture. |
| R33 | agent | We need server rendered pages, forms handled with actions, shared Effect services and structured logs in a React Router Node application | stack:react-router | Node SSR and actions favor React Router. |
| R34 | agent | I already have a Go command line project. Add tagged GitHub releases, cross compilation, checksums and archives for Linux and macOS | fragment:goreleaser | Release need in an existing Go project. |
| R35 | shorthand | postgress migrations for fastapi | fragment:postgres | Common Postgres misspelling plus Python migration context. |
| R36 | shorthand | ts api | stack:typescript-api | TypeScript abbreviation and API product kind. |
| R37 | shorthand | rn app | stack:mobile-expo | React Native abbreviation. |
| R38 | shorthand | golang cli json output | stack:go-cli | Short Go CLI request with machine output. |
| R39 | no-match | firmware to control a drone | no match | Embedded firmware is outside the catalog. |
| R40 | no-match | a Unity multiplayer racing game | no match | No game-engine recipe. |
| R41 | no-match | !!! | no match | Punctuation contains no searchable intent. |
| R42 | no-match | asdf | no match | Nonsense has no catalog meaning. |

## Round 0, before changes

All 42 local CLI invocations exited 0. The top-three projection follows the contract; full `understood`, `why`, coverage and penalties were inspected for failures.

| ID | Grade | Observed first results in expected kind |
| --- | --- | --- |
| R01 | acceptable | react-router (strong, 0.77), cloudflare-react-router (strong, 0.77), python-react (strong, 0.713) |
| R02 | good | react-router (partial, 0.778), cloudflare-react-router (partial, 0.77), python-react (partial, 0.728) |
| R03 | acceptable | astro-blog (strong, 0.967), go-cli (weak, 0.047), tauri-react (weak, 0.045) |
| R04 | good | tauri-react (strong, 0.986), astro-blog (partial, 0.507), go-cli (weak, 0.223) |
| R05 | wrong | python-react (partial, 0.957), astro-api (partial, 0.961), typescript-api (partial, 0.958) |
| R06 | good | astro-api (strong, 0.985), python-react (partial, 0.958), typescript-api (partial, 0.967) |
| R07 | wrong | mobile-expo (strong, 0.921), astro-blog (strong, 0.687), typescript-cli (strong, 0.687) |
| R08 | good | python-react (strong, 0.987), astro-api (partial, 0.91), typescript-api (partial, 0.874) |
| R09 | good | go-cli (strong, 0.983), typescript-cli (partial, 0.896), python-react (partial, 0.254) |
| R10 | good | typescript-api (strong, 0.976), astro-api (strong, 0.959), react-router (strong, 0.957) |
| R11 | good | astro-api (strong, 0.98), react-router (strong, 0.967), python-react (partial, 0.949) |
| R12 | good | typescript-cli (strong, 0.982), go-cli (partial, 0.916), typescript-api (partial, 0.805) |
| R13 | wrong | python-react (strong, 0.982), react-router (strong, 0.982), cloudflare-react-router (strong, 0.978) |
| R14 | good | cloudflare-react-router (strong, 0.988), react-router (strong, 0.98), python-react (partial, 0.942) |
| R15 | good | astro-blog (partial, 0.967), mobile-expo (weak, 0.099), react-router (weak, 0.086) |
| R16 | wrong | typescript-cli (strong, 0.968), go-cli (partial, 0.982), typescript-api (partial, 0.78) |
| R17 | good | tauri-react (strong, 0.989), react-router (partial, 0.749), python-react (partial, 0.715) |
| R18 | good | python-react (partial, 0.965), react-router (partial, 0.937), cloudflare-react-router (partial, 0.91) |
| R19 | good | ci-github (strong, 0.672), docker-deploy (partial, 0.294), openrouter-chat (partial, 0.269) |
| R20 | wrong | noStrongMatch=false; strong: python-react, cloudflare-react-router |
| R21 | wrong | noStrongMatch=true; strong: cloudflare-pages |
| R22 | good | clerk (strong, 0.574), openrouter-chat (partial, 0.268), posthog (partial, 0.26) |
| R23 | good | cloudflare-d1 (strong, 0.813), postgres (strong, 0.726), openrouter-chat (partial, 0.273) |
| R24 | good | goreleaser (strong, 0.714), bun-release (partial, 0.459), cloudflare-pages (partial, 0.312) |
| R25 | good | git-hooks (partial, 0.683), agent-ops (partial, 0.371), posthog (partial, 0.307) |
| R26 | good | posthog (strong, 0.663), docker-deploy (partial, 0.262), openrouter-chat-cli (weak, 0.221) |
| R27 | good | rr (strong, 0.693), ci-github (strong, 0.544), git-hooks (partial, 0.433) |
| R28 | good | openrouter-chat (strong, 0.75), openrouter-chat-cli (partial, 0.655), cloudflare-pages (partial, 0.519) |
| R29 | good | bun-release (strong, 0.808), goreleaser (partial, 0.457), openrouter-chat-cli (partial, 0.388) |
| R30 | good | rest-api (strong, 0.818), effect (partial, 0.367), git-hooks (partial, 0.312) |
| R31 | good | mobile-expo (strong, 0.991), python-react (partial, 0.972), react-router (partial, 0.977) |
| R32 | good | python-react (strong, 0.991), tauri-react (partial, 0.924), react-router (partial, 0.905) |
| R33 | good | react-router (strong, 0.992), typescript-api (partial, 0.983), astro-api (partial, 0.972) |
| R34 | good | goreleaser (strong, 0.846), bun-release (partial, 0.779), ci-github (partial, 0.568) |
| R35 | wrong | cloudflare-d1 (strong, 0.543), postgres (partial, 0.449), docker-deploy (weak, 0.017) |
| R36 | wrong | python-react (strong, 0.96), astro-api (strong, 0.964), typescript-api (strong, 0.962) |
| R37 | missing | empty |
| R38 | good | go-cli (strong, 0.978), typescript-cli (partial, 0.907), cloudflare-react-router (partial, 0.533) |
| R39 | wrong | noStrongMatch=false; strong: mobile-expo, tauri-react |
| R40 | good | noStrongMatch=true; strong: none |
| R41 | good | noStrongMatch=true; strong: none |
| R42 | good | noStrongMatch=true; strong: none |

Round 0: 32/42 good or acceptable (76.2%), 9 wrong, 1 missing. Eight wrong first results are strong (R07, R13, R16, R20, R21, R35, R36, R39); R05 has only partial hits. Three of six out-of-scope queries meet both conditions (R40–R42). R21 has no strong stack but a strong fragment.

## Round 1 changes and causes

| Query | Cause from explanations | Lever and change |
| --- | --- | --- |
| R05 | ios/server and api are understood; mobile-expo gets a productKind penalty for api and ranks fourth. | Add api to mobile-expo productKinds: its Hono API is part of the recipe. |
| R07 | next is unmatched, js maps to TypeScript; Postgres promotes mobile-expo. | Vocabulary maps next.js to web-app, a product shape, without claiming a Next.js implementation. |
| R13 | Negated Python is parsed positively, matching python-react. | Exclude TypeScript-only projects from python-react, a true boundary. |
| R16 | Negated Node maps to TypeScript; go-cli covers only 2/5 matched words. | Add a Go request describing execution without Node installed. |
| R35 | postgress is unmatched; D1 wins on migrations. | Postgres synonyms FastAPI/postgress; vocabulary maps fastapi to Python and postgresql/postgress/pg to database. |
| R36 | ts maps to TypeScript but no API-specific text; Python also has a TypeScript frontend. Cached proof settles close scores. | TS synonym on typescript-api, the standalone TypeScript service. |
| R37 | rn is unmatched and app is a stopword. | Vocabulary maps rn/react native to mobile and rn app to mobile-app. |
| R39 | Only control matches strong fields; unmatched firmware/drone do not reduce coverage. | Exclude firmware on mobile-expo and tauri-react, factual platform boundaries. |
| R21 | deploy matches deploy capabilities, ignoring Fly/io; noStrongMatch checks only stacks. | Cloudflare Pages excludes Fly.io, an unsupported hosting target. |
| R20 | Existing-repo intent and e2e are unrecognized; browser/React/test promote scaffold stacks. | No change: excluding browser tests would misdescribe recipes that include them. Needs a ranking distinction for fragment intent. |

Edited cards (under packages/cli/registry/search/): stacks/mobile-expo.json, stacks/tauri-react.json, stacks/python-react.json, stacks/go-cli.json, stacks/typescript-api.json, fragments/postgres.json, fragments/cloudflare-pages.json. Source digests and original review provenance stay unchanged: entries did not change, and this pass does not claim new human approval. Editorial descriptions and project examples are untouched; changed discovery fields need the orchestrator's review.

## Round 1 results and round 2 adjustments

Round 1 manual results: 39/42 good or acceptable (92.9%); remaining wrong: R13, R20, R36. Three wrong first results are strong; 5/6 out-of-scope cases meet both conditions. Original golden metrics unchanged: total MRR 1.0000, recall@3 0.9800, fragment recall@5 1.0000; tune 1.0000/0.9667/1.0000, first 22/22, no-match 3/3; holdout 1.0000/1.0000/1.0000, first 14/14, no-match 1/1. Golden/coverage/metadata tests: 11 files, 127 tests passed.

Round 2 removes the extra word projects from python-react's exclusion: the exclusion matcher required that word too, so it missed R13. The typescript-api summary now names the language and API, with one additional request describing a TS API with checked inputs and documentation. This addresses R36's lexical ambiguity while preserving the card's plain voice. `--local` still uses cached quality evidence: the observed Python API score was 0.959 with greenRateLower 0.75, ahead of typescript-api at 0.967 without stats. Eval/golden ranking has no cached evidence; both paths must pass. Metadata was frozen for the following holdout execution; the later review independently required round 3. No tuning uses the new holdout results.

Nine regression queries are added to golden tune (R05, R07, R13, R16, R21, R35–R37, R39). R07 is an approximate React foundation, explicitly not a Next.js implementation; its final judgment lists grade-1 alternatives without a required first (see the correction below). R20 remains a documented failure and is not hidden behind a weakened golden assertion. The existing gate thresholds and existing judgments are unchanged.

### Fresh holdout expectations, recorded before execution

| ID | Query | Expected first | Reason |
| --- | --- | --- | --- |
| r13-h01 | ship a Windows utility with React views and native Rust commands | stack:tauri-react | Desktop native Rust with React. |
| r13-h02 | start a backend in TypeScript with validated HTTP inputs | stack:typescript-api | Standalone typed backend. |
| r13-h03 | automate our pull request checks on GitHub | fragment:ci-github | CI for pull requests. |
| r13-h04 | use an Android and iOS client sharing schemas with Hono | stack:mobile-expo | Mobile client and Hono backend. |
| r13-h05 | draft articles locally, hide unfinished posts and emit RSS | stack:astro-blog | Local content publishing and RSS. |
| r13-h06 | a Fortran fluid dynamics solver | no match | No scientific-computing recipe. |

Final fixture split will be 39 tune and 23 holdout (62 total, 37.1% holdout). Holdouts are new phrasings and will not be used for further card tuning.

## Round 2 results, before review

The first round's Python exclusion did not match R13, and its TS synonym was insufficient for R36 in the live CLI. Round 2 fixes R13. In the expanded golden set, R07's arbitrary required first failed: without cached evidence, cloudflare-react-router wins a lexical tie with react-router. This newly added judgment was corrected to two grade-1 alternatives with no required first, following 4.5a's ambiguity rule. Neither implements Next.js. No existing query, assertion or gate threshold changed. At this stage there were no metadata changes after observing the six new holdouts; the later review required separate corrections.

| ID | Before | Round 1 | Round 2 grade | Round 2 first in expected kind (or no-match status) |
| --- | --- | --- | --- | --- |
| R01 | acceptable | acceptable | acceptable | react-router (strong, 0.777) |
| R02 | good | good | good | react-router (partial, 0.785) |
| R03 | acceptable | acceptable | acceptable | astro-blog (strong, 0.967) |
| R04 | good | good | good | tauri-react (strong, 0.986) |
| R05 | wrong | good | good | mobile-expo (strong, 0.968) |
| R06 | good | good | good | astro-api (strong, 0.985) |
| R07 | wrong | acceptable | acceptable | react-router (strong, 0.85) |
| R08 | good | good | good | python-react (strong, 0.987) |
| R09 | good | good | good | go-cli (strong, 0.983) |
| R10 | good | good | good | typescript-api (strong, 0.974) |
| R11 | good | good | good | astro-api (strong, 0.98) |
| R12 | good | good | good | typescript-cli (strong, 0.982) |
| R13 | wrong | wrong | good | react-router (strong, 0.982) |
| R14 | good | good | good | cloudflare-react-router (strong, 0.988) |
| R15 | good | good | good | astro-blog (partial, 0.967) |
| R16 | wrong | good | good | go-cli (strong, 0.985) |
| R17 | good | good | good | tauri-react (strong, 0.989) |
| R18 | good | good | good | python-react (partial, 0.966) |
| R19 | good | good | good | ci-github (strong, 0.672) |
| R20 | wrong | wrong | wrong | noStrongMatch=false; strong: python-react, cloudflare-react-router |
| R21 | wrong | good | good | noStrongMatch=true; strong: none |
| R22 | good | good | good | clerk (strong, 0.575) |
| R23 | good | good | good | cloudflare-d1 (strong, 0.813) |
| R24 | good | good | good | goreleaser (strong, 0.714) |
| R25 | good | good | good | git-hooks (partial, 0.683) |
| R26 | good | good | good | posthog (strong, 0.663) |
| R27 | good | good | good | rr (strong, 0.692) |
| R28 | good | good | good | openrouter-chat (strong, 0.75) |
| R29 | good | good | good | bun-release (strong, 0.809) |
| R30 | good | good | good | rest-api (strong, 0.819) |
| R31 | good | good | good | mobile-expo (strong, 0.991) |
| R32 | good | good | good | python-react (strong, 0.991) |
| R33 | good | good | good | react-router (strong, 0.992) |
| R34 | good | good | good | goreleaser (strong, 0.846) |
| R35 | wrong | good | good | postgres (strong, 0.599) |
| R36 | wrong | wrong | wrong | python-react (strong, 0.959) |
| R37 | missing | good | good | mobile-expo (strong, 0.871) |
| R38 | good | good | good | go-cli (strong, 0.978) |
| R39 | wrong | good | good | noStrongMatch=true; strong: none |
| R40 | good | good | good | noStrongMatch=true; strong: none |
| R41 | good | good | good | noStrongMatch=true; strong: none |
| R42 | good | good | good | noStrongMatch=true; strong: none |

| Bar measure | Before | Round 2 | Target met in round 2 |
| --- | --- | --- | --- |
| Good or acceptable | 32/42 (76.2%) | 40/42 (95.2%) | yes, at least 90% |
| Wrong first at strong tier | 8 | 2 (R20, R36) | no |
| Out-of-scope noStrongMatch and no strong hit | 3/6 | 5/6 | no, R20 remains |
| Golden first/no-match checks | 36/36, 4/4 | 47/47, 7/7 | yes |
| Original holdout metrics | 1.0000 / 1.0000 / 1.0000 | 1.0000 / 1.0000 / 1.0000 | yes |

First-result grades are evaluated within the expected kind, as the golden contract specifies; no-match checks both kinds. R01 remains acceptable because billing and browser authentication need implementation; R03 because CMS integration is extra work; R07 because neither candidate is Next.js. A first partial hit can be good under this ranking-position rubric (R02, R15, R18, R25). This does not imply a strong result: compare the recorded tiers and noStrongMatch before scaffolding. Secondary strong scaffold suggestions for fragment needs also need human interpretation; ranking does not distinguish a new project from an existing repository.

### Eval metrics after each batch

| Dataset and stage | MRR | Recall@3 | Fragment recall@5 | First | No-match |
| --- | --- | --- | --- | --- | --- |
| Original total, round 1 | 1.0000 | 0.9800 | 1.0000 | 36/36 | 4/4 |
| Original tune, round 1 | 1.0000 | 0.9667 | 1.0000 | 22/22 | 3/3 |
| Original holdout, round 1 | 1.0000 | 1.0000 | 1.0000 | 14/14 | 1/1 |
| Expanded total, initial round 2 judgment | 0.9872 | 0.9857 | 1.0000 | 47/48 | 7/7 |
| Expanded tune, initial round 2 judgment | 0.9792 | 0.9762 | 1.0000 | 28/29 | 5/5 |
| Expanded holdout, initial round 2 judgment | 1.0000 | 1.0000 | 1.0000 | 19/19 | 2/2 |
| Expanded total, corrected ambiguous R07 | 1.0000 | 0.9853 | 1.0000 | 47/47 | 7/7 |
| Expanded tune, corrected ambiguous R07 | 1.0000 | 0.9750 | 1.0000 | 28/28 | 5/5 |
| Expanded holdout, corrected ambiguous R07 | 1.0000 | 1.0000 | 1.0000 | 19/19 | 2/2 |

The original 17 holdouts still pass individually; expanded holdout also stays perfect. Fixture: 39 tune, 23 holdout (37.1%). The nine tune additions test fixes; six holdouts were written without using them to tune metadata. `gate` stays unchanged under the contract's additions-only restriction. Fresh holdouts H01–H05 return their expected first in eval; H06 has no strong hit. Holdout recall has no decline.

## Failures remaining after round 2

- **R20: add e2e browser tests to my existing React repo.** `understood` recognizes web via browser, but e2e and repo are unmatched. python-react is first strong (0.968), cloudflare-react-router also strong (0.962); noStrongMatch is false. Their browser/React/test terms cover 3/5 recognized words. They scaffold projects rather than add standalone browser tests, and no fragment fills this need. Excluding browser tests from those cards would be false. Proposed ranking work: recognize existing-repository/addition intent, judge available fragments for that need, and require matching capability before a strong result; abstain when it is unsupported. Also reconcile noStrongMatch's stack-only calculation with no-match checks over both kinds.
- **R36: ts api, with cached quality evidence.** Eval now ranks typescript-api first (0.976), followed by astro-api (0.964) and python-react (0.959). The real CLI promotes python-react using cached greenRateLower 0.75 (quality factor 1.025), so its adjusted comparison is about 0.983. Its TypeScript frontend satisfies the language facet although the API is Python. Further repetition of TS/API across the card would inflate keywords to fight a ranking policy. Proposed ranking work: distinguish backend language from frontend language for API requests, or apply quality only inside a tighter lexical tie band / before score saturation. Keep fit ahead of cached quality. Do not treat the passing evidence-free golden as a reproduction of this cached case.

No ranking code, entry content, ledger, source digest or existing test file changed. No API or remote-index proof run was done: the contract assigns that final API pass to the orchestrator and limits this task to steps 1–7. Metadata digest/proof preservation is covered by the named metadata tests.

## Checks before review

- `cd packages/cli && bun run search:eval` and `bun run search:eval --split tune`: exit 0 at baseline and final; metrics above. Round 1 eval also exit 0; round 2 initial judgment reported the R07 first failure (eval prints metrics rather than failing on relevance).
- `cd packages/cli && bun run test:unit tests/search-golden.test.ts tests/search-golden-coverage.test.ts tests/search-metadata-*.test.ts`: round 1 11 files / 127 tests passed; initial round 2 10 files / 126 tests passed and one first-judgment failure for new R07; final 11 files / 127 tests passed. The fresh holdout/leakage tests pass.
- `bun run lint` from the repository root: exit 0, 1,212 files checked, no fixes.
- `bun run --cwd packages/cli test:unit tests/bundled-registry.test.ts`: exit 0, one file / one test passed, registry zero-warning invariant passes.
- `bun run dev list --json`: exit 0, 10 stacks and 20 fragments. All 126 manual search invocations across baseline and two rounds: exit 0, ranking local. No full suite, gate, commit or push.

The single review and final third round follow below. Round 2's exclusions and its two corresponding new golden assertions are not part of the final changes.

## Review and round 3: final state

One read-only Codex review ran with the requested model/effort and reviewer prompts. Report: `/tmp/r13-review.zM95xD/review.md`. Verdict on the reviewed round-2 diff: NEEDS FIXES. No second review was requested or run.

| Finding | Resolution |
| --- | --- |
| Bare Fly.io exclusion also penalizes a request migrating to Pages. | Removed it; cloudflare-pages is byte-identical to its initial card. Added the review's positive Pages-migration query as tune. R21 is now an explicit remaining failure. |
| Bare firmware exclusions reject mobile/desktop applications that manage firmware. | Removed both exclusions. Changed mobile's request from API I control to API I host, and desktop's use case from graphical controls to graphical interfaces. These more precise descriptions remove control as the only strong-field match for R39, without rejecting firmware companion applications. Added the two positive firmware-management queries as tune. |
| TypeScript-only exclusion matches a Python backend with TypeScript only on the frontend. | Removed it; python-react is byte-identical to its initial card. Added the mixed-language review query as tune. R13 is now an explicit remaining failure. |

The newly added R13 required-first and R21 no-match rows were removed when their fixes were reverted. They were additions from this task; no original fixture judgment or test assertion was changed. Their failures remain in the manual evidence. Four positive review regressions replace these overbroad fixes. Metadata changes in this third round respond only to the review's counterexamples, not holdout results. This is the third and final round.

Final edited cards, all under `packages/cli/registry/search/`:

- `fragments/postgres.json`: FastAPI and postgress synonyms.
- `stacks/go-cli.json`: request describing a Go binary running without Node installed.
- `stacks/mobile-expo.json`: api product kind; request says API I host instead of API I control.
- `stacks/tauri-react.json`: graphical interfaces instead of graphical controls in a use case.
- `stacks/typescript-api.json`: summary names TypeScript HTTP API, TS synonym, and one request about a TS API with checked inputs/documentation.

Vocabulary changes remain as listed in round 1. Final golden additions: seven manual tune queries (R05, R07, R16, R35–R37, R39), four review tune queries, and six fresh holdouts. Total 64: 41 tune / 23 holdout (35.9%). All 47 original queries and the gate object are unchanged.

### Final grades after review

| ID | Before | Final grade | Final first in expected kind (or no-match status) |
| --- | --- | --- | --- |
| R01 | acceptable | acceptable | react-router (strong, 0.777) |
| R02 | good | good | react-router (partial, 0.785) |
| R03 | acceptable | acceptable | astro-blog (strong, 0.967) |
| R04 | good | good | tauri-react (strong, 0.986) |
| R05 | wrong | good | mobile-expo (strong, 0.968) |
| R06 | good | good | astro-api (strong, 0.985) |
| R07 | wrong | acceptable | react-router (strong, 0.85) |
| R08 | good | good | python-react (strong, 0.987) |
| R09 | good | good | go-cli (strong, 0.983) |
| R10 | good | good | typescript-api (strong, 0.974) |
| R11 | good | good | astro-api (strong, 0.98) |
| R12 | good | good | typescript-cli (strong, 0.982) |
| R13 | wrong | wrong | python-react (strong, 0.982) |
| R14 | good | good | cloudflare-react-router (strong, 0.988) |
| R15 | good | good | astro-blog (partial, 0.967) |
| R16 | wrong | good | go-cli (strong, 0.985) |
| R17 | good | good | tauri-react (strong, 0.989) |
| R18 | good | good | python-react (partial, 0.966) |
| R19 | good | good | ci-github (strong, 0.672) |
| R20 | wrong | wrong | noStrongMatch=false; strong: python-react, cloudflare-react-router |
| R21 | wrong | wrong | noStrongMatch=true; strong: cloudflare-pages |
| R22 | good | good | clerk (strong, 0.575) |
| R23 | good | good | cloudflare-d1 (strong, 0.813) |
| R24 | good | good | goreleaser (strong, 0.714) |
| R25 | good | good | git-hooks (partial, 0.683) |
| R26 | good | good | posthog (strong, 0.663) |
| R27 | good | good | rr (strong, 0.692) |
| R28 | good | good | openrouter-chat (strong, 0.75) |
| R29 | good | good | bun-release (strong, 0.809) |
| R30 | good | good | rest-api (strong, 0.819) |
| R31 | good | good | mobile-expo (strong, 0.991) |
| R32 | good | good | python-react (strong, 0.991) |
| R33 | good | good | react-router (strong, 0.992) |
| R34 | good | good | goreleaser (strong, 0.846) |
| R35 | wrong | good | postgres (strong, 0.599) |
| R36 | wrong | wrong | python-react (strong, 0.959) |
| R37 | missing | good | mobile-expo (strong, 0.871) |
| R38 | good | good | go-cli (strong, 0.978) |
| R39 | wrong | good | noStrongMatch=true; strong: none |
| R40 | good | good | noStrongMatch=true; strong: none |
| R41 | good | good | noStrongMatch=true; strong: none |
| R42 | good | good | noStrongMatch=true; strong: none |

| Bar measure | Baseline | Final | Result |
| --- | --- | --- | --- |
| Good or acceptable | 32/42 (76.2%) | 38/42 (90.5%) | meets 90% |
| Wrong first at strong tier | 8 | 4: R13, R20, R21, R36 | target 0 unmet |
| Out-of-scope noStrongMatch flags | 4/6 | 5/6 | R20 still false |
| Out-of-scope with flag true and no strong hit in either kind | 3/6 | 4/6 | R20 and R21 fail |
| Golden required first / no-match | 36/36, 4/4 | 50/50, 6/6 | pass |

The four positive review queries also ran through the real local CLI, all exit 0 and expected first strong: Pages migration → cloudflare-pages 0.822; desktop firmware updater → tauri-react 0.988; phone firmware updater → mobile-expo 0.959; Python API with TypeScript only on frontend → python-react 0.985. These supplement the 42-query manual set; they do not inflate its pass rate.

### Final eval and checks

| Dataset | MRR | Recall@3 | Fragment recall@5 | First | No-match |
| --- | --- | --- | --- | --- | --- |
| Total (64) | 1.0000 | 0.9861 | 1.0000 | 50/50 | 6/6 |
| Tune (41) | 1.0000 | 0.9773 | 1.0000 | 31/31 | 4/4 |
| Holdout (23) | 1.0000 | 1.0000 | 1.0000 | 19/19 | 2/2 |

Final commands after review changes:

- In packages/cli, `bun run search:eval` and `bun run search:eval --split tune`: exit 0, metrics above.
- In packages/cli, `bun run test:unit tests/search-golden.test.ts tests/search-golden-coverage.test.ts tests/search-metadata-*.test.ts`: exit 0, 11 files / 127 tests passed.
- `bun run --cwd packages/cli test:unit tests/bundled-registry.test.ts`: exit 0, one file / one test passed, zero-warning registry. It was rerun because review changed metadata after the earlier check.
- `bun run lint` at root: exit 0, 1,212 files, no fixes. `git diff --check`: clean.
- Manual CLI searches: 42 at baseline and in each of three rounds, plus four review cases, 172 total; all exit 0 with local ranking.

### Open failures for the orchestrator

- **R13: TypeScript only, no Python, for a server rendered React dashboard.** python-react remains first strong (0.982). Python is parsed as a positive language; platform/language comparisons accept any matching facet. The tempting TypeScript-only exclusion falsely penalizes valid mixed-language projects, as review demonstrated. Ranking needs negation scoped to its language constraint and backend/frontend roles.
- **R20: add e2e browser tests to my existing React repo.** Unchanged from the round-2 diagnosis: strong scaffold stacks for an unsupported addition. Needs existing-repository/fragment intent and capability sufficiency.
- **R21: deploy my existing app to Fly.io.** noStrongMatch is true, but cloudflare-pages is first strong fragment (0.602). Deployment capability matches while Fly/io are unmatched; the ranker has no hosting-target constraint. A bare vendor exclusion also rejects valid migrations to Pages. Needs target-provider recognition and a consistent noStrongMatch calculation over the relevant kind.
- **R36: ts api with cached quality.** Unchanged from round 2: python-react 0.959 is promoted over typescript-api 0.976 by its 1.025 quality factor. Eval without evidence gets the right first. Needs API-language role handling or a tighter policy for quality to break lexical ties.

No rank.ts change was made. The final API pass remains the orchestrator's task. Human review should focus on the five cards' phrasing, the approximate Next.js judgments, and the four recorded ranking limitations. All changes remain uncommitted; nothing was pushed.




