# Gate run: react-vite, 2026-11-01

| Field | Value |
|---|---|
| Stack and fragments | `react-vite`, no added fragments, preset `sandbox` |
| Repo commit | `437bd5988999a34ad732fd25bdba08fa50d8147e` |
| CLI | Compiled dev binary stacks@0.6.0, installed with the working registry |
| Agent | codex 0.165.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 3889, `fixedWords` 907 |
| Times | first passing `test`-layer step 1.6 min; first green `verify` 1.6 min |
| Verify count | 1 agent runs; 1 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 1.8 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

## Findings
- The brief mentions harness documentation and guard-commands.ts that are not present in this Codex-only starter; document the hooks actually shipped.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-01T22:59:03.573Z","cli":"0.6.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":16910,"secondsSinceCreated":127,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":1151},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":56},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":526},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":521},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":10144},{"name":"build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":536},{"name":"e2e","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":2255},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":29},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":57},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":23},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":14},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":799},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":15},{"name":"harness-hooks","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":6},{"name":"harness-doc-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":32},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":44},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":136},{"name":"web","phase":"serve","layer":"serve","status":"passed","durationMs":552}]}
```
