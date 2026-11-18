# Gate run: python-react, 2026-11-18

| Field | Value |
|---|---|
| Stack and fragments | `python-react`, no added fragments, preset `sandbox` |
| Repo commit | `985cc6158ae430e33debf1527dc0f494ba360518` |
| CLI | Compiled dev binary stacks@0.14.1, installed with the working registry |
| Agent | Claude Code 2.1.327, headless; explicit --agent |
| Credentials | token |
| Model | sonnet |
| Effort | agent default |
| Target agents | `claude` |
| Brief size | `briefWords` 4649, `fixedWords` 976 |
| Times | first passing `test`-layer step 2.0 min; first green `verify` 2.0 min |
| Verify count | 1 agent runs; 1 wrapper calls |
| Interventions | 2 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit (success); 18 turns |
| Agent minutes | 2.2 |
| Hooks fired | block-destructive.sh, format-changed.sh, session-start.sh |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

## Asked

- Findings: brief's `target-version`/`requires-python` weren't in the shipped pyproject; added by hand (py314). `packageManager` and `.node-version` were not shipped; created. dependabot ecosystem names (`uv`, `bun`) chosen by me; setup-uv publishes no `v10` major tag, so `v10.3.3` is used.
- Asked: none. Decisions: all brief defaults (Python 3.14, bun, no DB, no auth, cookieless PostHog US).


## Run record

```json
{"schemaVersion":1,"at":"2026-11-18T14:39:23.395Z","cli":"0.14.1","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":11822,"secondsSinceCreated":150,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":123},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":53},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":143},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":697},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":2689},{"name":"home-route-test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":768},{"name":"api-contract","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":346},{"name":"build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":1145},{"name":"e2e","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":3937},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":7},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":6},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":350},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":12},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":33},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":29},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":166},{"name":"api","phase":"serve","layer":"serve","status":"passed","durationMs":674},{"name":"web","phase":"serve","layer":"serve","status":"passed","durationMs":622}]}
```
