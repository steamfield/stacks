# Changelog

All notable changes to `@steamfield/stacks`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html); before 1.0.0 a minor release may break compatibility.

## [Unreleased]

### Fixed

- `verify --only`, `verify --skip-tag`, and `validate --brief` with `--with` or `--without` trim spaces around comma-separated items and ignore blank items.
- If `--skip-tag` excludes a normally skipped base check selected with `verify --only`, verify reports a partial base and skips the app stage.
- The OpenCode plugin from `agent-ops` no longer hangs a tool call on Linux when a guard crashes, is missing or exits without reading its input. It ran each hook through Bun's shell with the payload as a `<` redirect, which never returned in about one run in ten when the hook didn't read stdin; it now spawns the hook directly.

## [0.14.1] - 2026-11-16

### Fixed

- `runs` text output rounds its timings to one decimal, so "Minutes to last green" no longer prints a long fraction. `--json` keeps the exact minutes.

## [0.14.0] - 2026-11-16

### Added

- The `new` brief's After green asks the agent to review its diff before committing: with Claude Code it runs the `reviewer` agent from `claude-harness-docs`, otherwise it reviews against `AGENTS.md` and the project's guidance, then reruns `stacks verify --all`. Start here's last step points to After green.
- `show` lists an entry's payload variants (`Payloads: example (default), none.`) with a hint for `--payload none`, and labels each payload file. JSON adds `payloads` and a `payload` field on those file rows.
- `runs` reports "Minutes to last green" (`minutesToLastGreen`): scaffold to the last full green verify, which includes review-and-fix work after the first green. "Minutes to green" is unchanged.
- `typescript-library` guidance covers untrusted input: own properties only, caller-chosen keys written only into null-prototype objects or a `Map`, explicit handling of sparse arrays and non-plain objects, bounded depth and size, and caller-supplied defaults cloned per call, with a hostile-input test table.

### Changed

- `validate` holds only each stack's default composition to the composed brief budget. Compositions that add optional fragments or apps are still composed and checked for conflicts, warnings and verify layers, but get no size row or budget finding; a `--brief` preview with `--with` or `--without` prints its size without one.
- `typescript-library`'s Claude rules state their constraints inline (public API, types, errors, runtime boundaries, untrusted input, testing and done) instead of only pointing at the guidance docs, and its `add-export` skill adds hostile-input tests and a review step.
- The shared `reviewer` agent reads the guidance docs the matching rules link to, skips checks the project has nothing for (a library has no env config or status codes), checks caller data and shared defaults, and says what to review before the first commit.
- Scaffolds' Claude docs say the lint and typecheck hooks speak only when they find a problem, and that silence can also mean the linter couldn't run.
- The authoring guide says a path-scoped rule states its constraints inline and never `@`-imports a doc, because Claude Code loads an imported file at session start whatever the rule's `paths` say.

## [0.13.0] - 2026-11-16

### Added

- `validate` warns with `example-hedged` when a search card's project example reads as build steps or a disclaimer ("illustrative", "separately", "replace the" and similar) instead of describing the finished project. The bundled registry must stay free of it.

### Changed

- Every bundled search card's project examples now describe a project someone would build, as its users would see it, rather than telling the reader what to implement or what is left to do. `plain` copy was checked against each entry's files and corrected where it was wrong. Search ranking is unchanged.

### Added

- Every scaffold ships `docs/guidance/engineering/`: testing, architecture, error handling and readable code (file-level doc comments, a README where a folder is a real part of the architecture), condensed from the claude-essentials skills so every agent has them from its first session. AGENTS.md carries the binding rules, and Claude Code and Cursor get rules that point at the docs when they touch source files.
- `code-docs`, a fragment whose `file-headers` hygiene step fails on a source file without a file-level doc comment, and which asks for a README in each folder that is a meaningful part of the architecture. It is a default of `typescript-library`, `typescript-mcp`, `typescript-cli`, `hono-api`, `react-vite`, `astro-fullstack` and `tauri-react`, and optional for `typescript-api`; every fragment's shipped source carries a header.
- `ce-plugin` is a default of `typescript-library`, and its rules point at the project's engineering docs first.

