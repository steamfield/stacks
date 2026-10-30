# Command reference

Every command, its flags and what it does. `stacks <command> --help` prints the same flags with examples and exit codes, and every command takes `--json` for one machine-readable result. Exit codes and the error envelope are in [Output and errors](output.md).

Every command also accepts `--offline` to disable remote registry requests while using verified cached entries. `STACKS_OFFLINE=1` has the same effect. See [the cache and trust rules](configuration.md#remote-registry-cache).

Every command accepts `--no-telemetry` to skip telemetry for this invocation. `new` and `add` accept optional `--source web|docs|skill|cli|other` attribution. Published releases collect anonymous usage after a first-run notice; source builds and local packs have no official endpoint. [Telemetry](telemetry.md) describes the off switches, and the [privacy page](https://stacks.steamfield.io/telemetry) explains the policy.

| Command | Does |
| --- | --- |
| [`search`](#search) | Find stacks and fragments for what you want to build |
| [`list`](#list) | List the stacks, fragments and apps you can build from |
| [`show`](#show) | Review one stack or fragment |
| [`new`](#new) | Start a project from a stack |
| [`add`](#add) | Apply fragments to an existing repository |
| [`verify`](#verify) | Run the project's verify steps |
| [`runs`](#runs) | Show a project's verify history |
| [`validate`](#validate) | Check entries, or preview a composed brief |
| [`create`](#create) | Create or copy a stack or fragment for editing |
| [`submit`](#submit) | Open a draft pull request adding entries to the public registry |
| [`update`](#update) | Check for a newer release, or upgrade a global npm install |
| [`skill install`](#skill-install) | Install an agent skill |
| [`guide`](#guide) | Print the guide for coding agents |
| [`guide author`](#guide-author) | Print the guide to writing and submitting an entry |
| [`doctor`](#doctor) | Inspect the runtime, paths and configuration |
| [`schema`](#schema) | Print the JSON Schema of a `--json` result |
| [`telemetry status\|enable\|disable\|reset\|flush`](telemetry.md) | Inspect consent, turn collection off, rotate identity or send pending events |

## Interactive pickers

Run `new` without a stack, `add` without fragments, or `create` without an entry kind or id, and stacks asks for what's missing with numbered choices. It asks only for human output with both stdin and stdout on a terminal. Agents, `--json`, `CI`, pipes and redirected stdin get the noninteractive behavior instead: `new`, `add` and `create stack|fragment` exit 2 (`Usage`), and a bare `create` prints its help.

Type one number to pick a row. Fragment lists take several numbers separated by commas; for `new`'s optional fragments, Enter picks none. Ctrl+C quits before anything is written. After the last answer, stacks prints a `Running:` line with the equivalent command, so you can reuse it without the prompts.

## search

```sh
stacks search "an iOS health app" --json
stacks search go cli --kind stack --limit 3
stacks search "a static blog" --local     # rank on this machine only
```

`search` ranks stacks and fragments against a request in plain words (1 to 500 characters) and explains each hit. It asks the hosted API and ranks locally at the same time, falling back to local ranking when the API is unavailable. `--local`, `--offline`, `STACKS_OFFLINE=1` and `DO_NOT_TRACK` keep the request on this machine. `--kind stack|fragment` searches one kind, and `--limit` caps each list (1 to 20, default 5). It exits 0 even when nothing fits strongly. [Search](search.md) covers ranking, the result fields and the API's backoff.

## list

```sh
stacks list                 # addable fragments in a project; otherwise all groups
stacks list stacks          # one group: stacks, fragments (apps excluded) or apps
stacks list --json          # full registry, plus project context when a manifest decodes
stacks list --dir ../app    # list from another project directory
```

`list` reads the manifest in the current directory (or `--dir`). Its default text view inside a project shows fitting, unapplied fragments with their add commands; explicit groups keep their usual view. JSON keeps the full registry and adds optional `project: { stack, applied, addable }`. A corrupt, newer or unreadable manifest warns and falls back to the full view.

Each bundled or index stack in `list --json` carries `lastRun: { date, result, agent, preset, fingerprint } | null`. Bundled stacks use the latest default-composition ledger run; index stacks use the index's proof with the same output fields. Text output labels it `historical pass <date>` for a pass, `<result> <date>` otherwise, or `unproven`. Local origins and fragments have no proof. The catalog does not compare current content; use `show <id>` for the fingerprint comparison. Historical passes remain historical even when the current composition matches.

Entries come from these origins, highest precedence first:

| Origin | Root | Trusted |
| --- | --- | --- |
| `project` | `./.stacks/` in the working directory | No: a cloned repository can ship these |
| `user` | `$XDG_CONFIG_HOME/stacks/` (`~/.config/stacks/`), beside `config.json` | Yes |
| `index` | Verified cached bundles from the remote index | Yes for a signed default index; no for another `STACKS_INDEX_URL` |
| `bundled` | The registry shipped with the CLI (`packages/cli/registry/` in this repo; `STACKS_REGISTRY_DIR` replaces it) | Yes, unless `STACKS_REGISTRY_DIR` set it |

Each root holds `stacks/<id>/STACK.md` and `fragments/<id>/FRAGMENT.md`, each with optional `files/` (copied into every project) and `adapters/<agent>/` (copied when that agent is a target; agents are `claude`, `codex`, `opencode`, `cursor`). An app is a fragment with `category: app`. Files are stored under their real names, dotfiles included: `files/.gitignore` is written as `.gitignore`. An entry directory may not be or contain a symlink, and nothing past one is read. The project root and its `stacks/` and `fragments/` must be real directories (a symlinked one is skipped with a warning); the user and bundled roots may be symlinks.

The Markdown file starts with YAML frontmatter between two `---` lines, then guidance prose for the building agent. Frontmatter keys are snake_case (`schema_version`, `applies_to`, `needs_own_repo`, `requires_tools`); unknown keys, including camelCase spellings, are errors. CLI output spells the same fields in camelCase (`appliesTo`).

The same id in a higher root wins; `list --json` marks the winner's `shadows` with the origins it hides. An entry that fails to load is listed under `rejected` with a one-line error and is never silently replaced by a lower copy. An entry with a newer `schema_version` than this CLI reads is skipped with a warning, and the next root's copy is used.

## show

```sh
stacks show typescript-cli          # metadata, guidance, commands, steps, shipped files
stacks show postgres --json         # ShowReport
stacks show effect --kind fragment  # look among fragments only, for an id a stack also uses
```

`show <id>` reviews a stack or fragment without starting a process: metadata, every guidance branch, commands, verify steps and shipped output paths, including adapters for every agent. `--json` returns `ShowReport`. Bundled and index stacks receive recorded run evidence; `sameContent` compares the current composition fingerprint with that run. Other origins get `lastRun: null`.

When a search card has `plain` copy, `show` prints its definition, strengths, first project example and limits before the technical description. JSON includes `plain` and any bundled `dependencyCards` for the entry's dependencies. Human output expands application dependencies with their definitions.

### Published stats

`list` and `show` can add published project stats for bundled and index entries. `list --json` carries a flat `stats` summary per entry; `show --json` carries the full detail, including agent breakdowns and a weekly series. Text output prints one `Stats:` line. Stats are optional: a missing, unpublished or unreachable response adds no warning and doesn't change the exit.

They come from the hosted API at `https://stacks.steamfield.io`, cached under `$XDG_CACHE_HOME/stacks/stats/` with one state file per resource. A cached response is reused for 24 hours; a request has a 1,500 ms deadline, and a failure backs that resource off for ten minutes, or 24 hours after a 404. `--offline` makes no stats request. Setting `STACKS_INDEX_URL` turns stats off, because those numbers describe a different registry.

| Field or text | Meaning |
| --- | --- |
| `window`, `through`, `population` | The trailing 7 or 28 finalized UTC days, ending on `through`. The population is `stacks projects` or `seeded development data`, which text labels `seeded` beside the green-rate sample |
| `projects` | Distinct mature projects in that window, each counted once however many events it sent |
| `greenRate`, `greenRateLower`, `greenRateUpper`, `sample` | Green projects over attempted projects, its 95% Wilson interval, and the effective attempted sample behind that interval. An attempted project has a verify that wasn't blocked only by its environment; green requires a full, unchanged verify |
| `noVerifyShare` | Share of projects with no verify event. It can include projects whose telemetry was blocked |
| `medianMinutesToGreen` | Median time from scaffold to first green verify, in minutes |
| `show` step failure shares | For each named step, the share of failed runs before first green in which it failed. Text shows the three largest |
| `show` content change | The latest registry content-change marker inside the window, from the weekly series. Text prints `content changed <day>` |

A suppressed cell is `null` in `list --json`. The text line prints `unavailable` for suppressed projects or green rate and leaves out the other suppressed fields. Published counts are rounded to the nearest five, and rates and interval bounds to whole percents.

## new

```sh
stacks new <stack> [dir]    # dir defaults to the slug of --name, else <stack>; `.` is the current directory
  --with a --with b              # add optional fragments (repeatable, or comma-separated)
  --without a                    # remove default fragments
  --sandbox                      # every default, nothing deployed or released; implies --yes
  --preset default|sandbox       # the preset; --sandbox is an alias for sandbox
  --yes                          # the brief tells the agent to take each decision's default
  --agents claude,codex          # adapter targets (default: the `agents` setting, else claude)
  --name "My App"                # project_name for templates (default: directory base name)
  --author "A. Name"             # author for templates (default: setting, then git user.name)
  --dry-run                      # render and report the plan without writing or launching
  --scope acme                   # npm scope for {{package_scope}} (default: the `package_scope` setting)
  --launch codex                 # harness: claude, codex, opencode, cursor, copilot or codex-app
  --no-launch                    # print the prompt instead of starting an agent
  --json                         # one NewResult object; never starts an agent
```

`new` composes the stack, writes its files and `.stacks/` (`BRIEF.md`, `NOTES.md`, `manifest.json`, an empty `state/`, and a `.gitignore` that ignores `BRIEF.md`, `NOTES.md`, `state/` and `incoming/`), writes a state record outside the project, runs `git init` when the target isn't already inside a repository and git is on PATH, then hands off to an agent. It never runs a command from a stack or fragment.

### Presets

Set `"preset": "sandbox"` in `config.json` to default new projects to sandbox. `--preset default|sandbox` overrides the setting; `--sandbox` is a sandbox alias. Flags win, then the setting, then `default`. `--sandbox --preset default` is `Usage` (exit 2). Sandbox implies `--yes` however it was selected. `add` keeps the manifest's preset; `validate --brief` ignores the setting.

### Dry run

`--dry-run` checks the same target, composes and renders every file in memory, including the manifest, then stops before writing. It creates no directory, state record or git repository and starts no agent. Its JSON result has `dryRun: true`, `stateRecord: false`, and `written` lists the planned files; real runs have `dryRun: false`. Git, fingerprints, word counts and missing tools describe the planned scaffold. Read-only git probes and the author fallback still run. A preview's handoff is `print` with reason `no-launch`, even inside an agent session; text output ends with `Dry run: nothing was written.`. `--dry-run --launch` is `Usage` (exit 2).

### Names and template values

`--name` sets `project_name` and, when no directory is given, chooses the directory through its slug. An explicit directory stays the target. Slugs strip npm scopes, fold accents with NFKD, split camelCase and digit boundaries, then join lowercase ASCII words with dashes; names without ASCII words become `project`. `--author` overrides the `author` setting and git fallback; an explicit empty value suppresses both.

Files ending `.tmpl` are rendered and lose the suffix. The only variables are `project_name` (`--name`, else the directory's base name; control characters are refused), `project_slug`, `env_prefix`, `package_scope`, `author` (`--author`, else the `author` setting, else `git config user.name`; quotes, backslashes and line breaks are removed, and other control characters in the flag fail `BadInput`) and `year`. A token is `{{ name }}` on one line, and an unknown name fails `EntryInvalid` before anything is written. Every other file is copied byte for byte, keeping its executable bit.

### Handoff

The handoff for a real run, first match wins (the manifest's `handoff` records which, with the agent and time):

1. Run from inside an agent session (an agent marker such as `CLAUDECODE` or `AI_AGENT` is set): stdout ends with `NEXT STEP FOR THE AGENT: ...`, telling that agent to read the brief and loop on `verify`. With an untrusted entry it says `STOP` instead: show the user the entries and the brief's first section, and continue only if they confirm.
2. `--json`, `--no-launch`, stdin or stdout not a terminal, or any untrusted entry: the prompt is printed (with an example command, for a human) and nothing is launched. An untrusted entry never launches an agent.
3. Otherwise `--launch` selects a harness explicitly. Without it, the first available agent in the `agents` setting launches without asking. With none configured and available, one found harness launches immediately; several show a numbered picker after the summary. The order is `claude`, `codex`, `opencode`, `cursor-agent`, `copilot`, then the Codex app on macOS. Enter selects the first row; an invalid answer gets one retry, and EOF or two invalid answers print the prompt and exit 0. A choice isn't saved as a preference and doesn't change adapter targets. With none found, the prompt is printed. `--launch` with `--no-launch` or `--json` is `Usage` (exit 2).

Terminal harnesses receive your environment and terminal in the project directory, and stacks exits with the agent's status. Copilot CLI receives `copilot -i <prompt>`. The Codex app is detected only on macOS with `open` on PATH and `Codex.app` under `/Applications` or `$HOME/Applications`. It opens `codex://new?path=<dir>&prompt=<prompt>` and exits 0; an opener failure keeps the project and prints the prompt. The manifest records `codex-app` as `codex`, `copilot` as `other`, and an unanswered picker as `print`. If a terminal agent can't be started, the manifest's `handoff` is also rewritten to `print`.

### What `new` checks and writes

- `.stacks/manifest.json` records the stack, fragments, preset, agents and the verify steps with their digest; it is committed with the project. A manifest whose `schemaVersion` is newer than this CLI reads fails `InvalidConfig` (exit 3): upgrade stacks.
- The state record is a second copy of the verify digest at `$XDG_STATE_HOME/stacks/projects/<projectId>.json` (`STACKS_STATE_DIR` replaces `$XDG_STATE_HOME/stacks`), so editing the project's files can't hide a changed verify step. When that directory isn't writable, `new` still succeeds with `stateRecord: false`, and verify's tamper check uses the manifest only.
- The target must not exist, or be empty. A directory holding only `.git` or OS litter (`.DS_Store`, `Thumbs.db`, `desktop.ini`, `._*`) counts as empty; anything else fails `TargetNotEmpty` (exit 2).
- Inside another repository nothing is initialized, and a fragment with `needs_own_repo` is refused (`ComposeConflict`, with the `--without` flags that would avoid it). A target that is itself a repository's root is that project's own repository, so those fragments are allowed. When git fails for any reason other than "not a git repository" (a broken `.git`, unsafe ownership), nothing is initialized and the result carries a `git_unusable` warning.
- No entry may write under `.git/` or `.stacks/`, in any letter case (`ComposeConflict`, reason `reserved_path`), and two entry files whose paths differ only in case collide (`file_owner`).
- Every write is checked against the project's real path, so nothing lands outside it (`PermissionDenied`, reason `escape`). A failure or Ctrl+C removes everything `new` wrote, the state record included.
- Missing tools never fail `new`: they are listed in the result and the brief, with the `--without` flag that would drop the fragment needing one.

## add

```sh
stacks add ci-github                    # current repository
stacks add ci-github --dir ../my-project --no-launch
stacks add agent-ops --agents claude,codex --json
```

`add` applies only the requested fragments and their requirements. Existing live files keep their bytes: conflicting contributions are parked whole under `.stacks/incoming/<path>` for the agent to merge. Identical contributions are skipped; later parked JSON contributions deep-merge with the parked copy, and other contributions get numbered copies. The result and add brief list every pending incoming file, including earlier runs.

An existing manifest keeps its stack, preset, agents, accepted verify steps, and existing env and command values. Without one, `add` creates a manifest with `mode: "add"` and `stack: null`; it infers the project name from package.json, pyproject.toml, go.mod, Cargo.toml, then the directory name. `--sandbox` and `--agents` configure only a newly created manifest; contradictory values on an existing project refuse. `--yes`, `--launch`, `--no-launch` and `--json` follow `new`'s rules. Tools are looked up but never run, and `add` runs no verify steps.

Before planning, `add` performs the same tamper check as `verify`. Changed steps refuse with `VerifyChanged` (5). A manifest-only project stays manifest-only. An untrusted addition under an agent or without terminal stdin writes the new steps while keeping the previous digest baseline (`digestRecorded: false`); a person must review them and run `verify --accept-changes`. Failed or interrupted writes restore parked copies, metadata and state records and remove new files.

`add --json` returns `AddResult`: `added`, `alreadyApplied`, newly `written` fragment files, `skipped`, `mergeNeeded` with incoming paths, `missingRequired` with exact add commands, `commandsKept`, `warnings`, `missingTools`, inferred `name`, manifest and digest status, and the brief and handoff. Read `.stacks/BRIEF.md`, merge the parked contributions while preserving project choices, then run `stacks verify` over the whole project.

## verify

```sh
stacks verify                 # every step, from the project root or any directory below it
  --only lint,test                 # only these check and serve steps (repeatable or comma-separated); setup and teardown still run
  --skip-tag slow                  # leave out steps with this tag (repeatable or comma-separated)
  --all                            # also run steps skipped by default (prod steps in a --sandbox project)
  --accept-changes                 # a person only: record the steps as they are now, then run them
  --json                           # one VerifyResult object
```

`verify` finds the nearest `.stacks/manifest.json` walking up from the current directory and runs only the steps it lists, printing each command before running it. Nothing else runs.

- Phases run in order. `setup` stops at its first failure and skips the check and serve steps; every `check` step runs, so one run reports every failing check; each `serve` step is started, probed and stopped; `teardown` always runs, after a failure or a Ctrl+C too.
- With `app`-tagged steps, all base phases finish, including teardown, before the app phases start. A failed or interrupted base skips every app step, including app teardown, with reason `base-failed`. An incomplete base also skips app steps, with a reason explaining that the app stage waits for a full verify. A stage interrupted by Ctrl+C still tears down; a base interruption never starts the app. Results and run records include `stages: { base, app }` only for these projects, and both text audiences print their outcomes before the summary. `app` is `null` when it did not run, including `--skip-tag app`. Each stage reports `green` when its selected steps pass, or `partial` when selection left out its steps; default skips still allow green. The whole run stays partial with `--only` or `--skip-tag`. After a green base and a failed app, `Next:` points at the application section of `.stacks/BRIEF.md`.
- Steps run through `/bin/sh -c` in the project root (or the step's `cwd`, which must resolve inside the project) with stdin closed, in their own process group. Their environment is the caller's, minus every agent session marker (`CLAUDECODE` and the rest), with the manifest's `env` filling keys the caller doesn't set: `PORT_WEB=5187 stacks verify` moves a port.
- Each setup, check and teardown step has its `timeout` (default 10m). A step that leaves a process holding its output is stopped 2 s after its shell exits and gets a note; its own exit status still decides it. Exit 127 is reported as a missing command (`failureKind: "env"`).
- A serve step's `expect.http` (with `${VAR}` expanded from the step environment) must be an `http` URL on `localhost`, `127.0.0.1` or `::1`. Verify fails the step without starting it when that port already answers, then polls the URL every 500 ms until any status below 500, for up to `within` (default 60s). Serve commands must stay in the foreground: one that exits before its probe passes fails, and so does a server still answering on the port after its process group was stopped.
- Outcomes: `green` (exit 0) is a full run with every step that ran passing. A passing `--only` or `--skip-tag` run is `partial` (exit 0), which never counts as done. A failed step is `failed`: exit 5 (`VerifyFailed`) with the full result still on stdout, each failed step's `failureKind` (`step`, `env`, `timeout`) and output tail in it, and the error envelope naming the failed steps as the last stderr line. Ctrl+C is exit 130 after teardown. Outside a project is `NotFound` (2), and an `--only` name that isn't a check or serve step is `BadInput` (2); a manifest that doesn't decode is `InvalidConfig` (3), and one that can't be read is `PermissionDenied` (6).
- Human mode streams each step's output to stderr, prefixed with its name, and ends a run that isn't green with a `Next:` line.

### Changed steps and run records

Before running anything, `verify` checks the steps against the copies recorded by `new`: the manifest's own `verifyDigest`, and the project state record outside the project (`$XDG_STATE_HOME/stacks/projects/<projectId>.json`, or under `STACKS_STATE_DIR`). The digest covers every field verify reads from each step, plus the manifest's `env` and `preset`; a step's `owner` is left out.

- Any difference is outcome `changed`: no step runs, not even teardown, and the exit is 5 (`VerifyChanged`) with the result on stdout. Its `changed` field (and the envelope's `details`) says which copy disagreed (`against`: `manifest` or `state-record`) and, from the state record's per-step digests, which steps were `edited`, `added` or `removed`, and whether `env` or `preset` changed (`settings`). A state record found only by the manifest's path, under a different `projectId`, is a change with `reason: "project-id"`.
- With no state record on this machine (a fresh clone, or a state directory `new` couldn't write), only the manifest's copy is checked and the result says `tamperCheck: "manifest-only"`, which never counts for the MVP gate. An unreadable record counts as missing; one a newer stacks wrote fails `InvalidConfig` (3).
- `verify --accept-changes` is for a person who changed the steps on purpose. It is refused with `PermissionDenied` (6) when an agent is detected (`reason: "agent"`) or stdin isn't a terminal (`no-tty`), and then changes nothing. Otherwise its report names what changed, it writes the new digest to the state record (creating it on a fresh clone) and then to the manifest, keeps the project's timing fields, and runs the steps. A state record it can't write fails `PermissionDenied` (`state-unwritable`) with the manifest untouched.
- Every run that gets past the manifest (`changed`, `failed` and interrupted ones included) appends one `RunRecord` line to `.stacks/state/runs.jsonl`, which the project's `.gitignore` ignores: `schemaVersion`, start time, CLI version, detected agent, outcome, scope, `tamperCheck`, `acceptedChanges`, durations and each step's name, phase, layer, status, failure kind and exit code. No commands, output, paths or environment values, so it is safe to attach to a bug report.
- The state record's `firstGreenAt` is set by the first green run and `firstTestPassAt` by completion of the first run, of any scope, in which a `test`-layer command succeeded; neither is overwritten. This is an exit-status proxy: verify does not observe runner counts or parse arbitrary stdout. Shipped conditional hook-directory checks use the `check` layer so their absent-directory success cannot set it. The result's `firstGreen` is true on the run that set it, and `stateRecord` is false when there was no record to update or it couldn't be written. A run record or state record that can't be written is one logged warning; the outcome and exit don't change.

## runs

```sh
stacks runs          # summary for the nearest project
stacks runs --json   # ProjectRuns
```

`runs` finds the nearest project and reports its stack, fingerprint, creation time, handoff kind, brief words, verify count, last outcome, timings, interventions (the nonempty items under `## Asked` in `NOTES.md`), state-record availability and skipped history lines. It reads the project's `.stacks/state/runs.jsonl` and `NOTES.md`. Timings come only from the out-of-project state record; unavailable timings or notes stay unknown. Invalid or newer history lines are counted and skipped. Outside a project it exits 2 with `NotFound`. A manifest that doesn't decode, or a manifest or state record from a newer stacks, exits 3 with `InvalidConfig`; an unreadable manifest exits 6. Moving a project keeps its timings through its project id.

## validate

```sh
stacks validate                                   # the bundled registry
stacks validate ~/my-registry                     # a registry root (holds stacks/ or fragments/)
stacks validate ~/my-registry/stacks/web          # one entry
stacks validate --json                            # the ValidateReport
stacks validate --brief web --with docs --sandbox # the brief a composition renders to
stacks validate ~/my-registry/stacks/web --submission # ready for the public registry?
```

`validate` reads files only; it runs nothing from an entry. A relative path resolves against the directory you ran it from. Exit 0 when there are no errors; exit 2 (`ValidationFailed`) with the full report still on stdout. [Validation](validation.md) lists every check, the word budgets and `--brief`.

`--submission` takes one entry directory and adds the checks that keep an entry out of the public registry:

| Check | Severity | Finds |
| --- | --- | --- |
| `fill-marker` | error | A `stacks:fill` marker left in the frontmatter, the body, the search card, or a file under `files/` or `adapters/`. A shipped marker is allowed when a verify step whose `run` mentions `stacks:fill` names that file's project path (with or without `.tmpl`), as the scaffold's `readme` step names `README.md`, because the project's agent fills it. |
| `secret` | error | A credential-shaped string anywhere in the entry or its card: cloud, GitHub, Slack and AI provider keys, private keys, and long literals assigned to names such as `password` or `token`. A matched value that reads as a placeholder or a reference (`your-...`, `{{project_slug}}`, `${...}`, `secrets.`, `process.env`) is let through; the rest of the line doesn't count. The report names the kind, never the value. |
| `env-file` | error | A `.env` file other than `.env.example`, `.env.sample` or `.env.template` (each also as `.tmpl`) |
| `absolute-path` | warning | A home directory path (`/Users/<name>/` other than `/Users/Shared/`, `/home/<name>/`) or a Windows drive path such as `C:\work` (also JSON-escaped, `C:\\work`) in shipped text. Image, CI and dev container homes (`/home/node`, `runner`, `vscode`, `ubuntu`, `codespace`, `gitpod`, `coder`, `circleci`, `app`, `user`, `ec2-user`, `linuxbrew`, `bun`, `pwuser`, `nonroot`, `jovyan`, `vagrant`, `jenkins`, `gitlab-runner`) are fine |
| `missing-card` | warning | No search card |

The scan uses patterns, so it misses things: read the files yourself before submitting. `--submission` with `--brief`, or with a path that isn't one entry, is `Usage` (exit 2).

## submit

```sh
stacks submit ~/.config/stacks/stacks/my-api --dry-run        # check and print, open nothing
stacks submit my-api my-lint --query "a REST API in Go"        # one pull request for both
stacks submit my-api --repo my-org/stacks --json               # another upstream; SubmitResult
```

`submit` opens a draft pull request that adds your entries to the public registry, `steamfield/stacks` unless `--repo` names another. Each argument is an entry directory or the id of an entry in your user registry: an argument with a `/`, or one that starts with `.` or `~`, is a path, and anything else is an id (`./my-api` for a directory in the current folder). An id that isn't kebab-case is refused (exit 2); give a stack and the fragments it needs together and they travel in one pull request. It runs the GitHub CLI (`gh`) and `git` with fixed arguments and holds no credentials: `gh` must be on `PATH` and logged in (`gh auth login`).

It works in this order, and stops at the first step that fails:

1. Preflight: refuses offline mode, then reads your login with `gh api user`.
2. A partial, shallow clone of the upstream `main` into a temporary directory.
3. Each entry is copied to `packages/cli/registry/stacks/<id>/` or `fragments/<id>/`, its search card to `search/` (for an update without a card, the upstream card is kept), and `authors.json` maps `<kind>/<id>` to your login. An unreviewed author card gets its `source.digest` stamped from the entry as submitted. A reviewed card whose digest no longer matches is restamped and becomes an unreviewed author card (`search-unreviewed`); one that still matches is left as it is.
4. The checks run against the clone's registry, not your installed one, so every reference must resolve upstream or among the submitted entries. `validate --submission` must find no errors and no warnings beyond the ones maintainers clear after the pull request: `search-unreviewed`, `search-missing`, `missing-card`, `deps-missing` and `deps-unreviewed`. A removed id is always refused. An existing id is refused unless `authors.json` gives it to your login, which makes the pull request an update.
5. Unless `--dry-run`: forks the repository (an existing fork is reused), commits exactly the submitted entry directories, cards and `authors.json` (even files the upstream `.gitignore` skips) on branch `entry/<kind>-<id>` named after the first entry (stacks first, then by id), and pushes to your fork. An existing branch is replaced only when its tip is the one commit an earlier `submit` made on top of a commit of upstream `main` (GitHub's compare API answers that), with a lease on that commit. A branch that has commits `submit` didn't make is refused (`BadInput`, `branch_taken`), and so is a push the lease rejects because someone pushed meanwhile; update that pull request by hand, or delete the branch on your fork to start over. Then it opens a draft pull request. Its body lists the entries, the validation summary and the warnings left, your `--query` proposals, the CLI version and the maintainer checklist.

A rerun pushes to the same branch, rewrites the open pull request's title and body to match, and reports it instead of opening another. `--dry-run` clones and checks the same way, then prints the files and the pull request body; show it to the user and get a yes before the real run. The temporary clone is removed however the command ends.

`--json` returns `SubmitResult`: `{ repo, entries: [{ kind, id, update }], author, branch, prUrl, reused, dryRun, findings, files }`, plus `body` for `--dry-run`. Exits: 0 submitted or dry-run; 2 (`BadInput`) for offline mode, a missing or logged-out `gh`, a bad `--repo`, an entry that fails the checks (each blocking finding's check, file and line in `details.blockers`), an id collision, a pull request branch that has commits `submit` didn't make, or nothing changed; 4 (`UpstreamUnavailable`) when GitHub or git can't be reached; 6 (`PermissionDenied`) when GitHub refuses the fork or push for your login; 130 when interrupted.

## create

```sh
stacks create stack my-api --json
stacks create fragment my-ci --category ci
stacks create fragment my-app --category app
stacks create stack go-cli --from bundled
stacks create stack team-api --from project --yes
```

`create` writes a personal skeleton or a working copy into the user registry, and never runs anything from an entry. An occupied target is refused with `BadInput` (exit 2) and left as it was, and so is a skeleton whose id another registry root already has (copy that entry with `--from` instead). `--from bundled` copies an entry under the same id for editing, including all files, adapters and its search card; the user copy then shadows the bundled one. `--from index` copies a cached index entry the same way when an index is configured. `--from project`, or any other untrusted source, requires a person at a terminal to review the full trust report; `--yes` skips only the question. Agents and non-terminal stdin can't confer trust (`PermissionDenied`, exit 6). `--from user` is refused, because the user registry is the destination. `create fragment --category` takes `agent-ops`, `app`, `ci`, `deploy`, `release`, `service`, `vendor` or `tooling`. `--json` returns `{ kind, id, path, guide }` with absolute paths. Follow the shipped [authoring guide](../authoring.md) to preview, validate and prove the entry.

## update

```sh
stacks update          # upgrade a global npm install
stacks update --check  # report versions without installing
stacks update --json   # UpdateResult
```

Each invocation makes one request to the npm registry for the latest `@steamfield/stacks` version, with a 10 second timeout. Nothing checks in the background, and no version is cached, so under `--offline` or `STACKS_OFFLINE=1` both `update` and `update --check` fail with `BadInput` (`flag: "offline"`, exit 2) before any request. An equal version reports `up-to-date`; a running version newer than the published one reports `ahead`. Neither runs npm.

When a newer version exists, `update` detects npx from the running package's path, or checks npm's global prefix against the package's real path. A global npm install upgrades with `npm install -g @steamfield/stacks@<latest>`, pinned to the version just reported, with a 5 minute timeout. Both npm calls run from your home directory with your captured environment, so a project's `.npmrc` cannot change them. Human output reports progress before installing; npm's output is kept private.

`--check` returns `available` with the install method and command to run. An npx install gets `npx -y @steamfield/stacks@<latest>`; other installs get the npm install command, without installing. Agents may check; an agent attempting an available global upgrade without `--check` gets `PermissionDenied` (`reason: "agent"`, exit 6). A person piping the output may install without a terminal.

`--json` returns `{ status, current, latest }`, with `install` and `command` for `available`, or `install: "npm-global"` for `updated`. Exit 0 means up to date, ahead, available or updated; 4 (`UpstreamUnavailable`) means retry the registry request later; 6 (`UpdateFailed`) means run the supplied command yourself to see npm's output; 130 means interrupted, after stopping npm's process group. The running process keeps its original code after updating.

## skill install

```sh
stacks skill install                   # $HOME/.claude/skills/stacks/SKILL.md
stacks skill install stacks-author     # $HOME/.claude/skills/stacks-author/, every file
stacks skill install --project         # git toplevel, or cwd outside a repo
stacks skill install --force           # replace edited copies
stacks skill install --print           # print SKILL.md to copy elsewhere yourself
stacks skill install --json            # { name, path, action: "written" | "unchanged", files }
stacks skill install --print --json    # { name, path: null, action: "printed", files, text }
```

The name is `stacks` (the default) or `stacks-author`, the skill for writing and submitting a stack or fragment, which ships a `references/` folder beside its `SKILL.md`. Every file of the skill is installed under `.claude/skills/<name>/`, and `files` lists each one's relative path and action; `path` is the installed `SKILL.md`. An unknown name is `Usage` (exit 2) with the closest name suggested.

Identical installed files are unchanged. Differing files are preserved with `TargetNotEmpty` (exit 2) unless `--force` is set, and nothing is written; a directory occupying a skill file is always preserved. Writes refuse symlinks escaping the skills root and final file symlinks; a dotfiles symlink above the skills root is supported. A failed write restores the files already replaced. Installation is allowed under an agent. A missing `HOME` or an unwritable target exits 6. `--print` prints only `SKILL.md`, skips all target lookup and writes nothing; a skill with references is better installed. A missing bundled skill exits 2 and appears as `skill.found: false` in `doctor --json`.

## guide

`stacks` with no arguments, or `stacks guide`, prints a short guide written for agents: `search` in plain words, `show <id>` to review a candidate and explain the pick, `new <stack> <dir>`, then `verify` and `verify --all` before calling it done. `list` browses entries and helps recover when nothing fits. `--json` returns `{ guide, commands }`. `stacks --help` keeps the full help and ends with a "Start here (agents)" footer.

## guide author

```sh
stacks guide author                    # how to write and submit a stack or fragment
stacks guide author from-repo          # one reference: turning an existing repo into a stack
stacks guide author --json             # { topic, text, topics }
```

Prints the `stacks-author` skill without installing it, so an agent can follow it from any project. With no topic it prints the skill's `SKILL.md`; a topic prints that reference: `anatomy`, `fragment`, `from-repo`, `interview`, `search-card` or `submit`. Links between the files become the `guide author <topic>` command that prints the target. An unknown topic is `Usage` (exit 2) with the closest topic suggested; a missing bundled file exits 2 (`NotFound`) and an unreadable one exits 6.

## doctor

```sh
stacks doctor
stacks doctor --json
```

`doctor` reports version, platform, executable, config, data, cache and working paths, the user entry directory, the bundled registry and skill paths (and whether each exists), safe configuration errors, and `remoteIndex` with its URL, trust mode, offline flag, cache timestamp, last attempt, last outcome and backoff deadline. It never refreshes the index. A missing configuration file is fine. A malformed optional file is reported in `configErrors` while doctor exits successfully; help and version don't open that file.

## schema

```sh
stacks schema                 # list the names and what each describes
stacks schema verify          # one JSON Schema
```

Prints the JSON Schema (draft 2020-12, objects closed) of a command's `--json` result, of the error envelope (`error`) or of verify's live events (`verify-event`), so a caller can validate what it parses. `--json` with no name returns `{ schemas: [{ name, describes }] }`. An unknown name is `Usage` (exit 2) with a did-you-mean.

## Shell completions

`--completions <shell>` prints a static completion script for `bash`, `zsh`, `fish` or `powershell` (`sh` and `pwsh` are accepted as aliases), covering every command and flag. Regenerate it after upgrading stacks.

```sh
stacks --completions bash >> ~/.bashrc
stacks --completions zsh > "${fpath[1]}/_stacks"
stacks --completions fish > ~/.config/fish/completions/stacks.fish
```
