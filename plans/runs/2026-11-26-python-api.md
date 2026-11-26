# Gate run: python-api, 2026-11-26

| Field | Value |
|---|---|
| Stack and fragments | `python-api`, no added fragments, preset `sandbox` |
| Repo commit | `c2a8261572ae58bdf3c4314154069b850f3233f7` |
| CLI | Compiled dev binary stacks@0.15.0, installed with the working registry |
| Agent | codex 0.171.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 3458, `fixedWords` 945 |
| Times | first passing `test`-layer step 0.6 min; first green `verify` 0.6 min |
| Verify count | 3 agent runs; 3 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 2.1 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

## Findings
- The brief specifies both `uvicorn` and `uvicorn[standard]`; used the stack setup’s standard extra.
- The sandbox CI section defers Dependabot despite the general default enabling it; followed the sandbox-specific instruction.

- setup-uv does not publish a v10 major tag or accept a python-version-file input; use its release tag and let uv read .python-version.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-26T19:14:00.167Z","cli":"0.15.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":5883,"secondsSinceCreated":133,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":91},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":164},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":154},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":265},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":2683},{"name":"openapi-drift","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":339},{"name":"dev-cycle","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":666},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":12},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":7},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":489},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":13},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":35},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":38},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":193},{"name":"api","phase":"serve","layer":"serve","status":"passed","durationMs":712}]}
```
