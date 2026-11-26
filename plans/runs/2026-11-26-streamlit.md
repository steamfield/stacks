# Gate run: streamlit, 2026-11-26

| Field | Value |
|---|---|
| Stack and fragments | `streamlit`, no added fragments, preset `sandbox` |
| Repo commit | `797545b43d26add56c06cddba3a417a26c9814d3` |
| CLI | Compiled dev binary stacks@0.15.0, installed with the working registry |
| Agent | codex 0.171.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 3774, `fixedWords` 942 |
| Times | first passing `test`-layer step 0.9 min; first green `verify` 0.9 min |
| Verify count | 2 agent runs; 2 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 2.5 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

## Findings
- The bench command rejected a combined setup command containing scratch cleanup as destructive; the scratch directory remains outside the project.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-26T22:13:10.726Z","cli":"0.15.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":7877,"secondsSinceCreated":159,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":89},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":51},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":80},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":285},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":4726},{"name":"dev-cycle","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":900},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":10},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":11},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":6},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":527},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":13},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":39},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":34},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":176},{"name":"web","phase":"serve","layer":"serve","status":"passed","durationMs":920}]}
```
