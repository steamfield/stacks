# @quickstacks/analyze

Run static analysis over any directory and write one SARIF 2.1.0 log per run that
carries the measured facts and the quickstacks attribution a later backend, MCP
server and scoring layer can read without inventing a data model.

This package has **zero runtime dependencies** and runs from source under Bun. It
does not ship a build artifact in v1.

## Usage

```
bun run src/bin.ts <path> [options]
```

```
Usage: analyze <path> [options]

Arguments:
  <path>                 Directory to analyze (defaults to the current directory).

Options:
  --out <file>           Write the record to <file> instead of stdout.
  --label <string>       Label attribution when no manifest is present.
  --sarif <file>         Adopt a SARIF log produced elsewhere (repeatable).
  --tool <id>            Run only the named tool adapter id (repeatable).
  --exclude <glob>       Exclude paths matching the glob (repeatable).
  --json                 Emit JSON (default; accepted for symmetry).
  --help                 Show this help and exit.
  --version              Show the version and exit.
```

The output is always a SARIF 2.1.0 JSON document. `--json` exists only for
symmetry with the rest of the CLI surface; it is the default.

## The record shape

One log per run. `runs[0]` is the **envelope**: the inventory metrics, the
tools that did *not* run, and the attribution. `runs[1..n]` are each tool's
own log and any `--sarif` logs adopted from elsewhere, all passed through with
artifact URIs rewritten to be relative to the target root and the absolute
base recorded in `originalUriBaseIds`. A tool that ran successfully is **not**
listed in the envelope — its own SARIF run is its record.

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
          "runId": "run-...",
          "createdAt": "2026-10-26T18:04:11Z",
          "target": { "digest": "sha256:...", "files": 6, "bytes": 918, "excluded": ["node_modules", "dist", ".git", "coverage", "vendor", "target"], "skippedSymlinks": 0 },
          "attribution": { "kind": "manifest|label|none", "stack": "...", "with": [], "preset": "...", "agent": "...", "fingerprint": "sha256:..." },
          "metrics": { "files": 6, "bytes": 918, "lines": 46, "codeLines": 29, "blankLines": 6, "commentLines": 6, "byLanguage": { "typescript": 48, "python": 22, "go": 15 }, "testRatio": 0.3333, "testFiles": 1, "sourceFiles": 3, "markers": { "TODO": 3, "FIXME": 2, "HACK": 0, "XXX": 0 }, "largestFiles": [], "manifests": ["go.mod", "package.json"] },
          "toolsNotRun": [
            { "id": "semgrep", "status": "absent" },
            { "id": "eslint", "status": "skipped", "reason": "not-selected" },
            { "id": "trivy", "status": "failed", "reason": "exit-code:2" }
          ]
        }
      }
    }
  ]
}
```

`attribution` reuses 2.0's ledger key — `stack`, `with`, `preset`, `agent`,
`fingerprint` — so a later ingest can join an analysis to a run record without a
mapping table. `kind` is `manifest` when `.quickstacks/manifest.json` was read,
`label` when `--label` was supplied without a manifest, and `none` otherwise.

| Field | Identifies | Computed from |
|---|---|---|
| `attribution.fingerprint` | What we asked for: the composition | 2.0's composition hash; absent until 1.2 writes a manifest |
| `target.digest` | What we got: the artifact | sha256 over the sorted (relative path, content) list, excluding ignored roots |

## Tiers

| Tier | What | Runs when |
|---|---|---|
| 0 | Inventory and metrics, computed in TypeScript | Always |
| 1 | Analysis tools whose binary resolves on `PATH`, each in the adapter table (`tools.json`) | Binary present |
| 2 | `--sarif <file>`: adopt a log produced elsewhere | Flag passed |

A record with no tools installed is still a useful record, so tier 0 always runs.

## Tool statuses

A tool that ran successfully is **not** listed in `properties.quickstacks.toolsNotRun`
— its own SARIF run is its record, so listing it again would be duplicated
bookkeeping that drifts. Only tools that did *not* run appear, each with an
`id`, a `status`, and a `reason` when applicable. Entries are sorted by the
adapter order in `tools.json` so two runs of the same input produce the same
order.

| Status | Meaning |
|---|---|
| `absent` | The binary was not found on `PATH`; never an error |
| `skipped` | `--tool` was given and this adapter was not selected; `reason` is `not-selected` |
| `failed` | No parseable SARIF was emitted: the tool exited with no stdout, emitted invalid JSON, or emitted a foreign SARIF version. `reason` carries the detail (`exit-code:N`, `invalid-sarif: …`) |
| `timeout` | The tool exceeded its `timeoutMs` and was killed by process group |

A non-zero exit with valid SARIF 2.1.0 is a successful measurement with
findings — that is how ruff, eslint, semgrep, golangci-lint and gitleaks signal
"something was found". The runner records `ran`, keeps the findings in the
tool's own SARIF run, and the tool does not appear in `toolsNotRun`. Findings
never change the command exit code. A truncated run (stdout exceeded the 32 MiB
cap) is still `ran`; the cap is a safety measure, not a failure.

## Metric definitions (tier 0)

All line counts are computed in TypeScript and are an **approximation**, not true
SLOC. A scoring layer that cares should use a real counter.

- `files`, `bytes`: count and byte total of every non-excluded file.
- `lines`: number of lines after splitting on `\n`.
- `codeLines`: non-blank lines that do not start with a comment, using a
  per-language comment heuristic (`//` and `/* */` for slash languages, `#` for
  hash languages, `<!-- -->` for HTML, `/* */` for CSS).
