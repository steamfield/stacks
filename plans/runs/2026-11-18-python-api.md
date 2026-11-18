# Gate run: python-api, 2026-11-18

| Field | Value |
|---|---|
| Stack and fragments | `python-api`, no added fragments, preset `sandbox` |
| Repo commit | `985cc6158ae430e33debf1527dc0f494ba360518` |
| CLI | Compiled dev binary stacks@0.14.1, installed with the working registry |
| Agent | Claude Code 2.1.327, headless; explicit --agent |
| Credentials | token |
| Model | sonnet |
| Effort | agent default |
| Target agents | `claude` |
| Brief size | `briefWords` 3413, `fixedWords` 945 |
| Times | first passing `test`-layer step 0.7 min; first green `verify` 0.7 min |
| Verify count | 1 agent runs; 1 wrapper calls |
| Interventions | 3 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit (success); 11 turns |
| Agent minutes | 0.9 |
| Hooks fired | block-destructive.sh, format-changed.sh, session-start.sh |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

## Asked

- Brief says `stacks verify`; BENCH.md says use bench/verify. Used bench/verify.
- Brief gives no ruff target-version value; set py314 to match the pinned Python.
- GitHub action majors looked up via git ls-remote: checkout v7, setup-uv v7. actionlint/zizmor not installed, so not run.


## Run record

```json
{"schemaVersion":1,"at":"2026-11-18T14:32:47.711Z","cli":"0.14.1","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":4391,"secondsSinceCreated":57,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":88},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":53},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":80},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":195},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":2352},{"name":"openapi-drift","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":327},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":10},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":344},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":13},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":35},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":32},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":166},{"name":"api","phase":"serve","layer":"serve","status":"passed","durationMs":669}]}
```
