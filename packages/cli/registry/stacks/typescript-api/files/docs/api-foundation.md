# API foundation

## Lint and boundaries

`biome.json` enforces cognitive complexity at most 15, at most four parameters, no nested ternaries, no non-null assertions, no floating or misused promises, and exhaustive switches; keep each rule when adapting it to the installed Biome release. Split complex functions into named steps; never suppress a rule to pass. Check undeclared dependencies in application source against each owning package. The shipped boundary test probes real files: stdin does not expose plugin diagnostics. Keep one smoke probe per Grit diagnostic, each reporting exactly one violation.

Only platform entries import runtime modules or use process globals. Application code takes time and randomness from Effect Clock and Random; only edges run Effects. Yield, return or compose every Effect instead of dropping it. Handlers return declared values or tagged errors, keeping response construction at the HTTP boundary.

## Test infrastructure

`tests/helpers/targets.ts` is the server-target matrix: each HTTP contract test is written once and runs against both a real Node listener on an ephemeral port and the platform-free web handler, each exposing a request function and captured structured records. Disable framework request logging on both so the request boundary logs once. Dispose both targets after every test, including failed startup.

A testServer helper owns its scope and registers cleanup when the test ends; tempDir creates real temporary files and removes them on completion. An expectEnvelope helper checks the table's status, JSON content type and the body decoded with the envelope schema. Derive helper types from the app and contract rather than copying their shapes. When the installed Effect release renames an API a helper uses, update the helper to it.

`vitest.config.ts` sets coverage floors of 90 percent for statements and lines and 80 percent for branches and functions; `coverage` and `check` enforce them. Run shipped tooling tests on Node alongside application tests. Include scripts/**/*.ts in the tooling typecheck; check application tests with their owning project.

## Development records

Query `dev:status` before starting more servers. Use logs --level warn --since 10m, --request <id>, --path <prefix>, --grep <text>, --tail <n>, --prev or --json to inspect failures. The wrapper records non-API output in logs/dev.jsonl, terminal output in logs/dev.log, and the API writes logs/server.jsonl through LOG_FILE. API terminal records are not duplicated. Each start preserves *.prev.*; an active file past 10 MiB rotates to *.old.*. The API's development file sink must enforce the same cap without replacing *.prev.*. A stopped server's signal-exit note is informational, not an application error. Production logs remain JSON on stdout.

SessionStart reuses the status report and stays quiet when it fails; dev:status exposes failures for diagnosis. Test changes with the shipped tooling tests and `.claude/hooks/smoke.sh`.
