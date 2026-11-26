# Gate run: react-native, 2026-11-26

| Field | Value |
|---|---|
| Stack and fragments | `react-native`, no added fragments, preset `sandbox` |
| Repo commit | `620490108b9a80ea1423d3d5887ddd1f64525af8` |
| CLI | Compiled dev binary stacks@0.15.0, installed with the working registry |
| Agent | codex 0.171.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 4075, `fixedWords` 863 |
| Times | first passing `test`-layer step 4.9 min; first green `verify` 4.9 min |
| Verify count | 2 agent runs; 2 wrapper calls |
| Interventions | 0 |
| Outcome | `failed`, tamperCheck: "full"; ledger result fail |
| Agent ended | exit; 1 turns |
| Agent minutes | 6.0 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

- The package scope was unspecified; chose example, yielding com.example.run.
- The brief names three React Native hooks absent from the starter; added them for the requested smoke cases.

- The shell guard rejected removal of the temporary native generator directory; left it in place.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-26T19:27:10.016Z","cli":"0.15.0","agent":"none","outcome":"failed","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":1243,"secondsSinceCreated":376,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":115},{"name":"pods","phase":"setup","layer":"install","status":"failed","failureKind":"step","exitCode":1,"durationMs":1127},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"skipped","durationMs":0},{"name":"lint","phase":"check","layer":"lint","status":"skipped","durationMs":0},{"name":"lint-native","phase":"check","layer":"lint","status":"skipped","durationMs":0},{"name":"typecheck","phase":"check","layer":"typecheck","status":"skipped","durationMs":0},{"name":"test","phase":"check","layer":"test","status":"skipped","durationMs":0},{"name":"bundle","phase":"check","layer":"build","status":"skipped","durationMs":0},{"name":"ios-build","phase":"check","layer":"build","status":"skipped","durationMs":0},{"name":"ios-test","phase":"check","layer":"test","status":"skipped","durationMs":0},{"name":"readme-filled","phase":"check","layer":"check","status":"skipped","durationMs":0},{"name":"agents-md-filled","phase":"check","layer":"check","status":"skipped","durationMs":0},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"skipped","durationMs":0},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"skipped","durationMs":0},{"name":"hooks-smoke","phase":"check","layer":"check","status":"skipped","durationMs":0},{"name":"ci-workflow","phase":"check","layer":"check","status":"skipped","durationMs":0},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"skipped","durationMs":0},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"skipped","durationMs":0},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"skipped","durationMs":0}]}
```
