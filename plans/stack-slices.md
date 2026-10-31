# Ship a proving slice in every bundled stack

Status: EXECUTING 2026-10-31

## Goal

`go-cli` and `typescript-api` now ship a working slice of the project in `files/`
(source, tests, configs, docs) instead of starter files plus prose. The agent that builds
a project adds current dependencies, brings the shipped code up to the installed
releases and fills the README; it no longer writes the foundation from a description.
The other twelve bundled stacks get the same treatment, so every stack starts an agent
from code that already passes its checks.

The rule and the method are in `.claude/skills/stack-authoring/SKILL.md` ("The proving
slice") and the public `packages/cli/skills/stacks-author/references/anatomy.md`
("The body", "files/ and adapters/"), updated for this work. This plan only orders the
work and records per-stack risks.

## Done, per stack

1. `files/` carries the slice the guidance describes, with no version literal, and
   every shipped file is exercised by a verify step.
2. `STACK.md` opens with "What stacks wrote", its Setup is the add-deps, run-checks,
   update-what-the-release-broke sequence, and prose the code now carries is gone. The
   body stays under 2,000 words and every composed brief (default, sandbox, each
   default and optional fragment) under its budget.
3. A fresh scaffold from the working registry, built only by following its brief,
   reaches `stacks verify` green. The proof record (each step's outcome) is in the
   delegate's hand-off.
4. `bun run dev validate` is warning-free, lint and typecheck pass, and the scoped
   tests naming the stack pass.
5. Its search card is restamped after the last entry edit. Any `STACK.md` edit makes
   `search-stale` warn, and the bundled registry must be warning-free, so a card that
   no longer fits blocks the merge to `main` until a person approves its rewrite. Keep
   `description` and the card's claims true to avoid that.

## Lanes

Two Codex delegates (`scripts/delegate.sh`), one worktree and branch each, one run per
stack. The orchestrator reviews and commits each stack on the lane branch before the
lane's next run, so a later stack builds on reviewed work and a failure stays isolated.
Order puts the stack closest to a reference conversion first.

| Lane | Branch | Order |
| --- | --- | --- |
| A, TypeScript web and Effect | `delegate/slices-ts` | `typescript-cli`, `react-router`, `astro-fullstack`, `nextjs`, `sveltekit`, `astro-blog`, `cloudflare-react-router` |
| B, polyglot | `delegate/slices-poly` | `go-api`, `python-api`, `python-react`, `tauri-react`, `mobile-expo` |

Lane B has fewer stacks because each Tauri proof is a cold Cargo build and `mobile-expo`
runs Docker; `astro-blog` moved to lane A for that reason (DA finding 15).

## Per-stack notes

- `typescript-cli`: model on `typescript-api`'s Effect layout and on this repo's own CLI
  (commands, config, errors table, output audiences, logging), cut to one command.
  `@effect/platform-bun` is no longer installed in this repo, so its platform file can't
  typecheck under `tsconfig.registry.json`; exclude what imports it.
- `react-router`: framework mode with the Effect server boundary its guidance docs
  describe; one loader and one action through Effect, the error boundary, Vitest and the
  e2e test. Files importing `react-router` or `@react-router/dev` go in the registry
  tsconfig's `exclude`. `tests/library-qa-recipes.test.ts` overwrites the scaffold's
  `package.json` and calls a non-recursive `mkdirSync` on `tests/`; once the slice ships
  `tests/`, move that test onto the shipped tree rather than deleting it.
- `astro-fullstack`: `apps/api` reuses `typescript-api`'s slice shape (health resource,
  error table, contract suite under `apps/api/tests/http-contract.test.ts`),
  `packages/contract` holds the `HttpApi` definition, `apps/web` one Astro page with a
  React island calling the API through the contract client. It already ships scripts and
  hook tests; keep them.
- `nextjs`: App Router layout, one page, one route handler and one server action
  through zod-validated input, the error and not-found pages, Vitest with Testing
  Library, the e2e test, ESLint and Prettier configs.
- `sveltekit`: one page with a load function and a form action, `+error.svelte`, a
  server endpoint, Vitest, the e2e test, ESLint, Prettier and `svelte.config.js`.
- `cloudflare-react-router`: Workers entry, one route with a loader, the
  Vitest-on-Workers setup and a Wrangler config. `compatibility_date` is a date the
  agent sets at setup; ship the config without it and say so in Setup. The test
  integration must be the allowlisted `@cloudflare/vitest-plugin`; if current
  Cloudflare docs require a different package, stop and report rather than adding it.
- `go-api`: model on `go-cli`'s errors, slog, Makefile and integration suite, but its
  only dependency is testify: config comes from env with the standard library, and the
  server is `net/http` with health route, one JSON resource, the error envelope, request
  logging middleware, graceful shutdown, and the integration suite against a real
  listener.
- `python-api`: FastAPI app factory, pydantic-settings config, structlog, the error
  envelope handlers, health route, one resource, pytest with httpx and asgi-lifespan,
  ruff and mypy config in `pyproject.toml` with `version = "0.1"`, no dependency list and
  no `requires-python` (Setup runs `uv add` and records the Python version). The
  committed OpenAPI document embeds the framework's OpenAPI version, so Setup
  regenerates it rather than shipping it.
- `python-react`: the backend reuses `python-api`'s slice; the frontend ships the React
  Router app with React Query, the home route and its test, the API contract check and
  the e2e test.
- `astro-blog`: layouts, a content collection with one MDX post, RSS, sitemap, Tailwind
  setup, its tests and `astro check`. Changes its pinned brief digests
  (`tests/fixtures/bundled-brief-digests.ts`); regenerate them.
- `tauri-react`: `src-tauri` with one specta command, the bindings check, the crate-edge
  architecture check, the React frontend calling the command, Vitest and the e2e test.
  `Cargo.toml` and `package.json` carry no dependency versions and no package version
  (Setup runs `cargo add` and `bun add`). `tauri::generate_context!` reads the icons at
  compile time, so every Rust check fails without them and nothing in the registry can
  feed `tauri icon`: Setup runs the official Tauri generator into a temporary directory
  only to copy its `src-tauri/icons/`. The `build` step is tagged `prod`, which the
  sandbox preset skips; prove it with `verify --all`. Check `tauri.conf.json` and any
  `rust-toolchain.toml` for version literals by hand (validate doesn't read them).
- `mobile-expo`: the Hono API with zod-openapi, Drizzle schema and migration,
  `packages/schemas`, the Expo Router app with one screen, its harness and auth-provider
  tests, the Docker database lifecycle and the CI contract test. Keep its single-quote
  Biome override. Expo's native directories stay generated, never shipped. Start
  Docker before proving it. `tests/mobile-dev-*.test.ts` pin `scripts/dev.ts`.

`python-react` also changes its pinned brief digests; regenerate them. `astro-blog` and
`python-react` drop generator steps and prose that `tests/gate-findings.test.ts` asserts
on (about thirty assertions); each assertion moves onto the scaffolded file that now
carries its rule, in the same change.

## Shared files

Both lanes may touch `packages/cli/tsconfig.registry.json` (registry `exclude`
entries), `packages/cli/biome.json` (only to move a stack in or out of the
Prettier-formatted list), fragment `stack=<id>` blocks for their own stacks, and tests
that name their stacks: `gate-findings.test.ts`, `library-qa-*.test.ts`, `brief.test.ts`,
`registry-hooks.test.ts`, `agent-harness.test.ts`, `codex-api-harness.test.ts`,
`registry-api-harness.test.ts`, `tests/fixtures/bundled-brief-digests.ts`. Several span
both lanes, so expect conflicts when the lanes merge into `feat/stack-slices`; resolve
them by keeping both sides' changes and regenerating digests.

The devil's-advocate review (2026-10-31) found the checks this checkout runs on
shipped files: Biome reformatting Prettier-formatted stacks and rejecting Tailwind and
Svelte/Astro imports (fixed in `packages/cli/biome.json` before the lanes start), the
registry tsconfig pulling excluded and `.tsx` files back in, validate's fixed list of
version-checked files, `.tmpl` code escaping both checks, nested `.gitignore` files
hiding shipped paths, and `search-stale`. `.claude/skills/stack-authoring/SKILL.md`
covers each.

New `deps` names are out of scope: a name needs an allowlist row and a reviewed
dependency card, which is a maintainer's step. A stack that can't prove green without
one reports it and stops.

## Verification

Per stack, the delegate's scoped checks and fresh-scaffold proof, then the
orchestrator's review, lint, typecheck, `validate` and the scoped tests. After both
lanes merge into `feat/stack-slices`: the full gate (`rr check`) once, then merge to
`main`.

## Left for the maintainer

A bench run per stack (`bun run bench <id> --agent claude`), approval of any search card
a delegate rewrote, and the `runs.json` proofs these edits stale.
