# Gate run: quarkus-api, 2026-11-01

| Field | Value |
|---|---|
| Stack and fragments | `quarkus-api`, no added fragments, preset `sandbox` |
| Repo commit | `02107fc0f64940375920347765cb3e3b80b61a84` |
| CLI | Compiled dev binary stacks@0.6.0, installed with the working registry |
| Agent | codex 0.165.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 4400, `fixedWords` 891 |
| Times | first passing `test`-layer step 2.8 min; first green `verify` 2.8 min |
| Verify count | 1 agent runs; 1 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 2.9 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

- The REST guidance requires an Allow header on 405, while the stack brief explicitly specifies Quarkus REST 405 without one; followed the stack-specific contract.

- The lint-on-write hook explicitly does not support Java; Maven compilation and lint cover Java instead.
- A shared /tmp log path was concurrently used by another benchmark; subsequent logs stay under .stacks.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-01T23:42:24.406Z","cli":"0.6.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":45531,"secondsSinceCreated":217,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":2819},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":42},{"name":"fmt-check","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":2370},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":2409},{"name":"compile","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":4864},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":13185},{"name":"test-integration","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":8723},{"name":"build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":4809},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":4},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":478},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":12},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":24},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":21},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":110},{"name":"api-conventions","phase":"check","layer":"docs","status":"passed","exitCode":0,"durationMs":7},{"name":"api","phase":"serve","layer":"serve","status":"passed","durationMs":5629}]}
```
