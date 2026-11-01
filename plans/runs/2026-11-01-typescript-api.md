# Gate run: typescript-api, 2026-11-01

| Field | Value |
|---|---|
| Stack and fragments | `typescript-api`, no added fragments, preset `sandbox` |
| Repo commit | `3f1af2c7fbc46981c4f51c07de407817c19aab8b` |
| CLI | Compiled dev binary stacks@0.6.0, installed with the working registry |
| Agent | codex 0.165.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 4530, `fixedWords` 933 |
| Times | first passing `test`-layer step 2.0 min; first green `verify` 2.0 min |
| Verify count | 1 agent runs; 1 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 2.2 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

- The installed Node 26.10.0 is earlier than the current LTS patch 26.12.1; checks ran on the available Node 26 runtime. CI uses the recorded LTS patch.
- Running lint concurrently with tests detects the tests' temporary boundary fixtures; run them sequentially.
- The brief asks for Dependabot while also deferring it for sandbox CI; the explicit default of weekly grouped updates was selected, with SHA pinning deferred.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-01T23:57:00.435Z","cli":"0.6.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":15303,"secondsSinceCreated":151,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":107},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":36},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":382},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":343},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":5696},{"name":"http-contract","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":1068},{"name":"build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":89},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":12},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":6},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":571},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":12},{"name":"harness-hooks","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5428},{"name":"harness-doc-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":6},{"name":"schema-conventions","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":388},{"name":"no-standalone-schema","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"effect-testkit","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":362},{"name":"effect-api-reference","phase":"check","layer":"docs","status":"passed","exitCode":0,"durationMs":38},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":27},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":24},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":122},{"name":"api-conventions","phase":"check","layer":"docs","status":"passed","exitCode":0,"durationMs":8},{"name":"api","phase":"serve","layer":"serve","status":"passed","durationMs":550}]}
```
