# Gate run: django-api, 2026-11-01

| Field | Value |
|---|---|
| Stack and fragments | `django-api`, no added fragments, preset `sandbox` |
| Repo commit | `437bd5988999a34ad732fd25bdba08fa50d8147e` |
| CLI | Compiled dev binary stacks@0.6.0, installed with the working registry |
| Agent | codex 0.165.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 4216, `fixedWords` 906 |
| Times | first passing `test`-layer step 1.5 min; first green `verify` 1.5 min |
| Verify count | 1 agent runs; 1 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 1.5 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

- Python 3.15 resolves to a release candidate in the available uv catalog; 3.14 is the newest stable interpreter.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-01T23:07:10.816Z","cli":"0.6.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":10742,"secondsSinceCreated":104,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":70},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":35},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":76},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":286},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":4525},{"name":"migrations","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":594},{"name":"openapi-drift","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":745},{"name":"deploy-check","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":480},{"name":"build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":1170},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":12},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":14},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":7},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":693},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":14},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":31},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":25},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":137},{"name":"api-conventions","phase":"check","layer":"docs","status":"passed","exitCode":0,"durationMs":9},{"name":"api","phase":"serve","layer":"serve","status":"passed","durationMs":1807}]}
```
