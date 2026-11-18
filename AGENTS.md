# stacks

## Overview

A bun workspace; every package is in `packages/<name>/`. `packages/cli` is `stacks`, the CLI: Effect 4 commands/services, doctor/version, lazy configuration, safe output and logs. Bun bundles the Node ESM package; Node 24 runs Vitest. `packages/format` (`@steamfield/stacks-format`) owns the portable entry, manifest, run-record and canonical bundle contracts. There is no vendor tooling; releases are tag-driven through `.github/workflows/release.yml`, prepared by the maintainer's `bun run release <x.y.z>` ("Releasing"). The CLI works offline from its bundled registry. Its network use is all optional and best-effort (`--offline` stops every request): `search` asks the hosted API, `list` and `show` read published stats, the signed remote index and dependency allowlist are fetched only once index keys are published (`INDEX_PUBLIC_KEYS` is empty today), and telemetry posts events in a release build. Two commands need the network: `update`, with one request to the npm registry, and `submit`, which reaches GitHub only through `gh` and `git`. `packages/mcp` (`@steamfield/stacks-mcp`) is the stdio MCP server: three tools (`stacks_list`, `stacks_new`, `stacks_verify`) and the guides as resources, each running its `@steamfield/stacks` dependency's Node entry with `--json` (never PATH, never `--accept-changes`, never a launch) and returning the result. The hosted API lives in a separate private repository, `stacks-api`. Code two packages share goes in its own package, never imported across another package's `src/`. How the monorepo works and how to add a package: README.md, "Monorepo".

The root owns the harness: `.claude/`, lefthook, CI, the root `biome.json`, `tsconfig.base.json`, and the root test suite in `tests/`: the hook tests in `tests/hooks/` and the root scripts' in `tests/scripts/`. Each package owns its source, tests, `tsconfig.json` (extending `../../tsconfig.base.json`) and any Biome plugins in a nested `biome.json` (`"root": false, "extends": "//"`). See docs/harness.md.

## Repository map

