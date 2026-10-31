# Phase 0.3a: Errors and output

Status: EXECUTED 2026-10-26 on branch `feat/phase-0`. Answers A2 and A4 as
recommendations; the maintainers review them, and both must be in the decisions log before
[1.6c](phase-1.6c-first-release-2026-10-30.md) publishes.

| Field | Value |
|---|---|
| Goal | One error table for exit code, retryability and kept results; closed `details` on tagged errors; exit 5 reserved for `VerifyFailed` and `VerifyChanged`; a failing report-carrying command keeps its result on stdout, even when stdout closes; live progress on stderr in human mode; an early flush for handoff; `Host.stdinIsTTY` and `Host.stdoutIsTTY` for every later sub-phase that asks whether a person is at a terminal |
| Traces to | The agent's frustration is "a verify command that doesn't exist" and ambiguity; `verify` "failing is the normal case for an agent loop", so a failure must carry the verify report the agent acts on |
| Depends on | [0.1](phase-0.1-repo-baseline-2026-10-30.md) |
| Blocks | [0.3b](phase-0.3b-processes-and-signals-2026-10-30.md), [1.0](phase-1.0-entry-format-and-registry-2026-10-30.md) (`EntryInvalid` row and details, `Host.stdoutIsTTY`), [1.2a](phase-1.2a-new-scaffold-and-templates-2026-10-30.md) and [1.2b](phase-1.2b-manifest-state-and-detection-2026-10-30.md) (the TTY flags), [1.3a](phase-1.3a-verify-runner-and-probes-2026-10-30.md) (`VerifyFailed` details, progress), [1.3b](phase-1.3b-tamper-detection-and-run-records-2026-10-30.md) (`VerifyChanged` details), [1.4](phase-1.4-handoff-and-entry-points-2026-10-30.md) (`flushNow`, the TTY flags), [1.5](phase-1.5-validate-and-brief-budget-2026-10-30.md) (`ValidationFailed` keeps its result) |
| Decisions needed | None from the product list. A2 and A4 ([roadmap, open architecture questions](../../roadmap.md#open-architecture-questions)) are answered here and reviewed by the maintainers ([0.0](../../phases/phase-0.0-decisions-and-npm-name.md)). If A2 goes to option (a), NDJSON on stdout, `progress` gains a JSON mode and the one-result contract changes everywhere; if A4 goes to option (b), `details` is dropped and failure data lives only in results, but exit 5 and kept results stay |
| Settles | A2 and A4 (once agreed); exit code 5; the `BrokenPipe` rule for kept results |

## Scope

In:

- A4: `src/errors.ts::errorTable`, closed `details` on tagged errors, `VerifyFailed` and
  `VerifyChanged` on exit 5 with empty details, and results kept on failure for tags with
  `keepsResult`.
- The `BrokenPipe` rule for kept results in `main.ts::main`.
- A2: `Output.progress`, live lines on stderr in human mode.
- `Output.flushNow`, for 1.4 to call before an interactive child takes the terminal.
- `Host.stdinIsTTY` and `Host.stdoutIsTTY`, supplied by `bin.ts` (see roadmap, Contracts:
  Agent detection and TTY). This is the only sub-phase that adds them.
- `PermissionDenied.details` (`{ reason, path? }`).

Out: the process service, `SpawnFailed` and the signal policy
([0.3b](phase-0.3b-processes-and-signals-2026-10-30.md)); the detail schemas of `VerifyFailed` and
`VerifyChanged` (1.3a, 1.3b); any product command. No NDJSON stream (A2 option (a) is
rejected below).

## Design

### Where this fits

This sub-phase changes only how a command's outcome reaches the user: `errors.ts`,
`main.ts` and `services/output.ts`. Its sibling [0.3b](phase-0.3b-processes-and-signals-2026-10-30.md)
builds the `Processes` service and the signal policy on top. 0.3b's `SpawnFailed` is an
internal error that reaches `main` only as a `Defect`, so it needs no row here. 1.4 uses
both halves: `Output.flushNow` from here, then `Processes.interactive` from 0.3b.

### A4: one error table

Today each class in `errors.ts` has no fields, and `errors.ts::exitCode`,
`errors.ts::retryable` and `errors.ts::knownError` are three switches that must agree. This
sub-phase owns the replacement (see roadmap, Contracts: Error table):

```ts
type ErrorSpec = { exit: number; retryable: boolean; keepsResult: boolean };
export const errorTable = {
  Usage: { exit: 2, retryable: false, keepsResult: false },
  BadInput: { exit: 2, retryable: false, keepsResult: false },
  NotFound: { exit: 2, retryable: false, keepsResult: false },
  NotConfigured: { exit: 3, retryable: false, keepsResult: false },
  InvalidConfig: { exit: 3, retryable: false, keepsResult: false },
  UpstreamUnavailable: { exit: 4, retryable: true, keepsResult: false },
  VerifyFailed: { exit: 5, retryable: false, keepsResult: true },
  VerifyChanged: { exit: 5, retryable: false, keepsResult: true },
  PermissionDenied: { exit: 6, retryable: false, keepsResult: false },
  Interrupted: { exit: 130, retryable: false, keepsResult: false },
  Defect: { exit: 1, retryable: false, keepsResult: false },
  BrokenPipe: { exit: 0, retryable: false, keepsResult: false },
} as const satisfies Record<AppError["_tag"], ErrorSpec>;
```

The codes are specific on purpose: an agent branches on 2 (fix the input), 3 (fix the
config), 4 (retry later), 5 (read the verify report), 6 (ask the user) and 130 (stopped), where a
generic 1 would make it guess. Scripts that expect 1 for every failure get a different
number; the README's exit-code table says so, and
[open question 25](../../risks-and-open-questions.md#open-questions-for-the-maintainers) asks
the maintainers to confirm the scheme before 1.6c makes it permanent.

`exitCode` and `retryable` read the table, so a tag without a row is a type error.
`knownError` checks membership against one exported list of the error classes, and a
unit test asserts the list and the table's keys are the same set. A later sub-phase that
adds a tag adds its class to the list, its row here, and its line to the roadmap's
[Error tags](../../roadmap.md#error-tags) table.

`VerifyFailed` (`Verify failed.`) and `VerifyChanged` (`Verify steps changed since they
were recorded.`) are added now so exit 5 is reserved and tested here. Their detail schemas
are defined in 1.3a and 1.3b; until then they have no details and are used only in tests.

### Details and the envelope

The envelope is the roadmap's (see roadmap, Contracts: Error envelope). A tag may declare
an optional `details` field, a `Schema.Struct` built with `Schema.TaggedError`'s fields;
`Output.error` encodes it with `onExcessProperty: "error"` and puts it in the envelope
only when present.

| Rule | Why |
|---|---|
| Each tag's details are a closed `Schema.Struct`; encoding rejects excess properties | Agents can rely on the shape; nothing leaks by accident |
| Details hold only values the CLI produced or the caller passed as an argument: step names, exit codes, entry ids, flag names | The base promises fixed, safe messages and no secrets in output |
| `message` stays fixed per tag; details never interpolate into it | Agents that match on messages keep working |
| Details go into the envelope only, never into a log record | Logs never serialize argument values (base rule) |

`PermissionDenied` gets its details here: `{ reason, path? }`. `reason` is a closed set of
literals that later sub-phases extend in their own change (this sub-phase adds `write`,
used by `output.ts::write` for a non-EPIPE write error; 1.0 adds `read`; 1.3b and 3.2a add `agent`,
`no-tty` and `state-unwritable`). `path` is the file or directory the CLI tried to read or
write, when there is one (1.0, 1.2a, 1.2b and 3.4c use it). The roadmap's
[Error tags](../../roadmap.md#error-tags) row is the list.

Human mode prints the message, then one indented line per detail field that the tag's
renderer chooses to show (for `VerifyFailed`, 1.3a picks the failed step names).

### Failures that keep their result

`main.ts::main` clears the output buffer on every error today. For a tag with
`keepsResult: true` it doesn't: it flushes the buffered result to stdout, then writes the
envelope as the last stderr line (see roadmap, Other shared facts: JSON contract). Verify's
report is what an agent most needs when verify fails, and the envelope still says the
command failed:

- stdout carries one result whether the command passed or failed.
- On any failure in `--json` mode, the last stderr line is the envelope. In human mode the
  base's `command failure` log line still follows it on stderr, as the base did.
- For every other tag, stdout stays empty on failure, as today.

`main` does not invent a result. A keeps-result command that fails before writing one
leaves stdout empty; the owning sub-phase (1.3a, 1.3b, 1.5) makes sure it writes its
report first.

### The BrokenPipe rule

Today `main` returns 0 when flushing hits `BrokenPipe`, so `stacks verify --json |
head -c 100` would exit 0 on a failed verify. The new rule (see roadmap, Error tags:
`BrokenPipe`):

| Outcome of the command | `BrokenPipe` while flushing the result or writing the envelope | Exit |
|---|---|---|
| Success | Quiet | 0, as today |
| A keeps-result tag | Quiet; still tries the envelope on stderr if stdout was the closed one | The tag's exit (5 for verify) |
| Any other tag | Quiet | 0, as today |
| The program itself failed with `BrokenPipe` | Quiet | 0, as today |

Only the keeps-result row changes. A pipe closing must not turn a failed verify into a
pass for a script that checks `$?`.

### A2: progress

`services/output.ts::Output` gains `progress: (text: string) => Effect.Effect<void>` (see
roadmap, Contracts: Progress and flush):

- Human mode: writes `text` and a newline to stderr at once, not buffered.
- Every write error is swallowed. `output.ts::write` maps EPIPE to `BrokenPipe` and every
  other error to `PermissionDenied`; `progress` swallows both, and after the first failed
  write it stops writing for the rest of the invocation. A closed or broken terminal can't
  fail the command or change its exit.
- JSON mode: does nothing. The JSON contract reserves stderr for the envelope, and
  JSON-mode logs go only to the configured JSONL file.

| Option | For | Against | Choice |
|---|---|---|---|
| (a) NDJSON events on stdout under `--json` | Agents could watch steps live | Breaks "JSON commands produce one result"; every consumer must parse a stream and find the last line; agents' shell tools return whole output anyway | No |
| (b) One result at the end; live progress on stderr in human mode | Keeps the contract; humans see progress; agents get one object | Agents in `--json` mode see nothing until the end | Yes |

An agent that wants progress can run without `--json`; the brief (1.1) tells it to use
`--json` for the final check. Logs stay buffered as today.

### flushNow

`Output.flushNow: Effect.Effect<void, BrokenPipe | PermissionDenied>`:

- Human mode: writes the buffered results to stdout now and empties the buffer. `main`'s
  final flush then has nothing left to write.
- JSON mode: does nothing; the one result is written at the end as usual.
- Once it has run, "stdout empty on failure" no longer holds for that invocation: what
  was flushed stays on stdout, and a later failure still writes its envelope to stderr.
  This exception goes in `.claude/rules/cli/cli.md` and `AGENTS.md`.

The only planned caller is 1.4, right before `Processes.interactive`, so the user sees
stacks's last lines before the agent takes the screen.

### Host: terminal flags

`services/host.ts::HostInfo` gains `stdinIsTTY: boolean` and `stdoutIsTTY: boolean`.
`bin.ts` sets them from `process.stdin.isTTY === true` and `process.stdout.isTTY === true`,
so core code never touches the streams. `Host.memory` defaults both to `false` and takes
an override, and `tests/helpers/cli.ts` passes them through, so a test can act as a person
at a terminal. Nothing in this sub-phase reads them; 1.0 (human `list` layout), 1.2a and
1.2b (confirmations and `--yes`), 1.4 (launch needs stdout to be a terminal) and the
trust rules (roadmap, Trust model, point 4) do.

### Unknown commands and did-you-mean

A mistyped subcommand (`stacks lsit`) is a `Usage` failure, exit 2, like any other
parser failure. Before writing the mapping, check what `effect/cli` in the installed
version does with an unknown subcommand: whether it suggests a close match, what text it
prints and to which stream. Then pin one behavior with a test, whichever the framework
gives:

- If it suggests, keep its suggestion, and make sure the text lands on stderr in human
  mode and that `--json` still produces exactly one envelope as the last stderr line.
- If it doesn't, `main.ts` maps the parser's unknown-subcommand failure to `Usage` with
  `details: { command, suggestions }`, where `suggestions` holds up to three known
  subcommand names within an edit distance of 2 (Damerau-Levenshtein, ties broken
  alphabetically), and human mode prints `Did you mean: list?` under the message.

The same nearest-name helper, `src/core/suggest.ts::closest(name, known)`, is what 1.1
uses for mistyped stack and fragment ids, so the two never disagree on what "close" means.

What shipped: effect/cli 4.0.6 does compute suggestions. The parser fails with
`CliError.ShowHelp` carrying `UnknownSubcommand { subcommand, parent, suggestions }`, where
`suggestions` is plain Levenshtein within 2, only the names at the minimum distance, and
case-sensitive. With `renderErrors: false` and `main` discarding captured framework output on
failure, none of it reached the user. `main` discards the framework's list and builds
`Usage.details` from `closest` over the real tree's listed subcommands, for consistency with
1.1. Because the base has no `list` command yet, the acceptance tests pin `doctr` → `doctor`
(human and `--json`) and `zzzz` → no suggestion on the real tree; the `lsit` → `list` test
moves to [1.0](phase-1.0-entry-format-and-registry-2026-10-30.md) when `list` exists, and
`tests/suggest.test.ts` already covers the ranking.

Suggestions for unknown flags (`--jsno`) are deferred: such a failure is a bare `Usage` with no
details. effect/cli's `UnrecognizedOption.suggestions` is where that data is when someone picks
it up.

### Failure modes

| Situation | Tag | Exit | What the caller sees |
|---|---|---|---|
| Verify fails with a report | `VerifyFailed` | 5 | Report on stdout, envelope last on stderr |
| Verify fails, stdout closed by `head` | `VerifyFailed` | 5 | Partial or no report; envelope on stderr if it is open |
| Any other failure | its tag | the table's | Empty stdout, envelope on stderr |
| stderr closed while printing progress | none | unchanged | Progress stops; the command continues |
| A detail struct gets an extra property | `Defect` | 1 | Caught by tests before it ships |
| Unknown subcommand | `Usage` | 2 | Envelope on stderr, with close matches when there are any |

## Files and areas touched

`packages/cli/src/errors.ts`, `src/main.ts`, `src/services/output.ts`,
`src/services/host.ts` and `src/bin.ts` (the TTY flags), `tests/helpers/cli.ts` (Host
fixture), new
`src/core/suggest.ts`, `tests/errors.test.ts`, `tests/cli.test.ts` (every "stdout empty on failure" assertion
names the tags it covers), new `tests/output.test.ts`, `.claude/rules/cli/cli.md` (the
UX contract, whose exit-code branches gain 5 as "read the verify report", plus `progress`,
`flushNow` and the `errorTable` pointer), `AGENTS.md` (Error handling: the exit list gains
`VerifyFailed`/`VerifyChanged` 5, plus `details`, kept results and the `BrokenPipe`
rule). Both files describe the shipped code, so they change in the same commit as
`errors.ts`, not before.

## Acceptance tests

All through `main(args, program)` with injected programs and `Output.memory` writers, in
the style of `tests/errors.test.ts`:

- Table: a program failing with each tag exits with its row's code; the envelope's
  `retryable` matches the row; the class list and the table keys are the same set.
- Details: a test-only tag with a details struct puts `details` in the JSON envelope and
  its chosen fields as indented lines in human mode; a tag without details has no
  `details` key; encoding a detail struct with an extra property fails; the JSONL log
  record of that invocation contains no detail value.
- Kept results: a program that writes a result and then fails `VerifyFailed` leaves the
  result on stdout and the envelope as the last stderr line, exit 5, in `--json` and human
  mode. The same program failing `BadInput` leaves stdout empty, exit 2.
- BrokenPipe: with a stdout writer that rejects with EPIPE, `VerifyFailed` exits 5 and the
  envelope is on stderr; a successful command exits 0; `BadInput` with a stderr writer
  that rejects with EPIPE exits 0, as today.
- Progress: in human mode a progress line is on stderr before the program finishes (the
  program writes progress, then waits on a `Deferred` the test completes after reading
  stderr); in `--json` mode stderr holds only the envelope; with a stderr writer that
  rejects first with EPIPE and then with EACCES, `progress` never fails and the exit code
  is unchanged.
- Did-you-mean: `stacks lsit` exits 2 with `Usage`; in human mode stderr names `list`;
  with `--json` the last stderr line is one envelope (with `details.suggestions:
  ["list"]` if 0.3a does the mapping itself) and stdout is empty; `stacks zzzz` exits
  2 with no suggestion. `closest` unit tests cover ties, case and a distance of 3.
  (Shipped as `doctr` → `doctor` on the real tree; the `lsit` → `list` case moves to 1.0,
  see "Unknown commands and did-you-mean".)
- Host: `Host.memory()` reports both TTY flags `false`; with overrides, a test command
  reading `Host` sees the values the helper passed.
- PermissionDenied: a write that fails with EACCES gives `details.reason: "write"` in the
  JSON envelope; encoding `{ reason: "write", extra: 1 }` fails.
- flushNow: in human mode the result is on stdout before the program finishes (same
  `Deferred` pattern); `flushNow` then `BadInput` leaves the flushed text on stdout, the
  envelope on stderr, exit 2; in JSON mode nothing reaches stdout until the end.

## Exit criteria

- `bun run check` green from the repo root.
- `AGENTS.md` Error handling lists exit 5 and describes `details`, kept results and the
  `BrokenPipe` rule; `.claude/rules/cli/cli.md` (the UX contract) gives exit 5 its branch meaning and
  describes `progress`, `flushNow` and the `flushNow` exception.
- A2 and A4 handed to the maintainers' review in [0.0](../../phases/phase-0.0-decisions-and-npm-name.md);
  1.6c checks they are in the decisions log before publishing.

## What this plan may get wrong

- `Schema.TaggedError` in Effect 4.0.6 is assumed to allow an optional struct field next
  to the fixed `message` override, and to encode it with `onExcessProperty: "error"`.
  Check the installed types first; if it doesn't, keep `details` as a separate schema per
  tag in a lookup next to `errorTable`.
- Keeping results on failure changes a contract the base documents and tests. Update each
  test that asserts "stdout empty on failure" to name the tags it covers, rather than
  weakening it.
- Exit 0 for `BrokenPipe` on an ordinary failure (a usage error whose stderr is closed)
  stays as the base had it. It is arguably wrong for the same reason the keeps-result row
  changed; it is left alone because no planned command depends on it, and changing it is
  a one-row edit if the maintainers want it.
