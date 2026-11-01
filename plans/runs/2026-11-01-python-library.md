# Gate run: python-library, 2026-11-01

| Field | Value |
|---|---|
| Stack and fragments | `python-library`, no added fragments, preset `sandbox` |
| Repo commit | `437bd5988999a34ad732fd25bdba08fa50d8147e` |
| CLI | Compiled dev binary stacks@0.6.0, installed with the working registry |
| Agent | codex 0.165.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 3493, `fixedWords` 814 |
| Times | first passing `test`-layer step 1.7 min; first green `verify` 1.7 min |
| Verify count | 1 agent runs; 1 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 2.0 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

- No author or repository remote was supplied; used run contributors for attribution and linked to the PyPI project page for documentation access.
- Python.org lists 3.15 as stable, but the installed uv catalog offers only 3.15.0rc3; the development pin selects 3.15 and uses the available interpreter.
- The command guard rejected removal of the temporary generator directory; it remains at /tmp/run-uv-scaffold.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-01T23:04:41.078Z","cli":"0.6.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":6431,"secondsSinceCreated":129,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":81},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":42},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":96},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":239},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":1802},{"name":"test-min","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":1885},{"name":"build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":266},{"name":"smoke","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":763},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":10},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":13},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":7},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":885},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":73},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":59},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":35},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":164}]}
```
