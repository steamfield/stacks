# Gate run: react-vite, 2026-11-18

| Field | Value |
|---|---|
| Stack and fragments | `react-vite`, no added fragments, preset `sandbox` |
| Repo commit | `985cc6158ae430e33debf1527dc0f494ba360518` |
| CLI | Compiled dev binary stacks@0.14.1, installed with the working registry |
| Agent | Claude Code 2.1.327, headless; explicit --agent |
| Credentials | token |
| Model | sonnet |
| Effort | agent default |
| Target agents | `claude` |
| Brief size | `briefWords` 4063, `fixedWords` 974 |
| Times | first passing `test`-layer step 1.6 min; first green `verify` 1.6 min |
| Verify count | 2 agent runs; 2 wrapper calls |
| Interventions | 3 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit (success); 12 turns |
| Agent minutes | 2.4 |
| Hooks fired | block-destructive.sh, format-changed.sh, session-start.sh |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

## Asked
- Brief says Node LTS; installed node is v24, recorded as 24 in .node-version.
- The shipped code passed lint/typecheck/test/e2e with latest packages unchanged; no fixes needed.
- ci.yml triggers on `master` (current branch; no remote) though the git status mentions `main` as main branch.


## Run record

```json
{"schemaVersion":1,"at":"2026-11-18T14:36:54.807Z","cli":"0.14.1","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":6657,"secondsSinceCreated":154,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":338},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":54},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":285},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":224},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":2443},{"name":"build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":210},{"name":"e2e","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":1867},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":10},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":7},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":340},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":13},{"name":"harness-doc-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"file-headers","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":69},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":33},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":30},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":155},{"name":"web","phase":"serve","layer":"serve","status":"passed","durationMs":551}]}
```