- `blankLines`: empty or whitespace-only lines.
- `commentLines`: lines whose trimmed content begins with a comment marker.
- `byLanguage`: integer percentage of `codeLines` per language, classified by file
  extension. Data/markup languages (json, yaml, toml, markdown) are classified
  but excluded from `testRatio`.
- `testRatio`: test files over source files, by each language's own naming
  convention (`.test.`/`.spec.` for JS/TS, `test_`/`_test.py` for Python,
  `_test.go` for Go, a `tests/`/`__tests__/` directory for anything).
- `markers`: count of `TODO`, `FIXME`, `HACK`, `XXX` whole-word occurrences.
- `largestFiles`: top ten files by `lines`.
- `manifests`: dependency manifests detected (`package.json`, `pyproject.toml`,
  `go.mod`, `Cargo.toml`, etc.), the ecosystem signal.

## Exit codes

| Situation | Exit |
|---|---|
| A record was written, with or without findings and with or without tools | 0 |
| Bad path, unknown flag, unreadable output location | 2 |
| Defect (bug) | 1 |

Findings never fail the command. A future `--fail-on level` flag is the way to
gate CI on them, and it is out of scope here.

## How to add a tool adapter

`tools.json` is the adapter table — data, not code. Each entry is reviewable on
its own:

```json
{
  "id": "semgrep",
  "languages": [],
  "binary": "semgrep",
  "versionArgv": ["--version"],
  "sarifArgv": ["scan", "--sarif", "--config", "auto", "{target}"],
  "timeoutMs": 120000,
  "verified": false,
  "note": "Confirm --sarif writes SARIF 2.1.0 to stdout against the installed binary."
}
```

- `id` — the adapter id; pass it to `--tool` to run only that adapter.
- `languages` — empty means any language; otherwise the languages the tool covers.
- `binary` — resolved on `PATH`. An absolute path is accepted too. Never a shell
  string.
- `versionArgv` — argv for the version probe; the first trimmed stdout line is
  recorded as `version`.
- `sarifArgv` — argv that makes the tool emit SARIF on stdout. The `{target}`
  placeholder is substituted with the absolute target path.
- `timeoutMs` — per-tool timeout; on expiry the process group is killed and the
  tool records `timeout`.
- `verified` — `false` until a human has confirmed the flags against the
  installed binary. Never invent a flag you have not seen documented; if a tool's
  SARIF invocation is uncertain, leave the entry present with `verified: false`
  and a `note` saying which flag to confirm.

The runner spawns without a shell (`node:child_process` `spawn`, argv array, no
`shell: true`), kills by process group, and caps stdout at 32 MiB. Add one
fake-binary test under `tests/` that exercises the new adapter's ledger state.

## Determinism

The same tree twice produces byte-identical output once `createdAt`, durations,
invocation timestamps and `runId` are removed. Directory reads are sorted; no
timestamps inside hashed data. `runId` is unique per invocation (`run-<compact
UTC timestamp>-<8 hex>`), so a backend storing records gets one id per run; it
must be stripped alongside the other volatile fields when comparing runs for
determinism.

Symlinks are never followed by the digest: a symlink inside the target is
skipped and counted as `target.skippedSymlinks`, so content outside the tree
cannot be hashed into the record.

## Read-only analysis

Analysis is a measurement: it never writes into the target directory. Every
adapter in `tools.json` is audited to ensure it either disables its cache
(e.g. ruff `--no-cache`) or stores cache data outside the target (under `HOME`,
which the spawn controls). A tool that cannot be tamed this way is not shipped
as an adapter. A run over the same source twice yields the same digest
regardless of what has previously run in that directory — generated directories
like `.ruff_cache/`, `__pycache__/`, `.mypy_cache/`, `.pytest_cache/`,
`.eslintcache`, `.semgrep/`, `.gradle/`, `.next/`, `.turbo/`, `.cache/` are
excluded from the digest and inventory alongside `node_modules/`, `dist/`,
`.git/`, `coverage/`, `vendor/`, and `target/`.