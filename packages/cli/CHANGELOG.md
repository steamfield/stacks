# Changelog

All notable changes to `@steamfield/stacks`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html); before 1.0.0 a minor release may break compatibility.

## [Unreleased]

## [0.6.0] - 2026-10-30

### Added

- `stacks submit <entry...>` opens a draft pull request that adds your stacks and fragments to the public registry at `steamfield/stacks`, using `gh` and `git`. `--dry-run` shows the pull request body and file list without pushing; `--query` proposes searches the entry should rank first for. A rerun updates the same pull request.
- `stacks validate <dir> --submission` adds readiness checks for a submission: leftover `stacks:fill` markers, credential-shaped strings and `.env` files (errors), and personal absolute paths and a missing search card (warnings).
- `stacks guide author [topic]` prints the `stacks-author` agent skill and its references: the entry format, converting an existing repository, designing a new stack with the user, fragments, search cards and submitting.
- `stacks skill install [stacks|stacks-author]` installs either skill with all its files.
- A Claude Code plugin marketplace in this repository: `/plugin marketplace add steamfield/stacks`, then `/plugin install stacks@stacks`, installs both skills.
- Registry entries can name the GitHub login that submitted them. `show`, `list --json` and `doctor` report it as `author`.
- Published builds report anonymous usage telemetry after the first-run notice, as described in `docs/reference/telemetry.md`. Events use schema version 3 and count the questions the agent asked in `NOTES.md`; `DO_NOT_TRACK`, `--no-telemetry` and `stacks telemetry disable` turn it off.

### Changed

- `search` ranks by evidence in an entry's strongest fields, keeps stacks you name strong, honors more ways of saying "no X", judges fragment fit only against the stacks you name, caps merged results, shows each fragment's target stacks and labels statistics that come from seeded data.
- The bundled agent skill moved from `skill/` to `skills/stacks/`.

## [0.5.0] - 2026-10-29

### Added

- `show` opens with a plain-language summary of the entry (what it is, what it's good at, an example project and what it's not good at). For a person at a terminal it also lists each app dependency with a one-line description. `show --json` carries both as `plain` and `dependencyCards`.
- `validate` checks plain-language copy against its size limits and warns about version numbers in it. On the bundled registry it also checks dependency cards against the allowlist and flags missing, duplicate, unreviewed or year-old cards.
- New stacks: `go-api`, `python-api`, `nextjs` and `sveltekit`. New fragments: `drizzle-postgres`, `effect-sql-postgres` and `effect-otlp`. `postgres` now also fits `python-api`.

### Changed

- The `astro-api` stack is now `astro-fullstack`: it builds a static Astro site and a separate Node API, which the old id didn't say. Run `stacks new astro-fullstack`. Projects created from `astro-api` keep that id in their manifest, so `stacks add` in them no longer finds the stack and reports `stack_unknown`.

### Fixed

- `update` and `update --check` under `--offline` or `STACKS_OFFLINE=1` fail with `BadInput` (exit 2) instead of requesting the latest version from npm.
- `validate --brief` with `--with` or `--without` reports a fragment that doesn't apply as a warning and exits 0, as `new` does, instead of failing with a stack error.

## [0.4.1] - 2026-10-29

### Fixed

- `search` honors negated languages and platforms ("no Python", "Python-free"), demotes scaffold stacks when you ask to add something to an existing repository, and won't call an entry a strong match for a hosting provider it doesn't serve.
- Run evidence can only break near-ties in search ranking; it no longer lifts a weaker lexical match over a clearly better one.
- `noStrongMatch` is false whenever a strong stack or fragment is shown, and a strong fragment's `Next:` line names `show` and `add` for that fragment.

## [0.4.0] - 2026-10-28

### Added

- `stacks search "<what you want to build>"` ranks stacks and fragments with match explanations, caveats and cached run evidence; `--kind` and `--limit` narrow the results. It asks the hosted API first and falls back to local ranking; `--local`, `--offline` and `DO_NOT_TRACK` keep the request on this machine.
- `list` and `show` report published project statistics when available, including green rates and time to green; `show` also reports common failing steps and the latest content change.
- Remote registry entries through `STACKS_INDEX_URL`, with checked bundles, a cache that works offline and status in `doctor --json`. No official registry URL is configured in this release; custom index entries are untrusted.
- `validate` checks search metadata and vocabulary, and `create --from` copies an entry's search metadata with its files.
- `stacks telemetry status|enable|disable|reset|flush` and the shared `--no-telemetry` flag control anonymous usage reporting, including allowlisted dependency names and installed major versions after a green verify. No default telemetry endpoint is configured in this release; collection requires an endpoint and a delivered notice, and agents cannot enable it.
- At a terminal, `new`, `add` and `create` offer numbered pickers when required arguments are missing and print the command they will run.
- Human output has color, terminal-width wrapping and live progress for scaffolding and verify; `NO_COLOR` disables color and live progress.
- `typescript-api` and `astro-api` projects gain queryable development logs, `dev:status`, log rotation and a server-status hook for Claude and Codex.

### Changed

