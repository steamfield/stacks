# Gate run: python-api, 2026-11-01

| Field | Value |
|---|---|
| Stack and fragments | `python-api`, no added fragments, preset `sandbox` |
| Repo commit | `3f1af2c7fbc46981c4f51c07de407817c19aab8b` |
| CLI | Compiled dev binary stacks@0.6.0, installed with the working registry |
| Agent | codex 0.165.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 3349, `fixedWords` 899 |
| Times | first passing `test`-layer step 1.1 min; first green `verify` 1.1 min |
| Verify count | 1 agent runs; 1 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 1.3 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

## Findings
- The bench requires its verify wrapper rather than the brief’s direct stacks command.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-01T23:58:15.225Z","cli":"0.6.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":4304,"secondsSinceCreated":82,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":63},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":33},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":70},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":170},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":2187},{"name":"openapi-drift","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":353},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":29},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":32},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":505},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":12},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":24},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":21},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":103},{"name":"api","phase":"serve","layer":"serve","status":"passed","durationMs":690}]}
```
