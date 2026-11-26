# Gate run: react-native, 2026-11-26

| Field | Value |
|---|---|
| Stack and fragments | `react-native`, no added fragments, preset `sandbox` |
| Repo commit | `f18d4d2e49d68fa8d6763acfc4f13f9b81192999` |
| CLI | Compiled dev binary stacks@0.15.0, installed with the working registry |
| Agent | codex 0.171.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 4161, `fixedWords` 863 |
| Times | first passing `test`-layer step 4.0 min; first green `verify` 4.0 min |
| Verify count | 2 agent runs; 2 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 4.0 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

- The brief does not specify a package scope; used the conventional example scope `com.example.run`.
- The initial verify overlapped a pod install and failed due to competing codegen; subsequent installs must run sequentially.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-26T19:50:33.313Z","cli":"0.15.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":64313,"secondsSinceCreated":318,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":95},{"name":"pods","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":9606},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":56},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":221},{"name":"lint-native","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":48},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":108},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":4622},{"name":"bundle","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":1408},{"name":"ios-build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":35107},{"name":"ios-test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":12263},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":11},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":6},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":473},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":12},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":35},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":35},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":189}]}
```
