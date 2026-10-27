# packages/tools/analyze

A tool package, not a shipped surface: it measures a directory of code and writes one SARIF 2.1.0
record. Nothing here is imported by another package, and nothing here ships to a user. The repo
`AGENTS.md` carries the monorepo conventions and the commands; the phase plan in
`plans/phases/phase-2.3-code-analysis-records.md` carries the design and the open questions.

Read this before changing how a run behaves, because four constraints carry the whole feature and
each one was learned by breaking it.

## The record describes the code, not the analysers

A tool that produced findings is described by its own SARIF run — name, version, results. It is
not listed anywhere else. `properties.quickstacks.toolsNotRun` exists only for the tools that
produced no run (`absent`, `skipped`, `failed`, `timeout`, with a `reason`), which is what tells a
reader the record is partial. Do not add a per-tool catalogue back "for convenience": it duplicates
the standard and drifts from it.

## Analysis is read-only with respect to the target

No adapter may write into the directory it analyses, caches included — `ruff` gets `--no-cache`
for that reason. A tool that needs a cache gets a flag disabling it or a cache path outside the
target; a tool that cannot be tamed that way is not shipped as an adapter. `EXCLUDED_NAMES` in
`digest.ts` is the tool's own ignore policy and cannot be delegated to `.gitignore`: the target may
not be a repository, nested repositories carry their own rules, and the digest has to be identical
on every machine. A run over the same source twice must produce the same digest.

## A non-zero exit is not a failed run

Linters exit non-zero *because* they found something. Success means "emitted valid SARIF 2.1.0",
not "exited 0". `failed` is reserved for no parseable SARIF, a foreign or invalid version, or a
parse failure. Getting this backwards reports every real project as clean.

## Boundaries

Zero runtime dependencies, nothing in `dependencies`, dev tooling via `catalog:`. No Bun APIs in
`src/` — core runs unchanged under Node, and `src/bin.ts` is the only module touching
`process.argv`, `process.exitCode` or signals. `src/output.ts` is the only place stdout or stderr
is written. No shell strings: spawn with an argv array, no `shell: true`, resolved on `PATH`,
killed by process group. No environment variable values reach the record.

`src/schemas/sarif.ts` is a deliberate subset of SARIF 2.1.0 — only the members this package reads
or writes. Extend it when a reader needs a field, never speculatively; the specification is the
authority, this file is not.

## Tests

Fixtures stay in this package's own language: `tests/fixtures/bin/fake-tool.mjs` is one executable
with a `--mode=` switch, not a set of shell scripts, and it defines the SARIF payload once. Never
weaken, skip or delete a test to reach green; start a bug fix with a failing regression. Most of
what this package got wrong was found by running it over a real tree, not by reading it.

