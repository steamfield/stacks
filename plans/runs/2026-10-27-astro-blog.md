# Gate run: astro-blog, 2026-10-27

Phase 1.6b gate run for `astro-blog`, run 6 of this stack (earlier runs are in the
[1.6b rerun log](../archive/phases/phase-1.6b-mvp-gate-runs-2026-10-30.md#rerun-log)). It passes the gate rule
as written, pending the maintainer confirmation the plan requires.

| Field | Value |
|---|---|
| Stack and fragments | `astro-blog` with `agent-ops`, `ci-github`, `git-hooks`, `posthog`, preset `sandbox` |
| Repo commit | `e6f5da2`. The next commit removes one sentence from posthog's astro-blog block (a `window.posthog` stub queue that contradicted the module's own buffer); this run's agent had already skipped it for that reason, so the release brief describes what this run built |
| CLI | Compiled binary from `bun run build` at that commit, sha256 `d48d634b31822c712a26b84f025f5e6755e42a7456af90ab97cf12292b030f90`, installed with the bundled registry beside it in a fresh prefix (no tarball: 0.2 is deferred) |
| Agent | Claude Code 2.1.311, headless (`claude -p` with the handoff prompt from `new --no-launch --json`), launched by the agent running the gate |
| Brief size | `briefWords` 3741, `fixedWords` 857 |
| Times | first passing `test`-layer step 2.7 min, first green `verify` 2.7 min (target 20) |
| Verify count | 2: the agent's own run, then the independent one |
| Interventions | None. `## Asked` is empty, no permission prompt was denied, and nothing was typed after the prompt |
| Outcome | `green`, `tamperCheck: "full"` (independent `verify --json` exit 0; `build` skipped by the sandbox preset, which `--all` would run) |
| Agent minutes | 2 (23 turns, $0.49) |

## How it ran

Same method as the [go-cli run](2026-10-27-go-cli.md#how-it-ran) on this date: fresh
directory, `HOME` and `XDG_*`, the login token passed by environment only, project and
local settings only, no MCP servers, `acceptEdits` with the standard tool allow list, an
allowlisted environment. The transcript audit found no tool path outside the run and no
command naming another checkout.

## Deliverables check

- `make build` writes the index, the published post, `404.html`, `rss.xml` (one item) and a sitemap with two URLs.
- The draft sample post is in no output: not built, not in RSS, not in the sitemap.
- Canonical URLs come from the route (`https://example.com/hello-world`, no `.html`).
- The independent verify served the site (`web` serve step) green.
- No `stacks:fill` is left in `AGENTS.md`, `README.md` or `.claude/README.md`.
- CI triggers on `master`, the branch the repository is on.

Nothing is missing.

## Findings

From this run:

- The posthog fragment told astro-blog to expose a pre-init queue as a `window.posthog` stub while also making one module the SDK's only owner, with its own buffer. The agent kept the module's buffer. Fixed after this run: islands import `track()` from the module, and the stub sentence is gone.
- `astro check` rejected TypeScript 7, so the agent pinned `typescript@6`, as the brief's gotcha says.
- The og-images dependencies were left out because that decision defaults to off. Working as designed.

From earlier runs of this stack, each fixed before this one:

- Runs 1 and 2: `.claude/README.md` edits were denied, failing `claude-readme-filled`; `bun create astro` swallowed `--yes`; Testing Library's `dom` peer and the test types were missing; Prettier reached `.claude/`. Fixed: agent-ops says which edits need the user, the stack ships allow rules for its make targets, and the brief names `create-astro`, the peer, the types and the ignore.
- Run 3: canonical and OG URLs ended in `.html` under file-style output, and tests that reached `astro:content` failed under happy-dom. Fixed: URLs come from the route, and `lib/collection.ts` is the only `astro:content` import.
- Round 4: CI triggered on `main` while the repository is on git's default branch. Fixed.
- Run 5: the brief named the `getX()` getters as exports of the pure `posts.ts`, and the agent tried to allow `make new-article` by editing `.claude/settings.json` from the shell (denied). Fixed: `posts.ts` exports `publishedPosts(entries)` and `routablePosts(entries, dev)`, `collection.ts` wraps them, and the stack allows `make new-article *`.

## Run record

Final verify record (the independent run):

```json
{"schemaVersion":1,"at":"2026-10-27T06:06:42.502Z","cli":"0.1.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":7709,"secondsSinceCreated":179,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":101},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":62},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":479},{"name":"check","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":4881},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":842},{"name":"build","phase":"check","layer":"build","status":"skipped","durationMs":0},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":6},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":6},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":6},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":26},{"name":"git-hooks-configured","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":6},{"name":"web","phase":"serve","layer":"serve","status":"passed","durationMs":1291}]}
```

`.stacks/NOTES.md` as the agent left it:

```markdown
# Notes

## Findings

- Brief says TypeScript may lag `astro check`: true, TS 7 was rejected; pinned `typescript@6` (see AGENTS.md Build workarounds).
- Brief says expose the pre-init queue as a stub on `window.posthog`; I used the module's own buffer instead (no stub), since the module alone owns the SDK.
- OG decision is off, so I removed the og-images packages (satori, resvg) from the install.
- `astro add` also added `@astrojs/markdown-satteri` to dependencies; left as is.
- Brief lists `.claude/README.md` fill row with no other hooks to document; deleted the row.

## Asked
```

Maintainer confirmation: _open_.
