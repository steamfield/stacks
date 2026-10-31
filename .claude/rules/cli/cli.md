---
paths:
  - "packages/cli/src/**"
---

# CLI UX contract

## Who the user is

The CLI's first-class user is a coding agent (PROBLEM_STATEMENT, "Who has it": the CLI's main reader). It runs `list --json`, picks a stack, runs `new`, reads the brief, and loops on `verify` until it's green. A human at a terminal is the fallback. Design every command for the agent first, then make human mode a readable rendering of the same result. The modes never behave differently: exit codes, files written and side effects are identical, and only the rendering changes.

## Three audiences, picked once per invocation

`Output.audience` is `"json"`, `"agent"` or `"human"`, resolved once when the Output layer is built (`services/output.ts::resolveAudience`): `--json` is `json`; otherwise `human` only when stdout is a terminal (`Host.stdoutIsTTY`), no agent is detected (`AppConfig.agent` is `"none"`) and `CI` is unset (`AppConfig.ci`); everything else, an agent's shell, a pipe, CI, any non-TTY, is `agent`. Agent is the default; human output is the opt-in a person gets at their own terminal. Commands render their text by `output.audience`.

Agent output is the human rendering with the noise cut, never a different result. It omits:

- Log lines on stderr. Logs go to the configured file only (`STACKS_LOG_FILE`), as in JSON mode; stderr holds the failure message, its detail lines and `Next:`, plus the short live lines `Output.event` writes (verify's `> <step>` as each step starts), and nothing else. Human mode still prints log lines at the configured level.
- `Output.progress` lines (human mode only).
- Anything another line or file already says: `new`'s written-file listing (the brief lists it), the `Project:` absolute path and the `For example:` command after a printed prompt; `verify`'s passed rows (the summary counts them) and every row of a `changed` run; `validate`'s size rows that are within budget (rows over their limit stay; `--json` keeps every size). No mode repeats `validate`'s counts under `Validation failed.`: the report ends with them and the envelope's `details` carries them.
- Layout for a terminal: `list` keeps each description on one line instead of wrapping it.
- Long paths in command result text: a path a command renders through `core/shown-path.ts::shownPath` prints relative to the working directory when it's inside it (real paths are compared too, so `/var` against `/private/var` or a symlinked cwd still nest), and absolute otherwise. Error detail paths (`Path:`, `Looked for:` from `errors.ts::failureGuide`) stay absolute for now, because `failureGuide` has no working directory. `--json` keeps absolute paths.

It keeps what an agent needs to act: ids, the brief path, findings, `Next:` lines, and every value it couldn't get elsewhere without `--json`.

## What good agent-facing UX means here

Every command takes `--json` and writes exactly one result object to stdout, and that object decodes with the command's own Schema in `src/schemas/`. On failure stdout is empty, and the last stderr line is one envelope, `{ error: { tag, message, retryable, next?, rollback?, details? } }`. Before it, stderr holds only `Output.event` lines: one JSON object per line for a long-running command's live events (verify's `VerifyEvent`). Every printed shape has a JSON Schema under `stacks schema <name>` (`core/result-schemas.ts::RESULT_SCHEMAS`); a new `--json` result or event schema gets an entry there. Two exceptions: a keeps-result tag (`errorTable` row with `keepsResult: true`: `VerifyFailed`, `VerifyChanged`, `ValidationFailed`) flushes its report to stdout before the envelope, because a failing verify or validate report is what the agent most needs to read; and once `Output.flushNow` has run, what it flushed stays on stdout even if the command later fails. A keeps-result command writes its report before failing; `main` never invents one.

Exit codes are the branch an agent takes, so each one means a single next action: 2 fix the input, 3 fix the config, 4 retry later, 5 read the verify report on stdout, 6 ask the human, 130 the run was stopped. A published exit code never changes meaning. Pick the tag by what the caller should do next, not by where the failure happened.

Messages are fixed per tag so agents can match on them. Context goes in a closed `details` struct holding only values the CLI produced or arguments the caller passed, never file contents, environment values or secrets. Don't interpolate into the message. Declare it as `details: Schema.optionalKey(<Struct>)` on the tag's TaggedError fields and add the tag's case to `errors.ts::encodeDetails` and `errors.ts::failureGuide` (both list every tag, so a new tag forces the choice). Construction drops keys the schema doesn't name; `Output.error` encodes closed, so only a details object mutated after construction becomes a Defect. Human and agent output show the lines `failureGuide` picks. `failureGuide` also returns the tag's next action: the envelope's `next` and the text modes' `Next:` line are the same string, so an agent reading `--json` gets the step a person reads. Write it as an instruction naming a real command (`Host.invocation`, never a bare `--help`); a new tag gets one, and `tests/errors.test.ts` fails on a reported tag without it.

Missing-argument pickers for `new`, `add` and `create` run only in the human audience with both stdin and stdout on a terminal. Agents, `--json`, CI and pipes keep their noninteractive behavior. Pickers use numbered rows and comma-separated fragment selections through `Terminal.readLine`, print the equivalent `Running:` command, and write nothing if interrupted. Anything that needs a human's confirmation refuses with `PermissionDenied` under an agent (`rules/architecture.md` "Trust model", point 4) rather than asking.

Output order is deterministic: sort lists by id, never by filesystem or map iteration order, so two runs diff cleanly. A mistyped command or id gets a did-you-mean from the one shared helper, `core/suggest.ts::closest` (up to three names within edit distance 2, transpositions count once, ties alphabetical ignoring case). Never write a local edit-distance function. `main` maps an unknown subcommand to `Usage` with `details: { command, suggestions }`, and the text modes print `Did you mean: doctor?` under the message. effect/cli computes its own `UnknownSubcommand.suggestions` (plain Levenshtein, case-sensitive); `main` discards them in favor of `closest`. Help text documents every flag and argument, because the agent reads `--help` cold and has nothing else.

Commands run processes only through `services/processes.ts::Processes`: `run` and `start` for shell steps (own process group, stdin closed, bounded tail), `exec` for a program on user-supplied values (argv, never a shell), `interactive` to hand the terminal to an agent (call `Output.flushNow` first), and `which` as the only PATH search. Build a child's environment with `AppConfig.childEnv`. Node process APIs (`process.kill`/`on`/`exit`, `node:child_process`, `@effect/platform-node`) belong only in `bin.ts` and `src/platform/`; the Grit boundary rule enforces it. A signal stops a command with exit 130 after cleanup; while an interactive child runs, Ctrl+C is the child's (AGENTS.md "Error handling" has the policy).

Only the human audience gets color, scoped live progress and terminal-width wrapping. Output decides color once per invocation, separately for stdout and stderr: a terminal or `FORCE_COLOR=1` enables it; nonempty `NO_COLOR` wins and also disables live redraws. Agent and JSON output never contain styling escapes, regardless of those variables. `Output.style` owns status colors; `Output.live` owns one stderr line, cleared when its scope closes, before the caller prints completion through normal output. Live events go through `Output.event` (JSON lines in `--json`, an optional short line in agent mode, nothing in human mode). Progress goes through `Output.progress`: stderr, human mode only, unbuffered, never fails or changes the exit code (it stops writing after the first failed write). `Output.flushNow` is for handing the terminal to a child: human and agent modes write buffered results now; JSON mode still writes its one result at the end. A text-mode failure ends with a `Next:` line saying what to do.

## Error handling

Load `ce:handling-errors` when adding or mapping errors. It defers to this rule where they overlap, and this repo overrides it in four places:

- Typed failures are `Schema.TaggedError` classes in `errors.ts`, carried in Effect's error channel. No try/catch for control flow and no separate Result type.
- "Put what, why and context in the message" becomes "fixed message per tag, context in `details`".
- "Log once at the boundary" is already how `main.ts` works. Don't log a failure where it's raised.
- Defects are logged as their class and stack frames, never their message, because a message can carry user data.

AGENTS.md "Error handling" and `errors.ts::errorTable` are the exit, retry and kept-result tables; don't restate them. A new tag adds its class to `errorClasses` and its row to `errorTable`. A closed stdout (`BrokenPipe`) is quiet and exits 0, except after a keeps-result tag, which keeps its exit so a failed verify piped into `head` never reads as a pass.

## Verifying UX

Run the changed command in all three audiences through `bun run dev` or the Node bundle `node dist/stacks`, on success and on at least one failure. A plain run from an agent's shell is agent output; for human output, build, then run `bun run human -- <args>` in `packages/cli`: the installed Node package under a pseudo-terminal with every agent marker removed. `new` and `add` launch an agent in a real terminal, so the script refuses them unless you pass `--no-launch` (or `--launch <agent>` to test the launch on purpose). `create --from` an untrusted entry without `--yes`, and `verify --accept-changes`, wait for a person's answer there, so give them stdin (`printf 'y\n' | bun run human -- ...`) or skip their human run. The pseudo-terminal merges stderr into stdout, so check which stream a line uses in agent or `--json` mode. Pipe the JSON through a decoder (`bun run dev <cmd> --json | jq -e .` at minimum, or decode with the command's Schema) and check `$?` before calling it done. Read the agent output as the agent that will depend on it: could you take the next step from it alone, and is every line needed?