- The guide, help footer and installed skill lead with search, review the choice with `show`, and require `verify --all` before calling a project done; when nothing fits, they point back to `list`.
- Bundled entries have search descriptions and examples, with vocabulary for requests such as Go command-line tools, terminal interfaces and mobile apps; ranking accounts for platform, language and product-kind mismatches and explains them in the request's words.
- `typescript-api`, `astro-api`, `typescript-cli`, `openrouter-chat`, `openrouter-chat-cli`, `rest-api` and `effect` ship shared guidance under `docs/guidance/` for every selected agent, with explicit acceptance documents for the stacks and chat fragments.
- Verify separately checks the API stacks' HTTP contracts, `typescript-cli`'s config and logging, `mobile-expo`'s database and auth-provider contracts, and `python-react`'s home-route component test.
- `openrouter-ai` ships an eval report contract and an independent local dry-run checkpoint; the chat fragments require it before paid evaluation.
- `list` labels a recorded pass as historical, and `runs` labels its first-test timing as the first successful test command at run completion.

### Fixed

- Unknown flags, invalid flag values and missing arguments name the command's help and offer close matches where available.
- Search returns only matching hits, says when nothing matched and retains local statistics and run evidence when an API hit has none.
- The brief keeps ignored `BRIEF.md` and `NOTES.md` in the project checkout, and partial verify failures explain that setup always runs.
- Bun-based stacks no longer declare an `install` package script that would recurse during `bun install`; `tauri-react` installs its Rust toolchain without trying to update rustup itself.
- `astro-blog` keeps both dev and preview in the foreground under agents, and `make check` refuses missing checker dependencies instead of accepting Astro's install prompt as a successful check.
- `mobile-expo`'s dev launcher refuses busy ports and stops only the processes it started, including during macOS zombie-group cleanup; auth tests use the real provider composition with SDK-boundary stubs.
- `python-react` initializes its backend without a stub script that its command guard would refuse to delete, and consistently uses camelCase `requestId` in error responses.
- Codex projects from the API stacks receive their command guards and server-status wiring, and the Effect skill lands where the selected agent can find it.

## [0.3.1] - 2026-10-27

### Added

- `typescript-api` stack: a Node HTTP API on Effect's `HttpApi`, with schema-first REST resources, tagged errors mapped through one status table, structured request logs, a platform-free core that also runs as a web fetch handler, and Claude rules, commands and guards for Effect APIs, testing through HTTP and verification.
- `astro-api` stack: a bun workspace with a shared contract package, an Effect API on Node and a static Astro site with React islands that call the API through the typed client; the API can serve the built site.
- `rest-api` fragment: resource naming, methods and status codes, request and response bodies, lists and versioning conventions for any stack tagged `api`, as a Claude rule, a Cursor rule and Codex and OpenCode skills.

### Changed

- The `effect` fragment defaults to the current stable Effect major instead of 4, and the skill it has the agent write records where to look up names for the installed release.
- `docker-deploy` works for projects that use package scripts instead of a Makefile (its verify step runs `make docker-build` or `bun run docker-build`), and covers `astro-api` with one image for the API and the built site.

### Fixed

- `react-router`'s shipped `scripts/dev.ts` no longer signals its whole process group on exit, which killed the invoking shell when it ran without job control (an agent's tool or CI). The server runs in its own process group, and `dev:stop` signals only the dev wrapper.

## [0.3.0] - 2026-10-27

### Added

- `stacks update [--check]` reports the running and latest published versions and upgrades a global npm install in place. npx and other installs get the command to run. Under a detected agent the install is refused (exit 6), and `--check` always works. A registry failure is `UpstreamUnavailable` (exit 4); a failed install is the new `UpdateFailed` tag (exit 6).

## [0.2.0] - 2026-10-27

### Added

- At a terminal with several agent harnesses installed and none configured, `new` and `add` ask which one gets the project. `--launch` also takes Copilot CLI and, on macOS, the Codex app.

### Changed

- **Breaking:** the product is `stacks` everywhere. `STACKS_*` environment variables, `~/.config/stacks` and the other stacks config, data and state directories, and the `stacks:when` and `stacks:fill` markers replace their `quickstack` forms, which are no longer read.
- **Breaking:** projects keep their brief, manifest, notes and verify state under `.stacks/`. Projects written by 0.1.0 keep `.quickstack/` and aren't found by this version.

## [0.1.0] - 2026-10-27

First release, as the npm package `@steamfield/stacks` installed as `stacks` (Node 22 or newer).

### Added

- Commands: `list`, `show`, `new`, `add`, `create`, `validate`, `verify`, `runs`, `schema`, `guide`, `skill` and `doctor`, each with `--json` output, fixed exit codes and error envelopes with a next action.
- Bundled stacks: `astro-blog`, `cloudflare-react-router`, `go-cli`, `mobile-expo`, `python-react`, `react-router`, `tauri-react` and `typescript-cli`, with 19 fragments.

[0.6.0]: https://github.com/steamfield/stacks/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/steamfield/stacks/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/steamfield/stacks/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/steamfield/stacks/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/steamfield/stacks/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/steamfield/stacks/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/steamfield/stacks/releases/tag/v0.1.0
