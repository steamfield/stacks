# Phase 2.0c: Run ledger

Status: EXECUTED 2026-10-27 (ledger schema and store, `runs`, `list`'s last-run column, the
import script; `registry/runs.json` seeded from the three 1.6b gate notes; reviewed once and
fixed). Item 6 checks the compiled binary's shipped ledger; the tarball form waits for 0.2
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | Every recorded build of a bundled stack is kept with the content it ran: the ledger `packages/cli/registry/runs.json` holds `LedgerRecord`s that wrap 1.3b's `RunRecord` and carry 2.0a's fingerprint, the 1.6b gate runs are imported with fingerprints computed at their repo commits, `stacks runs` reports a project's own numbers, and `list` shows each stack's last run |
| Traces to | "None of these are collected today"; success rows "The agent finishes without help" and "It's faster than by hand"; the stack author: "the only proof a stack works is an end-to-end agent run" |
| Depends on | [2.0a](phase-2.0a-composed-files-and-fingerprint-2026-10-30.md) (`fingerprint`, `composeFiles`), [1.6b](phase-1.6b-mvp-gate-runs-2026-10-30.md) (the gate run notes to import), [1.3b](phase-1.3b-tamper-detection-and-run-records-2026-10-30.md) (`RunRecord`, `runs.jsonl`, `firstGreenAt`, `firstTestPassAt`), [0.3b](phase-0.3b-processes-and-signals-2026-10-30.md) (`Processes` for the import script's `git`) |
| Blocks | [2.0b](phase-2.0b-bench-2026-10-30.md) (appends `LedgerRecord`s, reads `runs --json`), [2.2](phase-2.2-deterministic-rot-checks-2026-10-30.md) (ledger notes), [3.1a](phase-3.1a-show-and-preview-2026-10-30.md) (`show` prints the last run), [4.0c](phase-4.0c-registry-index-2026-10-30.md) (publishes ledger results) |
| Decisions needed | D8 (local proof in phase 2) assumed. D20 (the gate rule) defines what an imported gate run claims. Nothing here needs open question 11 or 12; those block 2.0b |
| Settles | The `LedgerRecord` fields and `result` values; how a gate run note becomes a ledger record; what `stacks runs` reports; the `lastRun` field in `list --json` |

## Scope

In:

- `LedgerRecord` in `src/schemas/ledger.ts` and the ledger file
  `packages/cli/registry/runs.json`, with read, lookup and append functions in
  `src/core/ledger.ts`.
- `scripts/ledger-import.ts`: turns gate run notes from `plans/runs/` into ledger records,
  computing each fingerprint from the registry at the note's repo commit.
- `stacks runs [--json]` in a project.
- `lastRun` per stack in `list` and `list --json`.

Out:

- `composeFiles` and the fingerprint (2.0a). The bench (2.0b). Scheduling runs (5.1).
  Validate notes about staleness and the `ledger-schema` validate error (2.2). Sending
  anything off the machine (4.1a). Publishing results (4.0c).
- Any CI step. The existing `check` job runs this sub-phase's tests with no workflow
  change.

## Design

### Where this fits

This sub-phase is the data: what a run record in the ledger looks like and the commands
that read it. [2.0b](phase-2.0b-bench-2026-10-30.md) is the producer: a local script that drives an
agent through a stack and appends one `LedgerRecord` per run using the functions defined
here. [2.2](phase-2.2-deterministic-rot-checks-2026-10-30.md) reads the ledger to report "changed
since last green". The first records come from this sub-phase's import of the 1.6b gate
runs.

### Ledger record

`LedgerRecord` is the contract in the roadmap ([Contracts: Ledger](../../roadmap.md#types-and-schemas)).
It wraps the `RunRecord` that 1.3b defines (roadmap, Contracts: Run record), imported from
`src/schemas/verify.ts` and never re-declared:

```ts
// src/schemas/ledger.ts
import { RunRecord } from "./verify.ts";
import { AgentId } from "./entry.ts";

export const LedgerResult = Schema.Literals(["pass", "partial", "fail", "infra"]);

export const LedgerRecord = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  date: Schema.String,                        // YYYY-MM-DD, the day the run started
  stack: Schema.String,
  with: Schema.Array(Schema.String),          // optional fragments added, sorted; [] for defaults
  preset: Schema.String,                      // 1.1's preset name, e.g. "sandbox"
  agent: AgentId,                             // the agent the run drove; always a known one
  agentVersion: Schema.String,                // as the agent reports it, e.g. "1.0.33"
  mode: Schema.Literals(["interactive", "headless"]),
  repoCommit: Schema.String,                  // 40-hex stacks commit the CLI and registry came from
  cli: Schema.String,                         // CLI version of the artifact that ran
  fingerprint: Schema.String,
  briefWords: Schema.Number,                  // countWords of the rendered brief (roadmap, Contracts: Word count)
  result: LedgerResult,
  agentEnded: Schema.Literals(["exit", "error", "timeout"]),
  run: Schema.NullOr(RunRecord),              // the final independent verify's record
  verifyRuns: Schema.Number,
  minutesToGreen: Schema.NullOr(Schema.Number),     // createdAt to firstGreenAt; null if never green
  minutesToFirstTest: Schema.NullOr(Schema.Number), // createdAt to firstTestPassAt; null if never
  agentMinutes: Schema.NullOr(Schema.Number), // wall clock of the agent process; null if not measured
  interventions: Schema.NullOr(Schema.Number),// lines under "## Asked"; null without NOTES.md
  note: Schema.optional(Schema.String),       // path of the run note under plans/runs/
});

export const Ledger = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  records: Schema.Array(Schema.Unknown),      // decoded one by one, see below
});
```

`result`:

| Value | When |
|---|---|
| `pass` | The final independent verify (`run`) is `green` with `tamperCheck: "full"`, and the agent ended with `exit` |
| `partial` | Set by a maintainer reading the run note, never by a script: verify was green but a deliverable the stack names is missing. The fix is a new verify step, not a different label |
| `fail` | Anything else where the agent did work: verify failed or `changed`, `tamperCheck: "manifest-only"`, the agent timed out, or the agent errored after writing files |
| `infra` | The agent ended with `error` (its exit status or the error subtype in its JSON output, read by 2.0b's adapter) and wrote no files in the project. The run says nothing about the stack |

`infra` exists so a login, rate-limit or crash failure is never read as rot. How 5.1
classifies runs over time (canary infra, timeouts, flaky stacks) is 5.1's design; it reads
these values and doesn't change them.

A run whose base stage is green and whose app stage failed (3.5b's optional
`RunRecord.stages`) has outcome `failed`: `runs` counts it in `verifyRuns`, `lastOutcome` is
`failed`, and the ledger `result` is `fail` like any other failed verify; the green base
shows only in the record's `stages`.

`interventions` is not part of `result`. The success measure "finishes without help" is
the share of `pass` records with `interventions: 0`; D20's gate needs that plus a `pass`.
`null` means there was no `NOTES.md`, which is not evidence of no questions.

`run` is `null` only for an imported gate run whose note doesn't carry the final
verify's `runs.jsonl` line, and `agentMinutes` is `null` only when the note doesn't
record it. Every bench record (2.0b) fills both.

### Ledger file

`packages/cli/registry/runs.json` is `{ "schemaVersion": 1, "records": [...] }`, appended
to in record order and reviewed in PRs. It ships in the package with the rest of
`registry/`, so `list` can show "proven" offline. Reading follows the roadmap's
[Schema versions](../../roadmap.md#schema-versions) row for run records and the ledger: the
file is decoded with `Ledger`, then each record with `LedgerRecord`; a record with a higher
`schemaVersion` is skipped and counted as `newer`, and a record that fails to decode is
skipped and counted as `invalid`. Those counts come back from `readLedger`; `validate`
turns them into findings in 2.2.

```ts
// src/core/ledger.ts
export type LedgerRead = {
  readonly present: boolean;   // false when runs.json doesn't exist
  readonly fileValid: boolean; // false when the file doesn't decode as Ledger
  readonly records: ReadonlyArray<LedgerRecord>;
  readonly skipped: { readonly newer: number; readonly invalid: number };
};
export const readLedger: (registryDir: string) =>
  Effect.Effect<LedgerRead, never, FileSystem.FileSystem | Path.Path>;
export const latestRecord: (records: ReadonlyArray<LedgerRecord>, key: LedgerKey) => LedgerRecord | null;
export const appendRecord: (registryDir: string, record: LedgerRecord) =>
  Effect.Effect<void, InvalidConfig, FileSystem.FileSystem | Path.Path>;
```

`LedgerKey` is `{ stack, with, preset, agent }`. Latest means the greatest `date`, and
the later position in the file on a tie. A missing ledger file reads as no records with
`present: false`. A file that doesn't decode as `Ledger` reads as no records with
`fileValid: false`, so `list` never fails on it; `appendRecord` refuses to append to it (`InvalidConfig`,
`details: { path }`) so a bad file is never overwritten. `appendRecord` writes the whole
file through a temporary file and rename, two-space JSON with a trailing newline, so diffs
stay one record per hunk.

### Importing the 1.6b gate runs

```
bun scripts/ledger-import.ts <run-note.md>... [--dry-run]
```

For each note in `plans/runs/` (format in [runs/README.md](../../runs/README.md)), the script:

1. Reads the fields the run-note format requires: stack and fragments with preset, repo
   commit, CLI, agent and version, brief size, times, verify count, interventions and
   outcome with `tamperCheck`. A note missing any of these is reported and skipped; the
   script never guesses a value.
2. Checks out the note's repo commit's registry: `git archive <commit> packages/cli/registry`
   extracted into a temporary directory. Only that path is extracted, and the working
   tree is never touched.
3. Composes the note's composition from that registry with the current code and computes
   `fingerprint`. Current code is right because the fingerprint answers "is today's
   content the content that ran", and today's code is what composes today's content. If
   the old registry doesn't load under the current entry format, the note is reported and
   skipped.
4. Maps the outcome: `green` with `tamperCheck: "full"` to `pass`, `partial` to `partial`,
   `failed` to `fail`, `infra` to `infra`; a `green` with `manifest-only` to `fail`. Sets
   `mode` from the note, `agentEnded: "exit"` unless the note says otherwise, and `run`
   from the final verify's `runs.jsonl` line if the note includes one.
5. Appends with `appendRecord`, or prints the records with `--dry-run`. A note whose
   (repo commit, stack, date) already has a record is skipped, so rerunning is safe.

The script uses Effect and the `Processes` service (roadmap, Contracts: Process service)
for `git`, with the same Node platform layer `bin.ts` uses. It is a development script:
excluded from the package's `files`, imported by no command.

When the prose changed after a gate run, the imported record's fingerprint differs from
the current content's. That is the honest answer, and 2.2 reports it as "changed since
last green".

### `stacks runs`

Run inside a project. It reads `.stacks/manifest.json`, the project state record
(roadmap, Contracts: Project state record), `.stacks/state/runs.jsonl` decoded line by
line with `RunRecord`, and `.stacks/NOTES.md`:

```ts
// src/schemas/runs.ts
export const ProjectRuns = Schema.Struct({
  stack: Schema.String,
  fingerprint: Schema.NullOr(Schema.String),  // from the manifest; null when new didn't record one
  createdAt: Schema.String,
  handoff: Schema.optional(Schema.String),    // 1.4's manifest record
  briefWords: Schema.Number,                  // recorded by new in the manifest
  verifyRuns: Schema.Number,
  lastOutcome: Schema.NullOr(Schema.String),  // outcome of the last decoded RunRecord
  minutesToGreen: Schema.NullOr(Schema.Number),
  minutesToFirstTest: Schema.NullOr(Schema.Number),
  interventions: Schema.NullOr(Schema.Number),
  stateRecord: Schema.Boolean,
  skippedLines: Schema.Number,
});
```

`minutesToGreen` and `minutesToFirstTest` come from the state record's `firstGreenAt` and
`firstTestPassAt` against `createdAt`, never from `runs.jsonl`, which lives in the project
and the agent can edit. Without a state record both are `null` and `stateRecord` is
`false`. `interventions` counts non-empty list lines under the `## Asked` heading of
`NOTES.md` up to the next heading; `null` without the file. `countAsked` is exported for
2.0b. Lines in `runs.jsonl` that don't decode, or carry a higher `schemaVersion`, are
skipped and counted in `skippedLines`; they never fail the command.

Human output is a short table with the same fields. No manifest found is `NotFound`
(exit 2), as for `verify`.

### `lastRun` in `list`

`list --json` gains `lastRun: { date, result, agent, preset, fingerprint } | null` per
stack: the latest record for that stack with `with: []`, over every agent and preset.
Human and agent `list` show `historical pass <date>` for `pass`, `<result> <date>` otherwise, or `unproven`. QA-03: the catalog does not compare current fingerprints; `show` owns that comparison. Historical data and JSON fields stay unchanged.
`list` doesn't compose, so it doesn't say whether the stack changed since; that is 2.2's
`ledger-changed` note. Only the bundled registry has a ledger; other origins show
`lastRun: null`.

### Failure modes

| Case | Handling | Exit |
|---|---|---|
| `runs` with no manifest | `NotFound` | 2 |
| `runs.jsonl` malformed or newer line | Skipped, counted in `skippedLines` | 0 |
| `runs.jsonl` missing | `verifyRuns: 0`, `lastOutcome: null` | 0 |
| Ledger missing or undecodable in `list` | `lastRun: null`; reported by 2.2's `validate` | 0 |
| `appendRecord` on an undecodable ledger | `InvalidConfig`, nothing written | 3 |
| Import: note missing a field, commit unknown to git, old registry won't load | Note reported and skipped; other notes continue; script exits 1 if any were skipped | 1 |

### Decided here

- The ledger is a reviewed file in the package. Reason: it ships with the CLI, so `list`
  can say "proven" offline, and every record is visible in a PR.
- Imports fingerprint the old registry with current code. Reason in the import steps.
- `LedgerRecord.agent` is an `AgentId`, not `DetectedAgent`: a ledger run always drove a
  named agent. The nested `run.agent` is the `DetectedAgent` 1.3b recorded inside that
  run and is kept unchanged.
- `lastRun` is a new optional field on each stack in `list --json`; every field 1.0
  defined keeps its shape (roadmap, Contracts: Entry and its listing).

## Files and areas touched

| Path (under `packages/cli/`) | Change |
|---|---|
| `src/schemas/ledger.ts`, `src/schemas/runs.ts` | `LedgerRecord`, `LedgerResult`, `Ledger`, `ProjectRuns` |
| `src/core/ledger.ts`, `src/core/runs.ts` | ledger read, lookup, append; project runs summary and `countAsked` |
| `src/commands/runs.ts`, `src/cli.ts` | `runs` command |
| `src/commands/list.ts`, `src/schemas/list.ts` | `lastRun` |
| `scripts/ledger-import.ts` | gate run import |
| `registry/runs.json` | the ledger, seeded from the 1.6b run notes |
| `package.json` | `ledger:import` script; `files` keeps excluding `scripts/` |
| `tests/ledger.test.ts`, `tests/runs.test.ts`, `tests/ledger-import.test.ts` | below |
| repo `AGENTS.md`, package README | `runs`, `lastRun`, the ledger and the import script |

## Acceptance tests

1. Ledger: a fixture with two records for one key returns the later date, and the later
   position on a tie; a record with `schemaVersion: 2` is counted in `skipped.newer` and a
   malformed record in `skipped.invalid`; `appendRecord` on a missing file creates
   `{ schemaVersion: 1, records: [r] }` and on an undecodable file fails `InvalidConfig`
   with the file unchanged.
2. `LedgerRecord` decodes a record whose `run` is a `RunRecord` produced by 1.3b's own
   `verify` in a test project, with no field mapping in between, including a `RunRecord`
   whose `agent` is `"other"`.
3. `runs` over a fixture project with a hand-written `runs.jsonl`, state record and
   `NOTES.md`: `minutesToGreen` comes from the state record even when `runs.jsonl` has an
   earlier green line; `interventions` counts `## Asked` lines and is `null` without
   `NOTES.md`; a malformed line is counted in `skippedLines`; no manifest gives
   `NotFound` and exit 2; no state record gives `stateRecord: false` and null minutes.
4. `list --json` shows `lastRun` from a fixture ledger, latest date winning, `null` for an
   unproven stack and for a stack from the user directory; every other field of each
   listed entry is unchanged from 1.0's output for the same registry.
5. Import: in a temporary git repository with two commits that differ in one stack's body,
   a fixture run note naming the first commit yields a record whose fingerprint equals
   `fingerprint` computed at the first commit and differs from the current one; a note
   missing the repo commit is skipped with exit 1; importing the same note twice adds one
   record.
6. The compiled binary (`bun run build` makes `packages/cli/dist/stacks`) reads
   the `registry/runs.json` it ships with, so `./dist/stacks list --json` shows a
   bundled stack's `lastRun`.

### Realistic edge cases

7. `runs` finds the project and its state through a symlinked nested cwd with spaces and non-ASCII names under an agent marker.
8. Missing, empty, malformed or newer history and ledger files, including a directory at the ledger path, do not invent proof or overwrite existing state.
9. `NOTES.md` counts only non-empty list items under `## Asked`, excluding wrapped prose and later headings; an empty or absent section counts zero.
10. Import skips an unknown commit or an old undecodable registry, continues with valid notes, handles paths with spaces and leading dashes, and dry-run leaves the working tree unchanged.
11. An append that cannot write keeps the existing ledger and unrelated files and leaves no temporary file behind.
12. A run with a green base and failed app remains a failed run in `runs`, and `LedgerRecord` preserves its optional `stages` unchanged.
13. Import maps partial, failed, infra and manifest-only green outcomes honestly, leaving absent optional final records and agent minutes null.

## Exit criteria

- `bun run check` green from the repo root.
- `registry/runs.json` holds one record per 1.6b gate run note, imported by the script,
  with fingerprints computed at each note's repo commit (and so marked changed by 2.2 if
  the prose moved after).
- `AGENTS.md` documents `runs`, `lastRun`, the ledger and the import script.

## What this plan may get wrong

- 2026-10-27 review: the driving agent is not the adapter target set (Contracts: Target
  agents). Imports default to Claude targets, independently of the driver, and accept an
  optional `Target agents` note row for recorded overrides. `LedgerRecord` has no adapter
  target field; later readers must settle how to reconstruct such overrides.
- 2026-10-27 review: project state lookup follows verify's project-id semantics, preserving
  timings after a move, and rejects a newer state schema with `InvalidConfig` (Contracts:
  Schema versions). A green Outcome row that contradicts its final `RunRecord` is skipped;
  a maintainer's partial classification is preserved over a green verify.

- 2026-10-27 implementation: registries with no ledger keep the existing text layout,
  as the unchanged 1.0 and audience tests require. When a ledger is present, stack rows
  show proven/result/unproven labels. JSON always carries `lastRun`, null without proof.

- 2026-10-27 implementation: gate notes list all composed fragments, while `LedgerRecord.with`
  means additions. The importer removes fragments selected by the default composition at the
  recorded commit. The three gate notes therefore have `with: []`.
- 2026-10-27 implementation: a compiled-binary note may identify its CLI version only in the
  optional final `RunRecord`; the importer uses that recorded version when the CLI row has no
  `stacks@<version>`. Abbreviated repo commits are resolved by git to full commit ids.
- 2026-10-27 implementation: `Manifest.stack` already permits null for the future `add`
  command, while `ProjectRuns.stack` is a string. A stackless manifest reports `"none"`.
- 2026-10-27 implementation: Bun consumes an initial option terminator before the script sees
  argv. Single-dash note names are accepted as positional arguments; long-option filenames
  need `./` when they would collide with an option.

- 2026-10-27: The tarball content check waits for 0.2; work currently runs from the compiled dev build.
- Old run notes may lack a field the import needs. The import skips rather than guesses,
  so a skipped gate run has to be rerun or its note completed by hand from the kept
  project.
- Interactive gate runs count `## Asked` lines the agent chose to log. That is a lower
  bound (open question 8); headless bench records are the better measure.
