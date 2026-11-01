# Gate run: python-cli, 2026-11-01

| Field | Value |
|---|---|
| Stack and fragments | `python-cli`, no added fragments, preset `sandbox` |
| Repo commit | `437bd5988999a34ad732fd25bdba08fa50d8147e` |
| CLI | Compiled dev binary stacks@0.6.0, installed with the working registry |
| Agent | codex 0.165.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 3244, `fixedWords` 811 |
| Times | first passing `test`-layer step 1.7 min; first green `verify` 1.7 min |
| Verify count | 1 agent runs; 1 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 1.7 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

- The bundled uv lists CPython 3.14 as its newest stable release; selected 3.14. Its init option is `--vcs none`, not `--no-vcs`.
- The command guard rejected a combined command containing scratch-directory removal; the generator directory remains in /tmp.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-01T23:11:41.915Z","cli":"0.6.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":10383,"secondsSinceCreated":117,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":339},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":105},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":209},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":518},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":4354},{"name":"build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":390},{"name":"smoke","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":2402},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":12},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":15},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":7},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":1629},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":34},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":85},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":40},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":233}]}
```
