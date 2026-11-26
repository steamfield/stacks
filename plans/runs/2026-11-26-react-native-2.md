# Gate run: react-native, 2026-11-26

| Field | Value |
|---|---|
| Stack and fragments | `react-native`, no added fragments, preset `sandbox` |
| Repo commit | `562c00461cb5be7531fbc1c0613b024338c8e723` |
| CLI | Compiled dev binary stacks@0.15.0, installed with the working registry |
| Agent | codex 0.171.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 4161, `fixedWords` 863 |
| Times | first passing `test`-layer step 3.8 min; first green `verify` 3.8 min |
| Verify count | 2 agent runs; 2 wrapper calls |
| Interventions | 0 |
| Outcome | `failed`, tamperCheck: "full"; ledger result fail |
| Agent ended | exit; 1 turns |
| Agent minutes | 5.1 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

- The brief does not specify a package scope; chose example for com.example.run.
- Start here says install first, but stack setup requires generating first; followed the more specific setup.
- Two concurrent pod installs collided; the first failed with a file-exists error, so subsequent installs must run sequentially.

- The command guard rejected removal of the temporary generator directory; it remains outside the project.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-26T19:40:41.984Z","cli":"0.15.0","agent":"none","outcome":"failed","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":829,"secondsSinceCreated":317,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":105},{"name":"pods","phase":"setup","layer":"install","status":"failed","failureKind":"step","exitCode":1,"durationMs":722},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"skipped","durationMs":0},{"name":"lint","phase":"check","layer":"lint","status":"skipped","durationMs":0},{"name":"lint-native","phase":"check","layer":"lint","status":"skipped","durationMs":0},{"name":"typecheck","phase":"check","layer":"typecheck","status":"skipped","durationMs":0},{"name":"test","phase":"check","layer":"test","status":"skipped","durationMs":0},{"name":"bundle","phase":"check","layer":"build","status":"skipped","durationMs":0},{"name":"ios-build","phase":"check","layer":"build","status":"skipped","durationMs":0},{"name":"ios-test","phase":"check","layer":"test","status":"skipped","durationMs":0},{"name":"readme-filled","phase":"check","layer":"check","status":"skipped","durationMs":0},{"name":"agents-md-filled","phase":"check","layer":"check","status":"skipped","durationMs":0},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"skipped","durationMs":0},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"skipped","durationMs":0},{"name":"hooks-smoke","phase":"check","layer":"check","status":"skipped","durationMs":0},{"name":"ci-workflow","phase":"check","layer":"check","status":"skipped","durationMs":0},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"skipped","durationMs":0},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"skipped","durationMs":0},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"skipped","durationMs":0}]}
```
