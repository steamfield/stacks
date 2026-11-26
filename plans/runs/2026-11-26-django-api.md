# Gate run: django-api, 2026-11-26

| Field | Value |
|---|---|
| Stack and fragments | `django-api`, no added fragments, preset `sandbox` |
| Repo commit | `797545b43d26add56c06cddba3a417a26c9814d3` |
| CLI | Compiled dev binary stacks@0.15.0, installed with the working registry |
| Agent | codex 0.171.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 4461, `fixedWords` 952 |
| Times | first passing `test`-layer step 1.4 min; first green `verify` 1.4 min |
| Verify count | 2 agent runs; 2 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 3.1 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

## Findings
- The brief lists two verify paths; the bench rules require the bench wrapper.

- The CI decisions default to Dependabot, but the sandbox-specific CI instructions explicitly defer it; deferred it.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-26T22:20:37.737Z","cli":"0.15.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":46352,"secondsSinceCreated":234,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":77},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":43},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":76},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":293},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":5544},{"name":"migrations","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":316},{"name":"openapi-drift","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":387},{"name":"deploy-check","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":375},{"name":"build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":586},{"name":"dev-cycle","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":36622},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":4},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":410},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":11},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":29},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":28},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":135},{"name":"api-conventions","phase":"check","layer":"docs","status":"passed","exitCode":0,"durationMs":7},{"name":"api","phase":"serve","layer":"serve","status":"passed","durationMs":1385}]}
```
