# Gate run: typescript-cli, 2026-11-02

| Field | Value |
|---|---|
| Stack and fragments | `typescript-cli`, no added fragments, preset `sandbox` |
| Repo commit | `d905b7bf64009b0d21be985549ea78e442b875b4` |
| CLI | Compiled dev binary stacks@0.6.0, installed with the working registry |
| Agent | codex 0.165.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 4010, `fixedWords` 838 |
| Times | first passing `test`-layer step 1.3 min; first green `verify` 1.3 min |
| Verify count | 1 agent runs; 1 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 1.5 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

## Findings
- Node 26 is the current LTS; the installed Node is 26.10.0.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-02T00:09:11.343Z","cli":"0.6.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":4457,"secondsSinceCreated":94,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":70},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":31},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":204},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":269},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":717},{"name":"config-logging","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":621},{"name":"binary","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":1034},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":4},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":470},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":11},{"name":"harness-hooks","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"harness-doc-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":4},{"name":"schema-conventions","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":356},{"name":"no-standalone-schema","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"effect-testkit","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":380},{"name":"effect-api-reference","phase":"check","layer":"docs","status":"passed","exitCode":0,"durationMs":41},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":31},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":26},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":148}]}
```