### Changed

- Agent hooks deny only destructive or irreversible work (deleting the filesystem root, home or project, discarding work or history, force pushes, dropped tables, publishing, cloud deletes, a download piped into a shell, secret and `.env` writes) and commands that would hang the session. Conventions such as the test runner, `--bun`, generated files, package choices and import boundaries are guidance and lint, no longer hook denials. Every agent uses one bash rule list, and a guard that can't run allows the call with a note instead of refusing it.
- Scaffolds no longer ship hook tests: `.claude/hooks/smoke.sh` is the project's hook check, and `bun run test` runs the application's own tests. A fresh `typescript-library` runs 55 tests instead of 240.
- `typescript-library`'s setup chooses Node before installing matching types, and its guidance no longer names the example's files after the example is replaced.

### Removed

- `claude-harness`'s TypeScript command and generated-file guards, its shipped `_shell.ts`, and the `harness-hooks` verify step.

## [0.11.0] - 2026-11-15

### Added

- `decks`, a stack for slide-deck projects built with Decks (`@steamfield/decks`): MDX slides with React components, served live and built to a static site. Setup scaffolds the project's deck with `decks new` and installs the Decks agent skills (building a deck, writing slide prose, design, motion, charts and data) and the Claude Code plugin with `decks init`; verify checks both. It ships a four-slide example deck to present and copy from (`--payload none` leaves it out), with a README section on running it.

## [0.10.0] - 2026-11-15

### Added

- `npm-release`, an optional fragment for `typescript-library`: it publishes the package to npm when a `v*` tag is pushed, through npm trusted publishing with provenance and no stored token. It ships a rerunnable publish helper that waits for the registry, a version-bump script, a changelog template and tests that run the workflow's own publish step against a fake `npm`.

### Fixed

- Running a command from a directory that has been removed fails with `NotFound` (exit 2) and a next step, instead of a raw Node stack trace.
- Help text matches what the commands do: `create --from` names `index` and says why `user` is refused, the `create`, `skill` and `telemetry` groups say what they are for, and `--offline` reads true on every command.
- `agent-ops` states correctly why `CLAUDE.md` imports `AGENTS.md`.

## [0.9.0] - 2026-11-14

### Added

