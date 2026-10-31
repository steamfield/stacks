# Gate run: python-react, 2026-10-28

| Field | Value |
|---|---|
| Stack and fragments | `python-react`, no added fragments, preset `sandbox` |
| Repo commit | `de89876ab5dd34c1f39ee943ef3feb2f0265bcb2` |
| CLI | Compiled dev binary stacks@0.3.1, installed with the working registry |
| Agent | codex 0.165.0, headless; explicit --agent |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Target agents | `codex` |
| Brief size | `briefWords` 4840, `fixedWords` 891 |
| Times | first passing `test`-layer step 2.0 min; first green `verify` 2.0 min |
| Verify count | 1 agent runs; 1 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 2.1 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

## Findings
- The starter is an empty repository; defaults are used throughout.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-10-28T23:22:35.810Z","cli":"0.3.1","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":7104,"secondsSinceCreated":137,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":104},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":28},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":1437},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":1468},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":1892},{"name":"home-route-test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":498},{"name":"api-contract","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":264},{"name":"build","phase":"check","layer":"build","status":"skipped","durationMs":0},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":7},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":6},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":4},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":18},{"name":"git-hooks-configured","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":6},{"name":"api","phase":"serve","layer":"serve","status":"passed","durationMs":734},{"name":"web","phase":"serve","layer":"serve","status":"passed","durationMs":631}]}
```
