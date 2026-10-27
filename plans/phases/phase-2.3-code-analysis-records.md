# Phase 2.3: Code-analysis records

Status: DRAFT 2026-10-26 (not agreed)

| Field | Value |
|---|---|
| Goal | Run static analysis over any directory — a project `new` built, a repo `add` touched, or this repo itself — using the open-source analyzers already on the machine, and write one SARIF 2.1.0 log per run that carries the measured facts and the quickstacks attribution a later backend, MCP server and search/score layer can read without inventing a data model |
| Traces to | The trust job ("the user wants to start work in a project they don't have to audit first") and the gap in [What success looks like](../product/PROBLEM_STATEMENT.md#what-success-looks-like): every row measures the recipe or the run, none measures the artifact. The record is the artifact's metadata rather than a new success row — settled by the maintainer, 2026-10-26: a success row states a claim the product makes, while this is data attached to a stack, and any statistic is derived later from records already stored |
| Depends on | Nothing in the repo. It is its own package with its own gate entry. Soft, optional coupling: reads `.quickstacks/manifest.json` when [1.2b](phase-1.2b-manifest-state-and-detection.md) writes it, and only to attribute a record |
| Blocks | Nothing. Feeds 4.1b (ingest), 4.2a (stats), 4.3 (MCP) and any scoring layer built on top of them |
| Decisions needed | Which analyzers ship in the first cut (question 1); whether tools are assumed present or provisioned (question 2) |
| Decisions or questions this settles | The record format and its extension block; the analyzer adapter contract; the attribution key; the exit contract; the tiering; what a partial record means |

## Why this exists, and why it is not already in the plan

Walked every sub-phase on 2026-10-26. All of them read or write registry content, or
record whether commands passed:

| Sub-phase | What it does | Why this is different |
|---|---|---|
| [1.3a](phase-1.3a-verify-runner-and-probes.md) `verify` | Runs the manifest's lint, typecheck, test and build steps | Answers pass or fail on the project's own commands. No measurement, no cross-language tooling, nothing kept |
| [2.0c](phase-2.0c-run-ledger.md) run records | One record per verify run: outcome, timing, step status | Describes the run, not the code |
| [2.2](phase-2.2-deterministic-rot-checks.md) rot checks | Shipped files against the composition: commands, hook wiring, ports, import closure | Author-time checks of registry content, inside `validate`. Never sees a built project |
| [4.2a](phase-4.2a-stats-rollup-and-routes.md) stats | Green rate, time to green, entry points | Aggregates usage events, not code properties |

The plan measures the recipe (budget, layers, composition) and the run (verify, ledger,
canary). Nobody measures the artifact. That is the gap this sub-phase fills, and it is
the one thing in the plan whose value does not depend on a decision, a canary or a
telemetry model.

## Scope

In:

- `packages/tools/analyze`, a standalone package with its own scripts and gate entry.
- Tier 0 measurements computed with no external tool: file inventory, language mix, line
  counts, test-file ratio, marker density, largest files, manifest and ecosystem
  detection.
- An adapter table for open-source analyzers that emit SARIF, run only when the binary is
  on `PATH`.
- A generic `--sarif <file>` input, so a tool with no adapter can still contribute.
- One SARIF 2.1.0 log per run, with a `quickstacks` extension block in
  `runs[0].properties`.
- Attribution from `.quickstacks/manifest.json` when present, an explicit `--label`
  otherwise.
- Deterministic output: the same tree twice produces identical results except for
  `runId`, `createdAt` and durations. `runId` is deliberately unique per run — a backend
  storing records needs one id per invocation, so it is excluded from the determinism
  comparison rather than derived from content.

Out:

- A database, an ORM, migrations, a server, an ingest endpoint. JSON files only.
- The MCP server (4.3), stats rollups (4.2a) and any scoring weights. Those read this
  format; they do not live here.
- A `quickstacks analyze` subcommand in `packages/cli`. Wiring it into the CLI is a
  later, separate change, and phase 1 owns `src/cli.ts` right now.
- Running anything a stack entry names (D2 stands). The analyzer runs a fixed, known
  set of analyzers against a directory the user names.

## Design

### SARIF is the record, not an export format

SARIF 2.1.0 is an OASIS standard (a JSON schema), not a library. It is what semgrep,
trivy, gitleaks, osv-scanner, CodeQL, ESLint's SARIF formatter, ruff and clippy-sarif
already emit, so the analyzer writes one log and every consumer reads one shape. What
this plan relies on, and nothing more:

| SARIF element | Used for |
|---|---|
| `runs[]` | One run per contributing tool, plus the envelope run at index 0 |
| `run.tool.driver` | Which tool, which version |
| `run.results[]` | The findings: `ruleId`, `level`, `message.text`, `locations`, `partialFingerprints` |
| `run.invocations[]` | Whether the tool ran, its start and end times |
| `run.artifacts[]` | Left empty in v1. The per-file inventory lives in `properties.quickstacks.metrics` instead, so a record over a large tree does not carry every path twice. An ingest that wants per-file rows asks for `--artifacts` later |
| `run.properties` | The `quickstacks` extension block (SARIF allows an arbitrary property bag here) |
| `partialFingerprints` | A stable id per finding, so a scoring layer can track one finding across runs |

Findings are not judged here. A `note` from a linter and an `error` from a security
scanner are both findings; what they are worth is the scoring layer's problem.

### Record shape

One log per run. `runs[0]` is the envelope: the inventory metrics, the tools
that did *not* run, and the attribution. `runs[1..n]` are each tool's own log,
passed through with artifact URIs rewritten to be relative to the target root.
A tool that ran successfully is not listed in the envelope — its own SARIF run
is its record.

```json
{
  "version": "2.1.0",
  "$schema": "https://docs.oasis-open.org/sarif/sarif/v2.1.0/cs01/schemas/sarif-schema-2.1.0.json",
  "runs": [
    {
      "tool": { "driver": { "name": "quickstacks-analyze", "version": "0.1.0" } },
      "invocations": [{ "executionSuccessful": true, "startTimeUtc": "...", "endTimeUtc": "..." }],
      "results": [],
      "originalUriBaseIds": { "%SRCROOT%": { "uri": "file:///abs/path/" } },
      "properties": {
        "quickstacks": {
          "recordVersion": 1,
          "runId": "01JB...",
          "createdAt": "2026-10-26T18:04:11Z",
          "target": { "digest": "sha256:...", "files": 214, "bytes": 918273,
                       "excluded": ["node_modules", "dist", ".git"] },
          "attribution": { "kind": "sandbox", "stack": "astro-blog", "with": [],
                           "preset": "default", "agent": "claude",
                           "fingerprint": "sha256:..." },
          "metrics": { "lines": 8123, "codeLines": 6904, "testRatio": 0.19,
                       "byLanguage": { "typescript": 61, "python": 22, "go": 17 },
                       "markers": { "TODO": 4, "FIXME": 1 }, "manifests": ["package.json"] },
          "toolsNotRun": [ { "id": "semgrep", "status": "absent" },
                           { "id": "eslint", "status": "skipped", "reason": "not-selected" },
                           { "id": "trivy", "status": "failed", "reason": "exit-code:2" } ]
        }
      }
    },
    { "tool": { "driver": { "name": "semgrep", "version": "1.x" } }, "results": [] }
  ]
}
```

`attribution` uses 2.0c's ledger key exactly — stack, `with`, preset, agent, fingerprint —
so a later ingest can join an analysis to a run record without a mapping table. Two
identities, and the difference is the point:

| Field | Identifies | Computed from |
|---|---|---|
| `fingerprint` | What we asked for: the composition | 2.0a's composition hash; absent until 1.2b writes a manifest |
| `target.digest` | What we got: the artifact | sha256 over the sorted (relative path, content) list, excluding ignored roots |

A stack's history is `fingerprint → digest → analysis`. A digest that has no fingerprint
is still a valid record: analysis of a repo `add` touched, or of this repo itself.

### Attribution

Read `.quickstacks/manifest.json` when it exists. Every field is optional and unknown
fields are ignored; a manifest that does not parse is a warning, not a failure, and the
record still lands with `kind: "label"` or `kind: "none"`. 1.2b owns that file's schema,
so this reader decodes the three fields it needs and nothing else. When 1.2b lands, the
tests gain a fixture built by the real `new` instead of a hand-written manifest.

### Tiers and the adapter contract

| Tier | What | Runs when |
|---|---|---|
| 0 | Inventory and metrics, computed in TypeScript | Always |
| 1 | Analysis tools whose binary resolves on `PATH`, each in the adapter table | Binary present |
| 2 | `--sarif <file>`: adopt a log produced elsewhere | Flag passed |

```ts
export type ToolStatus = "ran" | "absent" | "failed" | "timeout" | "skipped";

// Only non-ran statuses appear in properties.quickstacks.toolsNotRun.
// A tool that ran is recorded by its own SARIF run, not in this block.
export type ToolNotRunStatus = "absent" | "skipped" | "failed" | "timeout";

export type ToolNotRunEntry = {
  readonly id: string;
  readonly status: ToolNotRunStatus;
  readonly reason?: string;
};

export type ToolAdapter = {
  readonly id: string;                       // "semgrep", "ruff"
  readonly languages: ReadonlyArray<string>; // empty means any
  readonly binary: string;                   // resolved on PATH, never a shell string
  readonly version: (bin: string) => ReadonlyArray<string>; // argv for its version probe
  readonly sarif: (target: Target) => ReadonlyArray<string>; // argv; SARIF on stdout or a temp file
  readonly timeoutMs: number;
};
```

An adapter is data plus two argv builders. Adding an analyzer is one table entry and one
fake-binary test. No adapter ever builds a shell string: arguments are arrays, the
binary is resolved on `PATH`, and the process is spawned without a shell.

An adapter must be read-only with respect to the target. A tool that writes a cache or
log directory inside the target is not acceptable: it corrupts subsequent measurements
and makes the digest depend on what previously ran in the directory. A tool needing a
cache gets a disabling flag (e.g. ruff `--no-cache`) or a cache path outside the target
(a path under the temp dir or `HOME` — `HOME` is already set by the spawn). A tool that
cannot be tamed that way is not shipped as an adapter. Each entry's `note` records the
read-only conclusion and `verified` is set honestly.

The shipped table in the first cut is proposed as semgrep (multi-language), ruff
(Python), ESLint with its SARIF formatter (JS/TS), golangci-lint (Go), trivy
(dependencies and images) and gitleaks (secrets). Each entry's exact invocation is
verified against the installed binary when the entry is written — the plans' own rule,
applied here — and a test asserts the argv shape, not a remembered flag.

### Metrics without a tool

Computed in TypeScript so tier 0 always produces something:

- `files`, `bytes`, `lines`, `codeLines`, `blankLines`: line counts, with a per-language
  comment heuristic. Documented as an approximation, not true SLOC.
- `byLanguage`: share of lines per language, classified by extension and manifest.
- `testRatio`: test files over source files, by the language's own naming convention.
- `markers`: TODO, FIXME, HACK, XXX counts.
- `largestFiles`: top ten by lines, as SARIF artifacts.
- `manifests`: which dependency manifests exist, which is the ecosystem signal a scoring
  layer needs.

### Invocation and safety

- Only `analyze <path>` and the flags in this plan. No config file, no plugin loading.
- The analyzed directory is the process `cwd`; the output file is never written inside it
  unless `--out` names a path there.
- `invocations[].environmentVariables` is never populated. The record must not carry the
  environment, for the same reason `logging.ts` does not log argument values.
- Per-tool stdout is capped (32 MiB); a capped log is marked `truncated: true` and the
  tool is still `ran`.
- Teardown always runs: a tool that times out is killed by process group, recorded
  `timeout`, and the run continues.

### Exit contract

| Situation | Exit |
|---|---|
| A record was written, with or without findings and with or without tools | 0 |
| Bad path, unknown flag, unreadable output location | 2 |
| Defect (bug) | 1 |

Findings never fail the command. A future `--fail-on level` flag is the way to gate CI on
them, and it is out of scope here: the first consumer of this data is a database, not a
build.

### Failure modes

| Case | Handling |
|---|---|
| No analyzer installed | `toolsNotRun[].status: "absent"`; tier 0 record still lands; exit 0 |
| A tool excluded with `--tool` | `toolsNotRun[].status: "skipped"`, reason `not-selected`; the record shows the omission |
| A tool exits non-zero with valid SARIF 2.1.0 | `ran` — a non-zero exit is how linters signal "something was found", not a failure. The tool is not in `toolsNotRun`; its findings live in its own SARIF run |
| A tool exits non-zero with no stdout | `toolsNotRun[].status: "failed"`, reason `exit-code:N`; no results |
| A tool emits invalid SARIF | `toolsNotRun[].status: "failed"`, reason `invalid-sarif`; other runs kept |
| A tool emits SARIF 2.0.0 or another version | Rejected with `invalid-sarif` naming the version; never silently upgraded |
| Binary present but not executable | `toolsNotRun[].status: "failed"`, reason `not-executable` |
| Target directory is empty | Valid record, zero files, exit 0 |
| Output path unwritable | Exit 2, no partial file left behind (write to temp, rename) |
| Manifest present but malformed | Warning on stderr, `kind: "none"`, exit 0 |

## Decisions settled here

| Decision | Why |
|---|---|
| The record is a SARIF log, not a custom schema | Every tool already speaks it; the backend inherits a standard and needs no parser per tool |
| The envelope is `runs[0]`, tool logs follow verbatim | Each tool keeps its own driver and rule metadata, which a scoring layer needs to explain a finding |
| `quickstacks` metadata goes in `run.properties` | The one extension point the standard provides; nothing else is non-standard |
| Tier 0 always runs | A record with no tools installed is still a useful record, so the feature works on a bare machine and in CI |
| Findings never fail the command | This is a data producer, not a gate. `verify` is the gate |
| No build artifact in v1 | It runs from source under Bun. Packaging is 0.2's problem (A1) and is not re-decided here |
| No runtime dependencies | Keeps the package out of the root catalog, which is the one file the parallel phase-1 work also edits |
| Absolute base in `originalUriBaseIds`, relative artifact URIs | Records from different machines and OSes must aggregate in one database |
| Package home is `packages/tools/analyze` | Tools live under a `tools` namespace with one directory per tool; `analyze` is the first, so it nests under it. Settled by the maintainer: a flat `packages/<name>/` works for shipped packages, but tool packages are a distinct kind and get their own namespace so `packages/` does not become a grab bag |
| The record is stack metadata, not a success row | A success row states a claim the product makes; this is data attached to a stack. Settled by the maintainer: ship the metadata now and derive statistics from stored records later, so no weighting has to be frozen into the record |

## Files and areas touched

| Path | Change |
|---|---|
| `packages/tools/analyze/package.json` | New package, `@quickstacks/analyze`, private, standard scripts |
| `packages/tools/analyze/tsconfig.json` | Extends the base; no Bun types |
| `packages/tools/analyze/src/` | `bin.ts`, `main.ts`, `cli.ts`, `schemas/`, `core/` (inventory, digest, sarif, run, tools), `output.ts` |
| `packages/tools/analyze/tools.json` | The adapter table (data, so an entry is reviewable on its own) |
| `packages/tools/analyze/tests/` | Unit tests, fake tool binaries, a polyglot fixture tree |
| `packages/tools/analyze/e2e/` | Run the real entry point against the fixture, decode the log |
| `packages/tools/analyze/README.md` | Usage, the record shape, the tier table |
| `.claude/rules/analyze/analyze.md` | Path-scoped rules, per `docs/harness.md` |
| `plans/phases/phase-2.3-code-analysis-records.md` | This file |
| `plans/roadmap.md`, `AGENTS.md` | Phase 2 row, dependency-graph line, architecture map and commands — additive hunks only |

`plans/roadmap.md` and `AGENTS.md` are the only shared files this sub-phase edits, and
both edits are additive lines in different sections from anything phase 0.3 or phase 1
touches. If they conflict at merge time, the resolution is to keep both sides.

## Acceptance tests

- Tier 0 over a polyglot fixture: file count, language mix, line counts and marker counts
  match hand-computed values.
- Determinism: the same tree twice produces identical output once `runId`, `createdAt`,
  durations and invocation timestamps are removed.
- Digest: changes when a file byte changes, when a file is added, when a file is renamed;
  unchanged by touching mtime, by reordering directory entries, and by the presence of an
  ignored root (`node_modules/`, `dist/`, `.git/`). A symlink is skipped, never followed —
  content outside the target tree must not enter the record — and the count is reported as
  `skippedSymlinks`, the same hazard 1.0 avoids by rejecting symlinks in an entry.
- Tools not run: a fake binary that emits fixture SARIF records `ran` and does
  not appear in `toolsNotRun` — its findings live in its own SARIF run; a fake
  that prints valid SARIF and exits 1 also records `ran` (a non-zero exit is
  how linters signal findings); a fake that exits 2 with no stdout records
  `failed` in `toolsNotRun`; a fake that exits 0 with invalid JSON records
  `failed`; a missing binary records `absent`; a fake that sleeps past the
  timeout records `timeout` and the run still exits 0. Same fake-binary
  technique as 2.0c's bench tests, using one Node script with a `--mode` flag.
  A tool the user excluded with `--tool` is recorded `skipped` with reason
  `not-selected`, so a record distinguishes a deliberate omission from a missing
  binary.
- A malformed SARIF payload is rejected with `invalid-sarif`, naming the offending
  version, while other runs survive.
- `--sarif <file>` adopts an external log and attributes it to the same envelope.
- Attribution: with a manifest, `attribution` carries stack, fragments, preset and
  fingerprint; without one, `kind: "none"` and the record still validates; with a
  malformed manifest, a warning and exit 0.
- The output decodes against the shipped `SarifLog` schema, and every artifact URI is
  relative and POSIX-separated.
- No environment variable appears anywhere in the output (asserted by scanning the
  serialised log for the values of a set of planted variables).
- The packed package contains no test fixtures or fake binaries.

## Exit criteria

- `bun run check` green from the repo root, with the new package in the fan-out.
- `bun run --cwd packages/tools/analyze analyze .` produces a valid record for this repo.
- One record each for a TypeScript, a Python and a Go fixture tree, all three from the
  same command with no flags.
- `AGENTS.md` has the architecture-map and commands entries; the package README defines
  every metric, the tool statuses and the exit codes.
- The roadmap's phase 2 table, dependency graph and contracts table carry a 2.3 row.

## What this plan may get wrong

- **Naming.** `analyze` is one guess among several and the name is permanent once a
  package and a phase id exist. See question 2.
- **Tool flags drift.** Every adapter's invocation is verified against the installed
  binary when written, but an upstream rename breaks it silently as `failed`. The version
  probe in every record is what makes that visible later.
- **Tier 0 line counting is not SLOC.** The comment heuristic will over- or under-count
  for languages with unusual comment syntax. It is labelled as an approximation, and a
  scoring layer that cares should use a real counter.
- **`testRatio` by filename is a convention, not a fact.** A project with tests in an
  unusual place scores zero. It is a signal, not a verdict.
- **`partialFingerprints` are only as stable as the tools that emit them.** Some emit
  none; those findings cannot be tracked across runs until the tool does.
- **The record is bigger than the code it describes** for small targets. A trivy log on a
  two-file project is mostly boilerplate; the size cap and the tiering are the answer, and
  a later ingest may want to drop empty runs.
- **This is the first package in the repo that is not shipped to users.** If that turns
  out to be the wrong shape — if analysis should be a CLI command — the move is a thin
  command in `packages/cli` that calls this package, not a rewrite.

## Open questions for the maintainers

1. **Which analyzers ship in the first cut.** Proposed: the six in the adapter table,
   every one optional at runtime. The alternative is tier 0 plus `--sarif` only, which is
   smaller and defers every flag to the first user who needs one.
2. **Are tools assumed present, or provisioned?** Proposed: assumed present, never
   installed by the analyzer — it reports `absent` and moves on. Provisioning (a
   container image, a `tool:install` script) is a separate decision with a supply-chain
   cost, and D2's spirit argues against a tool that downloads binaries.
3. **Does the record belong in the analysed project?** Proposed: no — stdout by default,
   `--out` when a caller wants a file. Writing into the target means touching 1.2b's
   `.quickstacks/` contract, which this sub-phase should not do.
