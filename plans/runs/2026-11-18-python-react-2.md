# Gate run: python-react, 2026-11-18

| Field | Value |
|---|---|
| Stack and fragments | `python-react`, no added fragments, preset `sandbox` |
| Repo commit | `06c1247202be26ac57c785899409f7f65d31571e` |
| CLI | Compiled dev binary stacks@0.14.1, installed with the working registry |
| Agent | Claude Code 2.1.327, headless; explicit --agent |
| Credentials | token |
| Model | sonnet |
| Effort | agent default |
| Target agents | `claude` |
| Brief size | `briefWords` 6194, `fixedWords` 1292 |
| Times | first passing `test`-layer step 2.4 min; first green `verify` 2.4 min |
| Verify count | 2 agent runs; 1 wrapper calls; mismatch: agent may have called verify another way |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit (success); 27 turns |
| Agent minutes | 2.7 |
| Hooks fired | block-destructive.sh, format-changed.sh, session-start.sh |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

- Brief says `uv python pin` then edit pyproject; `uv python list` printed mise shim errors (harmless). Chose Python 3.14 (newest stable installed).
- Brief's AGENTS.md fill markers can't be left as literal text anywhere in AGENTS.md or check-docs fails; the stacks:fill grep also matches prose mentioning it.
- ci-github asks for default-branch lookup; no remote exists, so used the current branch `master`.
- actionlint and zizmor not installed; CI workflow unlinted.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-18T17:13:59.292Z","cli":"0.14.1","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":11254,"secondsSinceCreated":176,"steps":[{"name":"backend-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":39},{"name":"frontend-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":275},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":49},{"name":"api-copy","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":25},{"name":"both-parts","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":816},{"name":"workspace-docs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":59},{"name":"backend-lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":90},{"name":"backend-typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":208},{"name":"backend-test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":2293},{"name":"backend-openapi-drift","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":287},{"name":"backend-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"frontend-lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":322},{"name":"frontend-typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":209},{"name":"frontend-test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":2637},{"name":"frontend-build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":187},{"name":"frontend-e2e","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":1507},{"name":"frontend-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":10},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":7},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":330},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":11},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":31},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":29},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":146},{"name":"frontend-client-drift","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":442},{"name":"frontend-generated-hook-used","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":11},{"name":"backend-api","phase":"serve","layer":"serve","status":"passed","durationMs":658},{"name":"frontend-web","phase":"serve","layer":"serve","status":"passed","durationMs":550}]}
```