| Path | What it holds |
| --- | --- |
| `packages/cli/` | The CLI: `src/` (see "Architecture map"), `tests/` (Vitest on Node), `e2e/` (Bun tests, installed Node package), `registry/` (the bundled stacks, fragments and `runs.json` ledger), `skills/` (the agent skills `stacks` and `stacks-author`), `docs/` (user docs: quick start, concepts, agents, architecture, the reference pages under `docs/reference/`, maintaining, and `authoring.md`, the one doc the package ships), `scripts/` (build, bench, ledger import), `biome-plugins/` (Grit boundary rules) |
| `packages/format/` | Portable schemas and canonical bundles: `src/` (public `index.ts`), `tests/` (Vitest on Node), `scripts/pack.ts` (published metadata and tarball), `biome-plugins/` (no platform imports). Workspace exports resolve source; build emits `dist/` JavaScript and declarations for publishing. `README.md` has the manual publish steps |
| `packages/mcp/` | The MCP server on `effect/ai`: `src/` (`config.ts` resolves the CLI entry, `run.ts::CliRunner` is the only child-process start, `decode.ts` turns CLI output into results or `CliFailure`, `handlers.ts`, `toolkit.ts`, `resource.ts`, `server.ts`; `schemas/cli.ts` mirrors the CLI's `--json` results, kept honest by `e2e/schema-drift.test.ts`), `tests/` (Vitest on Node, fixtures captured by `scripts/capture-fixtures.ts`), `e2e/` (the built server through the official SDK client and raw stdio), `scripts/` (build, pack) |
| `product/` | The problem statement (what stacks is and who it's for; kept current), plus the hackathon-era pitch, prep notes and demo outline |
| `plans/` | The maintainers' requirements, roadmap, feature requests and run notes (`plans/runs/`, which `ledger:import` reads); history, not instructions |
| `docs/harness.md` | Who owns which part of the harness |
| `tests/` | Root suite: `hooks/` (the `.claude/hooks` guards), `scripts/` (`release.ts`, `publish.ts`) |
| `scripts/` | `prepare.ts` (installs git hooks), `commit-msg.sh`, `release.ts` (`bun run release <x.y.z>`, the version bump), `publish.ts` (the release workflow's collect and publish steps) |
| `.github/workflows/` | CI (see "CI") |
| `.claude/` | The agent harness, shared by Claude Code and Codex (below) |
| `.agents/skills` | A tracked symlink to `.claude/skills`, where Codex discovers repo skills; edit the files under `.claude/skills/` |
| `.codex/hooks.json` | Codex's hooks: the Claude command guard and destructive-command guard for its Bash tool |

`.claude/` holds the harness. `settings.json` wires the hooks in `hooks/` (command guards, boundary and secret guards, lint and typecheck on write, format on stop; `.claude/README.md` lists each), which run for Claude Code only. `rules/` holds path-scoped guidance Claude Code loads automatically: `architecture.md` and `agent-ops.md` always, `typescript.md` for TypeScript, `cli/` (`cli.md` the UX contract, `comments.md`, `effect.md`, `testing.md`, `verification.md`) for `packages/cli`, `format/format.md` for `packages/format`, `mcp/effect.md` for `packages/mcp`. Codex doesn't load `rules/`; read the ones covering the files you change, and a delegate contract names them. Effect 4 guidance is the `ce:effect` skill from the `claude-essentials` plugin (Claude Code and Codex both install it), with `rules/cli/effect.md` as this CLI's policy on top. `delegate.md` is this repo's overlay on the personal `codex-delegate` skill (the orchestrator's Codex workflow), and `delegate/` holds the repo's contract templates. `skills/` holds `stack-authoring` and `fragment-authoring` (naming, descriptions and search cards for registry entries; `stack-authoring/search-card.md` is shared by both). `agents/` holds `architect.md` (design review), `code-reviewer.md` (the one code review of a diff, run by Claude Code as an agent and by Codex delegates as a prompt) and `stack-creator.md` (adds or revises one registry entry and its search card). `commands/` holds the slash commands `/check`, `/test` and `/feature`; `/execute:codex` is personal, alongside the skill. `settings.local.json` and `worktrees/` are gitignored; delegate and unit worktrees live under `.claude/worktrees/`.

## Planning

[product/PROBLEM_STATEMENT.md](product/PROBLEM_STATEMENT.md) says what stacks is for; check a design against it. A design or task comes from the maintainer as a description. A rule that outlives the task goes in the file that owns it: AGENTS.md, `.claude/rules/`, or the user docs under `packages/cli/docs/`.

## Commands

Root commands run from the repo root and fan out to every workspace package (`bun run --filter '*' <script>`); preserve the runner split. In a clone opted in to rr, an agent runs the whole-suite scripts (`check`, `test`, `test:hooks`, `test:unit` without a file, `coverage`, `e2e`) through rr instead, and the command guard denies them locally ("Test runs" below).

| Command (repo root) | Purpose |
| --- | --- |
| `bun install` | Install every package's dependencies and the lefthook hooks |
| `bun run install:ci` | Frozen dependency install |
| `bun run dev <command> [args]` | The CLI from source with local logs and data (`bun run dev doctor --json`; output is unprefixed, so `--json` stays parseable). `bun run dev <command> --help` documents every flag, argument and exit code |
| `bun run build` | Build every package (the CLI bundles `packages/cli/dist/cli.mjs` with the `dist/stacks` Node entry) |
| `bun run typecheck` | Root harness tsc, then each package's |
| `bun run lint` | Biome over the whole repo, with each package's nested plugins (formatting is off for the Prettier-formatted stack trees `packages/cli/biome.json` lists) |
| `bun run format` | Safe fixes and formatting |
| `bun run test` | Root tests (hooks and root scripts), then each package's tests |
| `bun run test:hooks` | Root tests only: `tests/hooks/` and `tests/scripts/` (Vitest on Node) |
| `bun run coverage` | Each package's coverage |
| `bun run e2e` | Each package's end-to-end checks |
| `bun run check` | Lint, typecheck, test, e2e: the gate |
| `bun run clean` | Each package's generated output |
| `bun run prepare` | Install hooks outside CI |
| `bun run release <x.y.z>` | Prepare a release, never publish it ("Releasing"): bumps every version location, regenerates the brief digests and `bun.lock`. Refuses a dirty tree, a branch other than `main`, an existing tag, a version not newer or a missing changelog section. Never commits, tags or pushes |

In `packages/cli/` (run there):

| Command | Purpose |
| --- | --- |
| `bun run test:unit tests/cli.test.ts` | Single test file |
| `bun run test:watch` | Watch Vitest tests |
| `bun run pack` | Build, pack with Bun, preserve registry dotfiles, and write the tarball's sha256 under `dist/pack/` |
| `bun run build:index --out <dir> --previous <url\|none> (--key <path> \| --unsigned [--include-unproven])` | Build the proven registry index; unsigned development builds may include unproven stacks and every bundled fragment. `--check <base-url>` verifies a served signed index and all its bundles. A stack or fragment without a current proof keeps its previous entry ("stale proof"); `STACKS_INDEX_PUBLIC_KEYS` (JSON `[{keyId, publicKey}]`) adds trusted keys for `--previous` |
| `bun run e2e` | Pack, install offline, then bun test ./e2e against the installed Node package |
| `bun run human -- <args>` | The Node bundle in human mode (pseudo-terminal, agent markers removed); `new` and `add` need `--no-launch` |
| `node dist/stacks --version` | Bundled version |
| `node dist/stacks doctor --json` | Packaged local diagnostics |
| `bun run check` | This package's gate only |

## Test runs

Iterate on scoped tests: the test files or `-t` filter covering what you changed (`bun run test:unit tests/<file>.test.ts` in `packages/cli`, `bunx vitest run tests/<file>.test.ts` in `packages/format`), plus lint and typecheck. Run the full gate once, as the last check before handing back or committing, and again only after a change made to fix what it found. Never run the full gate or a whole suite to check work in progress: each run holds a host for minutes and delays every other agent's gate. A delegate runs no gate at all; Claude runs it once on the delegate's work after the refactor, and the command guard denies a delegate (`CODEX_DELEGATE=1`, set by the delegate runner) every whole-suite run, local or rr.

Several agents and delegates often work at once, and parallel gates on one laptop starve each other into timeouts. A clone that has test hosts runs the full gate and whole test suites through [rr](https://github.com/rileyhilliard/rr): `.rr.yaml` runs the task on the first free host (the dev machine in place, or a synced remote) under a per-host lock, so concurrent runs queue. All worktrees share one remote copy per host.

rr is opt-in per clone and off by default: `git config stacks.rr true` turns it on (stored in the clone's `.git/config`, so every worktree of the clone shares it and nothing is committed), and `git config --unset stacks.rr` turns it off. Check with `git config --get stacks.rr`. Opted in, the command guard denies local whole-suite runs and names the rr task; opted out, run the `bun run` commands above. "The gate" in contracts and skills means `rr check` in an opted-in clone and `bun run check` otherwise.

| Command (repo root) | Runs |
| --- | --- |
| `rr check` | The full gate, partitioned across the hosts (about 30 s) |
| `rr check-serial` | The full gate in order on one host (`bun run check`, as CI runs it) |
| `rr test` | Root tests, then every package's tests |
| `rr test-cli tests/<file>.test.ts` | CLI Vitest tests, optionally narrowed (`rr test-cli -- -t "<name>"`) |
| `rr test-hooks` | Root tests only |
| `rr e2e` | Pack and run the installed-package e2e tests |

Output is rr's JSON phase events on stderr, then the command's own output, then a `result` event whose `details.summary` has the test counts and `details.log_file` the full log; the exit code is the command's. `rr check` prints nothing on stdout: its `result` event lists `passed`/`total` partitions, each failed partition's host, `log_file` and parsed failures, and `details.log_dir`, which holds one log per partition. Read the counts as `.claude/rules/cli/verification.md` asks. rr needs its hosts in `~/.rr/config.yaml` and a reachable SSH agent. If `rr` isn't installed, or it fails before running the command (exit 1 with an error envelope such as `SSH_AUTH_FAILED` or `HOST_NOT_FOUND`), say so and run the same `bun run` command locally; never report a local run as an rr run. A single scoped test file, lint and typecheck are cheap enough to run locally.

In Claude Code, the session-start hook exports macOS's own ssh-agent socket for an opted-in clone, because the Bash sandbox can't reach every agent socket a session inherits; rr then runs inside the sandbox. A session started before opting in picks it up on its next start or `/clear`.

## Architecture map (packages/cli)

Where each concept lives, so you can open the right file without searching. Paths are relative to `packages/cli/src/`. Terms are defined once in [the glossary](packages/cli/src/README.md); each file's header says what it owns, and the code and the user docs under `packages/cli/docs/` hold the behavior. Keep this table to one line per place: name the folder or file and its main symbols, never restate behavior the code or a doc already states.

| Where | What it owns |
| --- | --- |
| `bin.ts` | The Node entry: platform layers, `Host` facts, stdout/stderr writers, the bundled-registry filename adapter, `Foreground`, signal wiring, exit status |
| `main.ts`, `cli-usage.ts` | One invocation: runs the command, captures framework help, writes the result or envelope, logs the `command` summary; `usage` maps parser errors to `Usage` |
| `runtime.ts` | `AppLayer` (config, then Output over config and Host, then logging and Processes) and `runInvocation`, the one Effect runner |
| `cli.ts`, `commands/` | The command tree and one file per subcommand (flags, help, rendering by audience). `root.ts::root` carries `--json`; bare `stacks` prints the agent guide. `project-flags.ts` parses the shared project flags and replays them for `Running:`; `telemetry-hooks.ts` is what `new` and `add` share for telemetry |
| `config.ts`, `env-names.ts` | The only env reader: `AppConfig` (settings, paths, log settings, agent detection, `childEnv`) and `Paths`; the variable names, `AgentMarkers` and child-env strip lists |
| `constants.ts`, `build.ts` | Every default (endpoints, log settings, directories, network and cache timing), each naming its override; the Bun build defines (`CLI_BUILD`, `SOURCE_BUILD`) |
| `errors.ts`, `core/failure-guide.ts` | Tagged error classes with their exit policy, `errorTable`, the envelope and `prepareFailure`; per-tag detail lines and `Next:` text |
| `logging.ts`, `version.ts`, `invocation.ts`, `argv.ts` | Log records (`entry`); the version; `invocationFor`, the CLI spelling in hints; the two literal argv checks |
| `project-layout.ts` | Every `.stacks/` path and the starter metadata text |
| `services/` | `Output` (audience, buffering, `event`, `progress`, `live`), `Host`, `Invocation` (per-invocation exit override and rollback report), `Processes` and `Foreground`, `Tcp` |
| `platform/` | The only Node process code: spawning and process groups, the signal policy (`signals.ts`), `HttpClient` and `Tcp` (`net.ts`), terminal width |
| `schemas/` | CLI-owned shapes: settings, each command's `--json` result, verify events, persisted records. Shared contracts come from `@steamfield/stacks-format` |
| `telemetry/` | `Telemetry`: consent (`consent.ts`), the event spool, delivery, the notice and per-project links |
| `core/registry/` | The `Registry` service over ordered roots: loading, entry reads that refuse symlinks, trust (`roots.ts::localRoot`, `indexRoot`); `remote/` is the signed index (`RemoteIndex`), its verification and merge |
| `core/compose/` | Composition: fragment selection, file planning and collisions, conflicts, rendering (`composeFiles`, `NEUTRAL_VARS`) |
| `core/brief/` | `.stacks/BRIEF.md` for `new` (`renderBrief`) and `add` (`renderAddBrief`); fixed wording in `text.ts` |
| `core/scaffold/` | `new`: compose, check the target, write the files, fingerprint, manifest, state record, `git init` (`scaffold`) |
| `core/add/` | `add`: plan, write without overwriting, park conflicts under `.stacks/incoming/`, merge the manifest |
| `core/project/` | Everything that touches a project: `openProject` (the only writer, with rollback), manifest and step digests, the out-of-project state record, presets (`newPreset`, `addPreset`), template values, constant git commands |
| `core/handoff/` | Who gets the project next: `decideHandoff` (pure, trust point 3), `settleHandoff`, launchers, prompt and picker text, the launch |
| `core/verify/` | `verify`: selection (`planVerify`), the tamper check (`checkTamper`), steps and probes, the run (`runVerify`), run records |
| `core/validate/` | `validate`: `checks/` (one module per check group), `compositions/` (composed briefs, word budgets in `budget.ts`, the `--brief` preview), the report |
| `core/search/` | `stacks search`: the hosted API with local ranking and a merge; ranking itself lives in `@steamfield/stacks-format` |
| `core/list/`, `core/show/`, `core/create/`, `core/stats/` | Those commands' programs and reports; `stats/` reads published metrics |
| `core/submit/`, `core/update/` | `submit` (a draft pull request through fixed `gh` and `git` calls), `update` (the npm self-upgrade) |
| `core/deps/`, `core/allowlist.ts` | Dependency names and majors read from manifests without running code; the signed dependency allowlist |
| `core/text/`, `core/fs/`, `core/object.ts` | Pure helpers: slug, shell quoting, wrapping, `shownPath`, `closest`; canonical JSON and atomic file replace; `defined()` |
| `core/*.ts` | Single-file programs: `doctor`, `guide` (agent guide text), `ledger` (`registry/runs.json`), `fingerprint`, `runs`, `skill`, `template`, `prompting` (the pickers), `result-schemas` (`stacks schema`), `cached-fetch` |

Outside `src/`: `registry/` holds the bundled stacks and fragments, their search cards, dependency cards, `runs.json` and `allowlist.json`; `skills/` the agent skills `bin` resolves as `Host.skill`; `plugin/` the Claude Code plugin's copies of them; `scripts/` the build, pack, maintainer bench (`bench.ts`), proofs (`prove.ts`), ledger import, search drafting (`decorate.ts`) and index publishing (`index/`); `tests/helpers/cli.ts::runCli` runs the real command tree.

`packages/format/src/` owns every shared wire contract, exported from `index.ts`: the entry format (`entry.ts`), manifest, run record, canonical bundle and file layout (`bundle.ts`, `layout.ts`), index, search ranking (`search/`), stats, telemetry, allowlist and dependency cards.

## Conventions

Use namespaced Context.Service classes, static layer factories and fresh per-invocation state. No globals/caches across runs. Core uses Effect FileSystem/Path and remains unchanged under Node. Only bin/explicit adapters may use Bun; only `bin.ts` and `src/platform/` use Node process APIs (`process.kill`/`on`/`exit`, `node:child_process`, `@effect/platform-node`); everything else runs processes through `Processes`. Only config reads env: a child's whole environment comes from `AppConfig.childEnv` (nothing inherited), and `Processes.which` is the only PATH search, over the captured PATH. No direct console or stdout writes in application logic. Output has three audiences, resolved once per invocation by `services/output.ts::resolveAudience`: `json` with `--json`, `human` only when stdout is a terminal, `AppConfig.agent` is `"none"` and `CI` is unset, `agent` otherwise (the default: an agent's shell, a pipe, CI). Audiences never behave differently; commands only render by `Output.audience`, and agent text drops what an agent doesn't need (rules/cli/cli.md, "Three audiences"). Grit and adapter guards enforce platform/schema/env/output boundaries. `core/` and `services/` never import `platform/` or `commands/` (one allowance: `services/processes.ts` imports `platform/process.ts`) and use no Node builtins except `node:crypto` for digests (`project/manifest.ts`, `fingerprint.ts`, `search/digest.ts`), `node:util` in `services/output.ts`, `node:os` in `config.ts` for the home-directory fallback and `node:fs/promises` for the writer's atomic `rmdir` (`project/writer.ts`, since Effect's `FileSystem.remove` can't remove only an empty directory). The root `biome-plugins/no-cross-package-imports.grit` rejects imports into another workspace package's `src/`, `scripts/` or `tests/` and its private subpaths; computed `import()` specifiers aren't checked.

Strict TypeScript 7: unchecked indices, verbatim modules, erasable syntax, explicit Bun/Node types and no emit. Biome: two spaces, double quotes, width 100, recommended rules and explicit type imports/exports. Structure rules are errors: cognitive complexity at most 15 per function, no nested ternaries, at most four parameters (pass an options object); only the registry's shipped files are exempt. Split an over-limit function into named steps rather than suppressing the rule. Prefer current patterns and dependencies; keep changes scoped.

## Code structure

Lint catches size; these are the placement mistakes it can't, each found in review here, with the fix.

- A fallback beside a service field. A default path or value computed next to a `Host` or config field (from `import.meta.url`, say) hides a missing input and breaks in the packaged bundle. Make the field required, set it in `bin.ts`, and give tests their value in `tests/helpers/cli.ts`.
- A shared helper left in its first user's module. When a second command needs a helper from `commands/new.ts`, move it to the module named for its concept (as `core/handoff/run.ts` holds the flow `new` and `add` share), not an import from the other command.
- A growing `Effect.gen` body. A new case gets a named step (a function returning an Effect, or a small pure function) called from the body, not another branch inline. The body reads as the command's sequence of steps.
- Registry-wide work on a per-entry path. A command that needs one entry or composition reads and checks only that one; whole-registry passes belong to `validate` of a registry and to tests. Ask how the cost grows with the registry.
- Options nobody asked for. A parameter, flag or abstraction with one caller and no plan behind it is removed, not documented.
- A wide function signature. More than four parameters, or several of the same type in a row, becomes one options object with named fields.
- An import against the grain. `scaffold/` depends on `brief/` and `compose/`, never the reverse, and `core/template.ts` and `core/text/slug.ts` serve all three. A core directory whose modules share types keeps them in its own `types.ts`, so its modules import one way and no type-only cycle forms. No lint rule enforces either.

## Schemas

The CLI's `src/schemas/` holds its own shapes: settings (`config.ts`), one file per command's `--json` result, the ledger, the remote-index status and the telemetry notice; `packages/format/src/entry.ts` owns entry frontmatter schemas. Schemas share their type name. Decode unknown input at boundaries; encode reports for output. Config rejects excess properties. Use branded ids when adding domain ids, `Schema.optionalKey` (absent, never `undefined`) for optional fields, Schema.TaggedError for errors, and Schema.toJsonSchemaDocument with onExcessProperty:error for closed external JSON schemas. Keep framework validators; do not add @effect/schema or competing validators.

## Testing

`tests/helpers/cli.ts` invokes the real command tree with real NodeServices and injected Output/Host; no module mocks. Setup isolates HOME/XDG and clears credentials before app imports. Tests cover streams, parser failures, config laziness/caching, all error mappings, scope disposal, cancellation, EPIPE, logging and sink failures. Property tests use @effect/vitest; timers use TestClock. Hook tests execute actual helpers; all Grit rules are probed on real files.

Bun tests only `./e2e` after packing. Package tests install the tarball offline and spawn its bin under Node with an environment built from scratch, including hostile local dotenv/bunfig files. They find Node through `STACKS_E2E_NODE` or PATH and require version 22 or newer. Never use unscoped bun test, --bun with Vitest, or weaken tests. A bug fix starts with a failing regression.

## Error handling

Error classes define fixed safe messages, exit policy and optional closed details. `errors.ts::errorTable` derives its rows from `errorClasses`. A new tag needs its class, an entry in `errorClasses` and a case in `failureGuide`. Expected usage/input/not-found exit 2, config 3, upstream 4, VerifyFailed/VerifyChanged 5 (read the verify report), permissions 6, interruption 130, defects 1; BrokenPipe is quiet 0. The one exit outside the table: after `new` launches an agent, the invocation exits with the agent's status (`Invocation.exitWith`, applied only when the command succeeded, so no envelope). `--json`, a detected agent, a non-terminal and any untrusted entry never launch. main observes failures/defects once and clears stdout on error, except for a keeps-result tag (VerifyFailed, VerifyChanged, ValidationFailed), whose buffered result is flushed to stdout before the envelope. BrokenPipe rule: a closed stdout or stderr while writing the result or envelope is quiet and exits 0, except after a keeps-result tag, which keeps its own exit. The outer runtime maps a pending interrupt after cleanup to `EXIT_INTERRUPTED`. `SpawnFailed` (`kind`: cwd, shell, command, resources; `errno`) is internal and outside `AppError`, so it is a Defect unless the caller handles it; a missing command under `/bin/sh -c` is a normal exit 127. Logs never serialize arbitrary cause objects or secrets; a defect is logged as its class and stack frames, without its message. Defects are not retryable.

Signals (`platform/signals.ts`): with no interactive child, SIGINT, SIGTERM and SIGHUP interrupt (finalizers run, exit 130). A second one within 1 s of the first is the same Ctrl+C delivered twice (terminal plus a forwarding wrapper) and is ignored; one 1 s or more later SIGKILLs every registered process group and exits 130 at once. SIGQUIT keeps its default action after the groups are SIGKILLed. While `Processes.interactive` runs a child, SIGINT and SIGQUIT are ignored (the terminal already gave them to the child) and SIGTERM and SIGHUP are forwarded to it. Process groups from `run`, `start` and `exec` get SIGTERM, 5 s, then SIGKILL on interruption, timeout or scope close; `run` and `exec` drain output for 2 s after exit before killing the group (`Finished.pipesHeld`). A SIGINT within 1 s of one left to the interactive child is still that child's Ctrl+C (a wrapper's late copy), and a SIGTERM or SIGHUP forwarded to the child stops the CLI with 130 once the child exits. Process groups leave the `Foreground` registry once seen gone and only registered groups are signaled. A closing scope sends SIGTERM to all of its groups at once, so they share one grace period. A `process.on("exit")` handler SIGKILLs any group still registered.

A tag may carry an optional closed `details` struct (`Schema.optionalKey` on its TaggedError fields), holding only CLI-produced values or caller arguments. Construction drops keys the schema doesn't name. `errors.ts::prepareFailure` encodes details per tag with `onExcessProperty: "error"`. If details fail to encode, `main` reports `Defect` (exit 1). `Output.error` takes the `PreparedFailure` returned by `prepareFailure`. Details go only in the envelope, `{ error: { tag, message, retryable, next?, rollback?, details? } }` (`errors.ts::ErrorEnvelope`, printed by `stacks schema error`); human and agent output print the message, then the lines `core/failure-guide.ts::failureGuide` picks, indented, then `Next:` with the same text as the envelope's `next`. `rollback: { incomplete }` appears only when a failed write's rollback (`project/writer.ts::openProject`, `project/state.ts::replaceProjectState`) couldn't restore some paths; the tag, message and exit stay the primary failure's, and text modes print those paths on a line before `Next:`. Every tag but BrokenPipe has a next action; a keeps-result tag's report carries its own `Next:` line, so text modes don't repeat it. Details never enter the message or a log record. Parser failures (unknown subcommand, unknown flag, rejected value, missing argument) are all `Usage`, with closed details and up to three suggestions from `core/text/suggest.ts::closest`; `cli-usage.ts::usage` owns the mapping, and `stacks schema error` prints each shape. A keeps-result failure whose result couldn't be written (non-EPIPE) keeps its exit, and the command log record gets `result: "unwritten"`.

Streams: JSON commands produce one result on stdout, and a JSON failure ends stderr with one envelope. Only human mode writes log lines to stderr; JSON and agent modes log to the `STACKS_LOG_FILE` file only, so an agent's stderr holds the failure, its `Next:` line and the short live lines `Output.event` writes. `.claude/rules/cli/cli.md` ("Three audiences" and "What good agent-facing UX means here") owns the rest of the stream, color and progress policy. Terminal facts (`Host.stdinIsTTY` and the rest) come from `bin.ts`; core never reads the streams.

## Debugging

Read packages/cli/logs/cli.log and packages/cli/logs/cli.jsonl. Development data stays under packages/cli/.dev/data. Use LOG_LEVEL=debug for detail. The session hook reports Bun mismatch and only newly added warning/error lines. Shared session-start can advise about absent .env; this base intentionally works without it.

After two unsuccessful fixes with no new diagnostic, stop and investigate other hypotheses. Read errors before guessing; do not swallow defects or report success after failure.

## Git hooks

Install lefthook on PATH (e.g. brew install lefthook), then bun install. Pre-commit formats/checks staged code/config and restages safe fixes. Commit-msg requires Conventional Commits, allowing merge/revert/fixup/squash forms. Pre-push runs lint and typecheck in parallel; tests are left to the gate and CI while development moves fast. Never bypass hooks with --no-verify.

## CI

.github/workflows/ci.yml runs on ubuntu-latest only (macOS runners cost too much) for main pushes, PRs and manual runs: a sequential `check` job (lint, typecheck, root tests, the other packages' coverage, e2e) and `cli-tests`, the CLI's Vitest coverage in four `--shard` jobs, then `ci-ok`, which passes only when both did; contents:read only. Tests whose meaningful branch is macOS-only carry `(macOS)` in their name; lefthook's pre-commit runs them on a Mac (`bun run test:macos` in `packages/cli`), and a test that can't pass on Linux is `test.runIf(process.platform === "darwin")`. Bun comes from packageManager, Node from .node-version. Frozen install, lint, typecheck, coverage, binary e2e; upload each package's logs/coverage on failure. Required check: ci-ok. Upgrade official action tags after checking upstream; SHA pins are deferred, except in `release.yml`, which has `id-token: write` and pins every action by SHA with its tag in a comment. Dependabot (`.github/dependabot.yml`, weekly, 7-day cooldown, one group) moves those pins.

## Releasing

CI publishes; agents never run `npm publish`, and the workflow deploys nothing (production is stacks-api's). A `v*` tag runs `.github/workflows/release.yml` as three jobs. `verify` checks the tag equals `v` plus `packages/cli`'s version and that its commit is on `main`, then runs `bun run check`; `build` packs and uploads the tarballs; they run in parallel. Then `publish` runs one release at a time (concurrency group `npm-publish`) and is the only job with `id-token: write`: `scripts/publish.ts` publishes format, CLI, MCP with provenance through npm trusted publishing (OIDC; no token exists). It looks every version up first, skips one already on npm with the same integrity, and stops on different bytes. Rerunning a failed `publish` reruns only that job against the uploaded tarballs, so it publishes the bytes that were built. To cut `X.Y.Z` from `main`:

1. Add `## [X.Y.Z] - YYYY-MM-DD` to `packages/cli/CHANGELOG.md` (the one allowed dirty file). Bump `packages/format`'s version in its own commit first when its contract changed.
2. `bun run release X.Y.Z`, then the gate, then `git add -A && git commit -m "chore(release): X.Y.Z"`.
3. `git push origin main`. After that commit is on `main`, `git tag vX.Y.Z && git push origin vX.Y.Z`; a tag before the bump commit fails the version check and leaves a stale tag.
4. `gh run list --workflow Release`, `gh run watch <id> --exit-status`, then `npm view @steamfield/stacks-format version dist.integrity`, repeated for `@steamfield/stacks` and `@steamfield/stacks-mcp`.
5. Put it live. npm alone changes nothing on stacks.steamfield.io: the signed index, search and API come from stacks-api's container, and every page from its `stacks-web` Worker. When the maintainer asks you to release, do this yourself; running stacks-api's documented commands from here is fine, while editing its code belongs in a session there. In the stacks-api checkout, `bun run prod:deploy -- --ref vX.Y.Z --dry-run`, then the same without `--dry-run`. Then rebuild the Worker: check its last Workers Builds outcome, and start a build of stacks-api's `main` (a push there, or its Workers Builds trigger through the Cloudflare API or `wrangler`). A step stacks-api's docs describe as a dashboard click is still yours when a CLI or API can do it. Finish when `https://stacks.steamfield.io/stacks/<new-id>/` returns 200 for an entry the release added.

Recovery: fix the cause and `gh run rerun <id> --failed`. Never move or reuse a published version; bump and tag again. A bad tag is deleted by the maintainer (`git push origin :refs/tags/vX.Y.Z`); an agent hands over that command and never runs it. The Actions tab's manual run (from `main`) publishes the format package alone, for a format version the hosted API needs before a CLI release. Each package needs `steamfield/stacks` and `release.yml` as its Trusted Publisher on npmjs.com, with "Allow `npm publish`" ticked (without it npm answers the OIDC publish with a misleading 404). Every npm call has a timeout, and `npm view` retries registry 429/5xx, timeouts and network drops with jittered backoff (never auth errors or a 404, never `npm publish`). The registry takes minutes to show a new version (3 to 5 for MCP, 8 to 13 for the CLI), so `scripts/publish.ts` waits up to about 20 minutes for format and the CLI to show before it publishes the package that pins them, and treats an E409 as published: expect a run of 25 to 40 minutes. If the last package, MCP, is still not visible when its wait ends, the run passes with a warning annotation; check `npm view @steamfield/stacks-mcp version` a few minutes later.

## Build workarounds

No patches, pinned prereleases or disabled rules. Every shared dependency version lives once, in the root `workspaces.catalog`; packages depend on `catalog:`. Effect packages resolve together at stable 4.0.6 with compatible 4.x ranges, Vitest/coverage 5.x. The generated type config targets current TypeScript 7. Bun builds one minified Node ESM bundle without a sourcemap. The entry refuses Bun and Node below 22 before importing it. Packing escapes registry `.gitignore` and `bunfig.toml` assets as `<name>.stacks` because packers and npm installers drop the literal names (the list is `packages/cli/scripts/packaging.ts::DROPPED`); bin's filesystem layer restores the logical name only inside the bundled registry.

The shipped dev wrapper was adapted to forward directly delivered SIGINT/SIGTERM/SIGHUP, with a reproducing subprocess test. Reassess/remove local adaptation when upstream provides equivalent signal forwarding. Biome stdin suppresses useful plugin diagnostics, so boundary tests use actual temporary files; no Grit rule was removed.

## Deferred

A scheduled canary that takes each bundled stack to a green verify, and SHA-pinned CI actions outside `release.yml`.

## Delegates

Claude Code orchestrates; Codex takes the coding tasks Claude delegates (the personal `codex-delegate` skill and its runner, with this repo's overlay in `.claude/delegate.md`). A delegate is trusted like Claude Code and works in its own worktree from a contract file with full access (network, `bun add`, git). It leaves its changes uncommitted and doesn't push, because Claude reviews, refactors and commits them, and it keeps to the contract's scope. A dependency it adds keeps shared versions in the root `workspaces.catalog`. Of the Claude hooks, only the command guards run for a delegate (`.codex/hooks.json` wires `.claude/hooks/guard-commands.ts` and `.claude/hooks/block-destructive.sh` for Codex's Bash tool; Codex reads the file from the main checkout, but each hook resolves from the delegate worktree's own git root, so a guard change reaches a delegate only once its branch has it). The lint, typecheck and boundary hooks don't, so a delegate runs the contract's checks itself (`bun run lint`, `bun run typecheck` and the named tests; no gate, "Test runs") and reports each result; Claude reviews, refactors and commits. `.claude/rules/` is Claude's: a contract names the rule files that apply to the task. Before handing back, a delegate runs one review in a fresh Codex process with `.claude/agents/code-reviewer.md` as its prompt.

## Pending user actions

Release pipeline, once: on npmjs.com, for each of `@steamfield/stacks-format`, `@steamfield/stacks` and `@steamfield/stacks-mcp`, Settings, Trusted Publisher, GitHub Actions, `steamfield`, `stacks`, workflow `release.yml`, environment blank, "Allow `npm publish`" ticked; then set Publishing access to "Require two-factor authentication and disallow bypass 2fa tokens". Until the three are configured the first tagged run fails at publish and a rerun after configuring finishes it.

Telemetry launch, in order (`@steamfield/stacks-format` 0.7.0 is already published; 0.8.0, which adds its `repository` field for provenance, ships with the first tagged release): deploy stacks-api with its capped-projects migration and v3 acceptance; run its smoke, POST and acceptance checks against a CLI packed with `STACKS_PUBLISH_TELEMETRY=1` from a throwaway HOME; choose the alert destination and uptime check; cut the release and put it live ("Releasing", steps 1 to 5); run stacks-api's `unseed` before the stats should read as real.

## Deeper context

README.md for usage/configuration; docs/harness.md for adapter ownership; .claude/README.md for installed hooks/commands; .claude/rules/architecture.md for product and contract constraints on any design; the `ce:effect` skill and .claude/rules/cli/effect.md for Effect.
