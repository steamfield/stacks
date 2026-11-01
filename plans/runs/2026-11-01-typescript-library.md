# Gate run: typescript-library, 2026-11-01

| Field | Value |
|---|---|
| Stack and fragments | `typescript-library`, no added fragments, preset `sandbox` |
| Repo commit | `437bd5988999a34ad732fd25bdba08fa50d8147e` |
| CLI | Compiled dev binary stacks@0.6.0, installed with the working registry |
| Agent | codex 0.165.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 3777, `fixedWords` 819 |
| Times | first passing `test`-layer step 1.1 min; first green `verify` 1.1 min |
| Verify count | 1 agent runs; 1 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 1.2 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-01T23:00:38.857Z","cli":"0.6.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":4893,"secondsSinceCreated":77,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":97},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":38},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":166},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":181},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":1964},{"name":"build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":205},{"name":"package-lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":1049},{"name":"consumer","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":444},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":10},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":4},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":511},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":14},{"name":"harness-hooks","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"harness-doc-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":6},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":28},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":25},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":129}]}
```
