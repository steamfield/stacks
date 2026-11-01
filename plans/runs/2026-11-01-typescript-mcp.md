# Gate run: typescript-mcp, 2026-11-01

| Field | Value |
|---|---|
| Stack and fragments | `typescript-mcp`, no added fragments, preset `sandbox` |
| Repo commit | `437bd5988999a34ad732fd25bdba08fa50d8147e` |
| CLI | Compiled dev binary stacks@0.6.0, installed with the working registry |
| Agent | codex 0.165.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 3821, `fixedWords` 819 |
| Times | first passing `test`-layer step 1.4 min; first green `verify` 1.4 min |
| Verify count | 1 agent runs; 1 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 1.6 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

- The brief mentions a harness document and Claude README, but neither is supplied for the Codex-only target; the existing shared hooks are documented in AGENTS.md.
- Node 26 is the current LTS line; the installed 26.10.0 is recorded for reproducibility.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-01T23:02:27.247Z","cli":"0.6.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":5773,"secondsSinceCreated":105,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":94},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":36},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":228},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":320},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":2456},{"name":"stdio","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":1179},{"name":"build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":154},{"name":"smoke","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":370},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":13},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":18},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":654},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":16},{"name":"harness-hooks","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":7},{"name":"harness-doc-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":6},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":31},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":27},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":142}]}
```
