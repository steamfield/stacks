# Commands

This folder holds one file per `stacks` subcommand: the flags and arguments a user can type, the help text `--help` prints, and a handler that turns the parsed input into one result. When someone runs `stacks list --json` or `stacks verify`, the code that reads their flags and writes the answer lives here.

## How it fits

`cli.ts` (one level up) imports every command from this folder and attaches it to `root.ts::root`, in the order `stacks --help` lists them. `main.ts` runs that tree once per invocation. Each handler calls into `core/` for the real work (composing, validating, running verify steps) and hands the finished result to `services/output.ts::Output`.

A handler stays thin: it checks the flags against each other, calls one core program, and renders. The heavy logic belongs in `core/`, which must never import from `commands/` (AGENTS.md, "Conventions"). Commands don't run processes or read the environment themselves; they go through `Processes` and `AppConfig` like everything else.

Every command renders one result for three audiences, chosen once per invocation by `Output.audience`:

- `json` with `--json`: the result's schema-encoded object, one per run.
- `agent` by default (an agent's shell, a pipe, CI): the text with what an agent doesn't need cut, and paths shown relative to the working directory through `core/shown-path.ts::shownPath`.
- `human` at a person's own terminal: the same text, wrapped to the terminal and colored.

`output.result(json, text)` takes both forms; the audience decides which one is written. A failure is a typed error from `errors.ts`, and `main` renders it, so a handler only returns it. `rules/cli/cli.md` is the full contract.

## The usual shape of a handler

1. Check the input the parser can't: an unknown group or schema name fails as `Usage` with did-you-mean suggestions from `core/suggest.ts::closest`; out-of-range values fail as `BadInput`.
2. Call the core program (`validate`, `showReport`, `runVerify`, `submit` and so on).
3. Build the text for the audience and call `output.result`.
4. For `verify` and `validate`, fail after writing when the result is a failure. Their tags (`VerifyFailed`, `VerifyChanged`, `ValidationFailed`) keep the report on stdout, so the caller can read what went wrong.

`cli.ts` wraps most commands with the one-time telemetry notice and asks `main` to send queued events after the output is written. `new`, `add` and `verify` send their own events, and `schema` and `telemetry` skip the notice.

## Files

| File | What it owns |
| --- | --- |
| `root.ts` | The bare `stacks` command and the shared `--json`, `--offline` and `--no-telemetry` flags; a subcommand reads them with `yield* root` |
| `add.ts` | `stacks add`: applies fragments to an existing project through `core/add.ts`, then hands off |
| `new.ts` | `stacks new`: scaffolds a project from a stack through `core/scaffold/new.ts`, then hands off |
| `handoff.ts` | The flow `new` and `add` share: the project flags, the handoff decision, the printed result, the harness picker and the agent launch |
| `telemetry-hooks.ts` | Telemetry pieces `new` and `add` share: the `--source` flag, the failure event and which step names an event may carry |
| `create.ts` | `stacks create stack` and `create fragment`: a skeleton or a `--from` copy in the user registry, with a prompt for a missing id |
| `doctor.ts` | `stacks doctor`: paths, versions and config problems, readable even with a broken `config.json` |
| `guide.ts` | `stacks guide` (also `stacks` alone) and `guide author`: the agent guide and the authoring guide |
| `list.ts` | `stacks list`: the catalog, or the fragments a project can still add |
| `runs.ts` | `stacks runs`: the current project's verify history |
| `schema.ts` | `stacks schema`: the JSON Schema of each `--json` result, the error envelope and verify's events |
| `search.ts` | `stacks search`: ranks stacks and fragments for a request in plain words |
| `show.ts` | `stacks show`: everything about one entry, read only |
| `skill.ts` | `stacks skill install`: installs or prints a bundled agent skill |
| `submit.ts` | `stacks submit`: opens a draft pull request adding entries to the public registry |
| `telemetry.ts` | `stacks telemetry status`, `enable`, `disable`, `reset` and `flush` |
| `update.ts` | `stacks update`: checks npm for a newer CLI and upgrades a global npm install |
| `validate.ts` | `stacks validate`: checks a registry or one entry, or previews a composed brief with `--brief` |
| `verify.ts` | `stacks verify`: runs the project's verify steps after the tamper check |

## Terms

- Handoff: what happens after `new` or `add` writes the project. The CLI either launches a coding agent in it, asks a person which agent to launch, or prints the prompt to give one. `core/handoff.ts::decideHandoff` makes the decision; `handoff.ts` here carries it out.
- Picker: the numbered prompt `new`, `add` and `create` show a person at a terminal when an argument is missing. Under an agent or without a terminal it never appears, and the command fails as `Usage` instead (plain `stacks create` shows its help).
- Keeps-result failure: a failure whose report stays on stdout (`errors.ts::errorTable`, `keepsResult`).
- Help text: descriptions, examples and flag names here are what an agent reads cold with `--help`, so they list every exit code and are tested as output.

Trust points from `.claude/rules/architecture.md` show up in a few handlers: an untrusted entry never launches an agent (point 3, in `handoff.ts`), and `verify --accept-changes`, `telemetry enable` and an untrusted `create --from` need a person at a terminal (point 4).

## Where to start

Read `root.ts`, then `../cli.ts` to see the tree, then a small command such as `runs.ts` or `update.ts` for the handler shape. `verify.ts` and `list.ts` show a handler built from several named steps. For the shared `new` and `add` flow, read `handoff.ts` from `prepareHandoff` to `completeHandoff`.

Tests run the real command tree through `tests/helpers/cli.ts::runCli`. Per command: `packages/cli/tests/list.test.ts`, `list-project.test.ts`, `show.test.ts`, `search.test.ts`, `skill.test.ts`, `submit.test.ts`, `update.test.ts`, `validate.test.ts`, `validate-command-edges.test.ts`, `verify.test.ts`, `runs.test.ts`, `create.test.ts`, `guide.test.ts`, `schema.test.ts` and `telemetry-consent.test.ts`; `new.test.ts`, `add.test.ts` and `handoff.test.ts` cover `new`, `add` and their handoff. Across commands: `help.test.ts` (help text), `unknown-flag.test.ts` (flag errors), `audience.test.ts` (the three audiences) and `cli.test.ts`.
