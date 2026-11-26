# Gate run: typescript-api, 2026-11-26

| Field | Value |
|---|---|
| Stack and fragments | `typescript-api`, no added fragments, preset `sandbox` |
| Repo commit | `c2a8261572ae58bdf3c4314154069b850f3233f7` |
| CLI | Compiled dev binary stacks@0.15.0, installed with the working registry |
| Agent | codex 0.171.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 4299, `fixedWords` 989 |
| Times | first passing `test`-layer step 0.8 min; first green `verify` 2.2 min |
| Verify count | 3 agent runs; 3 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 3.4 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

- The background development wrapper selects an available port rather than always using the API default of 3000; use its reported URL.
- The brief calls the HTTP guidance `effect-api.md` without its directory; it is in `docs/guidance/typescript-api/`.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-26T19:11:37.469Z","cli":"0.15.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":11026,"secondsSinceCreated":215,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":92},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":51},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":242},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":309},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":5421},{"name":"http-contract","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":1066},{"name":"build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":61},{"name":"dev-cycle","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":1639},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":10},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":4},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":473},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":13},{"name":"claude-typecheck-hook","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":16},{"name":"harness-doc-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"schema-conventions","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":384},{"name":"no-standalone-schema","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"effect-testkit","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":385},{"name":"effect-api-reference","phase":"check","layer":"docs","status":"passed","exitCode":0,"durationMs":39},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":33},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":31},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":167},{"name":"api-conventions","phase":"check","layer":"docs","status":"passed","exitCode":0,"durationMs":9},{"name":"api","phase":"serve","layer":"serve","status":"passed","durationMs":551}]}
```