- The brief opens with "Start here": a short ordered list whose first step is the exact install command, spelled from the declared package names with no versions (`bun add` for single-package Bun stacks, `uv add` for uv Python stacks), then `stacks verify`, the remaining work, and `stacks verify --all` as done. The rest of the brief is reference.
- `new --preset lean` leaves out the stack's default fragments (git hooks, CI, the long-lived harness docs) for short, timed work. The manifest records `default`.
- `new --payload none` writes a stack's empty variant instead of its example; `typescript-library` ships one. Stacks without it refuse the flag.
- `new --own-repo` gives the project its own git repository inside another one, so `ci-github` and `git-hooks` stay; the `needs_own_repo` error suggests it.
- `new` fills `<!-- stacks:fill:commands -->` markers with the declared commands; `typescript-library`'s README and every stack's AGENTS.md use it.
- A nightly workflow scaffolds `typescript-library` with no edits, installs the latest releases with the brief's command and runs `verify`.
- The bundled ledger (`registry/runs.json`) accepts `scaffold` records: a zero-edit proof with no agent (scaffold, the brief's install command, `verify`), which counts as a stack's historical pass.

### Changed

- Plain `verify` runs the code checks; steps tagged `hygiene` (fill markers, the harness doc, the CI workflow, git hooks) run with `--all`, which is the definition of done. Skipped hygiene steps leave the outcome `green`.
- `claude-harness` is the hooks core; its `/check`, `/test` and `/feature` commands, architect and reviewer agents and `docs/harness.md` move to the new `claude-harness-docs` fragment, a default of every stack that had them.
- A ledger record's fingerprint covers the stack's own content and verify steps, not shared fragments, so a fragment change no longer marks every stack's historical pass out of date; the whole composition's fingerprint is kept as `compositionFingerprint`.
- `typescript-library` and `typescript-mcp` ship `"version": "0.0.0"`, and `typescript-library` adds a `@ts-expect-error` type test and its strict-flag patterns to the brief.

### Fixed

- `typescript-library` and `typescript-mcp` format `package.json` the way current Biome does, so `lint` passes on a fresh scaffold.

## [0.8.0] - 2026-11-14

### Added

- The `astro-product-site` stack: a static Astro landing page with `/docs`, generated OG images, Markdown exports and `llms.txt`.
- `typescript-library` covers libraries whose failures carry data: a subclass of `LibraryError` with a typed payload, guidance for inference-heavy APIs under `isolatedDeclarations` (TS9013 and its fix), an `expectTypeOf` type test that `typecheck` enforces, a `gate` script for the check after each change, and a note on what to delete when replacing the example.
- The `rr` fragment can queue runs on this machine under one lock instead of remote hosts, and its Claude Code adapter ships a hook that routes the project's test commands through rr, with a verify step that tests it.

### Fixed

- `typescript-library`'s `lint:package` builds before publint packs, so it and `check` pass on a tree with no `dist/`.
- `validate` no longer repeats work that grows with the registry size.

## [0.7.0] - 2026-11-01

### Added

- 27 new stacks across five languages. Go: `go-grpc`, `go-htmx`, `go-library`, `go-mcp`, `go-tui`. Python: `django`, `django-api`, `python-cli`, `python-data`, `python-library`, `streamlit`. TypeScript: `hono-api`, `nestjs-api`, `nuxt`, `react-vite`, `typescript-library`, `typescript-mcp`. Rust: `rust-api`, `rust-cli`, `rust-library`, `rust-tui`, `rust-wasm`. Java: `java-cli`, `java-library`, `quarkus-api`, `spring-boot-api`, `spring-boot-web`. Each ships a working slice of the project (source, tests, lint, format and build config, agent rules and skills) that `verify` proves from a fresh scaffold.
- The shared fragments (`ci-github`, `git-hooks`, `agent-ops` and the others a stack composes by default) have Go, Python, Rust and Java branches.
- `show` lists every dependency a stack brings, including those of its fragments.
- `search` reads `npm` as TypeScript, `cargo`, `rustlang` and `axum` as Rust, and `go library`, `go package`, `go module` and `go mcp` as Go.
- `@steamfield/stacks-mcp`, a stdio MCP server whose `stacks_list`, `stacks_new` and `stacks_verify` tools run this CLI, is published alongside it.

### Changed

- The existing stacks now ship their working proving slices instead of describing the code for the agent to write: `astro-blog`, `astro-fullstack`, `cloudflare-react-router`, `go-api`, `go-cli`, `mobile-expo`, `nextjs`, `python-api`, `python-react`, `react-router`, `sveltekit`, `tauri-react`, `typescript-api` and `typescript-cli`.
- A fragment's `applies_to` can name a tag, so a new stack carrying that tag is admitted without editing the fragment.
- `validate` warns about version literals in shipped configs rather than about the configs themselves.

### Fixed

- `verify` steps no longer inherit the CLI's own `STACKS_*` settings, `--only` runs a step that is skipped by default, and a runner that ends in a defect records no run.
- Discovery and run history fail with `PermissionDenied` on paths the CLI can't inspect, instead of reporting nothing there.
- Failed writes report every path their rollback couldn't restore, including the Codex app fallback's handoff record.
- The packaged CLI ships the registry's `bunfig.toml` files and forwards directory-read options.

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

[0.9.0]: https://github.com/steamfield/stacks/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/steamfield/stacks/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/steamfield/stacks/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/steamfield/stacks/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/steamfield/stacks/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/steamfield/stacks/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/steamfield/stacks/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/steamfield/stacks/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/steamfield/stacks/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/steamfield/stacks/releases/tag/v0.1.0
