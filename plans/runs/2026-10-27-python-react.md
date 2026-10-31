# Gate run: python-react, 2026-10-27

Phase 1.6b gate run for `python-react`, run 6 of this stack (earlier runs are in the
[1.6b rerun log](../archive/phases/phase-1.6b-mvp-gate-runs-2026-10-30.md#rerun-log)). It passes the gate rule
as written, pending the maintainer confirmation the plan requires.

| Field | Value |
|---|---|
| Stack and fragments | `python-react` with `agent-ops`, `ci-github`, `git-hooks`, `posthog`, preset `sandbox` |
| Repo commit | `e6f5da2`. The next commit changes only an astro-blog block of `posthog`, so this brief is the release commit's |
| CLI | Compiled binary from `bun run build` at that commit, sha256 `d48d634b31822c712a26b84f025f5e6755e42a7456af90ab97cf12292b030f90`, installed with the bundled registry beside it in a fresh prefix (no tarball: 0.2 is deferred) |
| Agent | Claude Code 2.1.311, headless (`claude -p` with the handoff prompt from `new --no-launch --json`), launched by the agent running the gate |
| Brief size | `briefWords` 4753, `fixedWords` 866 |
| Times | first passing `test`-layer step 5.1 min, first green `verify` 5.1 min (target 20) |
| Verify count | 2: the agent's own run, then the independent one |
| Interventions | None. `## Asked` is empty, no permission prompt was denied, and nothing was typed after the prompt |
| Outcome | `green`, `tamperCheck: "full"` (independent `verify --json` exit 0; `build` skipped by the sandbox preset, which `--all` would run) |
| Agent minutes | 5 (43 turns, $0.99) |

## How it ran

Same method as the [go-cli run](2026-10-27-go-cli.md#how-it-ran) on this date: fresh
directory, `HOME` and `XDG_*`, the login token passed by environment only, project and
local settings only, no MCP servers, `acceptEdits` with the standard tool allow list, an
allowlisted environment. The transcript audit found no tool path outside the run and no
command naming another checkout.

## Deliverables check

- `make e2e` runs the Playwright smoke "home page shows the API health" against both dev servers and passes.
- The independent verify ran both serve steps (`api`, `web`) and the `api-contract` check green.
- No `stacks:fill` is left in `AGENTS.md`, `README.md` or `.claude/README.md`.
- CI triggers on `master`, the branch the repository is on, and `make typecheck` covers `backend/scripts/`.

Nothing is missing.

## Findings

From this run, none needs a brief change. Each is a version or generator-flag detail the agent resolved from the tools themselves, which is the agent's job under "Product to preserve" (versions and generator flags age):

- `uv init` needed `--bare` and a hand-written `.python-version` for the brief's unpackaged layout.
- orval 8 and msw 3 renamed options (`hooks.afterAllFilesWrite`, `onUnhandledFrame`); the brief's ajv gotcha held.
- typescript-eslint rejects TypeScript 7, so the agent pinned `^6`, as the brief's version gotchas anticipate.
- One of the agent's own chained commands ran `bun install` in the repository root; it moved the files back and removed the stray lockfile and `node_modules`.

From earlier runs of this stack, each fixed before this one:

- Run 1: edits to `lefthook.yml` and `.claude/README.md` were denied. Fixed: agent-ops says which edits need the user and to ask once, at the end.
- Runs 1 and 2: the error envelope's casing, `dump_openapi.py` run as a script (it can't import `app`), Prettier reaching `.claude/`, and eslint warning on ignored staged files. All fixed in the brief and the git-hooks fragment.
- Run 3: the shipped Makefile still ran `dump_openapi.py` as a script. Fixed.
- Run 4: CI triggered on `main` while the repository is on git's default branch, and mypy skipped `scripts/`. Fixed.
- Run 5 was green but ran a binary built before the 2.0a and 3.5b merges, so this run repeats it on the current CLI.

## Run record

Final verify record (the independent run):

```json
{"schemaVersion":1,"at":"2026-10-27T06:11:09.368Z","cli":"0.1.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":6095,"secondsSinceCreated":321,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":95},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":35},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":838},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":1407},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":2039},{"name":"api-contract","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":260},{"name":"build","phase":"check","layer":"build","status":"skipped","durationMs":0},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":21},{"name":"git-hooks-configured","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":4},{"name":"api","phase":"serve","layer":"serve","status":"passed","durationMs":749},{"name":"web","phase":"serve","layer":"serve","status":"passed","durationMs":631}]}
```

`.stacks/NOTES.md` as the agent left it:

```markdown
# Notes

## Findings

- `uv init` defaults to a packaged project (src layout, build backend); `--bare --python 3.14` plus a hand-written `.python-version` was needed for the unpackaged layout.
- Brief says `uv init` writes `.python-version`; `--bare` doesn't, so it was written by hand.
- orval 8 config differs from what the brief implies: no `prettier` output option (use `hooks.afterAllFilesWrite`), `mock` needs `generators: [{type: "msw"}]`, and wrapper-free hooks need `override.fetch.includeHttpResponseReturnType: false`.
- msw 3 has no `onUnhandledRequest`; the option is `onUnhandledFrame: "error"`.
- The ajv gotcha in the brief happened exactly as described.
- typescript-eslint rejects TypeScript 7, which bun resolved by default; pinned `^6`.
- shadcn init (radix-nova) produced `app/lib/utils.ts` re-exporting `cn` from the `cn` package rather than clsx + tailwind-merge.
- A chained `mkdir ... && cd` failure on my side ran bun installs in the repo root; moved package.json to `frontend/` and removed the stray root `node_modules`/`bun.lock`.
- Brief's Makefile `frontend-coverage` (`bun run test --coverage`) works as is.

## Asked
```

Maintainer confirmation: _open_.
