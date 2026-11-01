# Gate run: tauri-react, 2026-11-01

| Field | Value |
|---|---|
| Stack and fragments | `tauri-react`, no added fragments, preset `sandbox` |
| Repo commit | `3f1af2c7fbc46981c4f51c07de407817c19aab8b` |
| CLI | Compiled dev binary stacks@0.6.0, installed with the working registry |
| Agent | codex 0.165.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 4482, `fixedWords` 910 |
| Times | first passing `test`-layer step 4.1 min; first green `verify` 4.1 min |
| Verify count | 1 agent runs; 1 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 4.2 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

- The package scope is unspecified; chose `local` for `com.local.run`.
- Node 26 is the current LTS major; recorded the installed 26.10.0.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-01T23:53:54.993Z","cli":"0.6.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":31561,"secondsSinceCreated":302,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":884},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":36},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":1173},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":651},{"name":"check-targets","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":464},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":4752},{"name":"bindings","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":1307},{"name":"architecture","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":234},{"name":"e2e","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":8431},{"name":"build","phase":"check","layer":"build","status":"skipped","durationMs":0},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":27},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":47},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":43},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":35},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":1788},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":16},{"name":"harness-hooks","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":6},{"name":"harness-doc-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":75},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":165},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":322},{"name":"web","phase":"serve","layer":"serve","status":"passed","durationMs":11094}]}
```
