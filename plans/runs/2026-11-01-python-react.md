# Gate run: python-react, 2026-11-01

| Field | Value |
|---|---|
| Stack and fragments | `python-react`, no added fragments, preset `sandbox` |
| Repo commit | `3f1af2c7fbc46981c4f51c07de407817c19aab8b` |
| CLI | Compiled dev binary stacks@0.6.0, installed with the working registry |
| Agent | codex 0.165.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 4341, `fixedWords` 911 |
| Times | first passing `test`-layer step 1.7 min; first green `verify` 1.7 min |
| Verify count | 1 agent runs; 1 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 1.9 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

- The available uv Python catalog lists 3.15 only as a release candidate, so selected stable 3.14 from that catalog.
- React Router typegen added its required isbot dependency automatically.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-01T23:51:32.810Z","cli":"0.6.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":33307,"secondsSinceCreated":163,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":386},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":57},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":288},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":1277},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":4266},{"name":"home-route-test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":1149},{"name":"api-contract","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":574},{"name":"build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":2149},{"name":"e2e","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":7483},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":10},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":12},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":6},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":6},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":646},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":14},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":31},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":25},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":148},{"name":"api","phase":"serve","layer":"serve","status":"passed","durationMs":697},{"name":"web","phase":"serve","layer":"serve","status":"passed","durationMs":14076}]}
```
