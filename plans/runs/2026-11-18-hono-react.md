# Gate run: hono-react, 2026-11-18

| Field | Value |
|---|---|
| Stack and fragments | `hono-react`, no added fragments, preset `sandbox` |
| Repo commit | `06c1247202be26ac57c785899409f7f65d31571e` |
| CLI | Compiled dev binary stacks@0.14.1, installed with the working registry |
| Agent | Claude Code 2.1.327, headless; explicit --agent |
| Credentials | token |
| Model | sonnet |
| Effort | agent default |
| Target agents | `claude` |
| Brief size | `briefWords` 5963, `fixedWords` 1255 |
| Times | first passing `test`-layer step 4.0 min; first green `verify` 4.0 min |
| Verify count | 2 agent runs; 1 wrapper calls; mismatch: agent may have called verify another way |
| Interventions | 4 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit (success); 26 turns |
| Agent minutes | 4.4 |
| Hooks fired | block-destructive.sh, detect-secrets.sh, format-changed.sh, guard-hono-api-commands.sh, lint-on-write.sh, session-start.sh, typecheck-on-write.ts |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

## Asked

- Findings (appended during run):
  - `ci-github` says to look up each action's latest release, but the network call (`git ls-remote`) hung, so I used major tags from memory (checkout v5, setup-bun v2, setup-node v5, paths-filter v3); listed under Pending user actions.
  - The brief's CI contract job says `make install check-api-client smoke` but `make install` runs lefthook install outside CI only; I set `CI=true` for that step.
  - Brief says "ask if openapi.json is missing" for the link; in a workspace it's copied by `make api-client`, so no question was needed.


## Run record

```json
{"schemaVersion":1,"at":"2026-11-18T17:10:57.993Z","cli":"0.14.1","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":11547,"secondsSinceCreated":278,"steps":[{"name":"backend-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":36},{"name":"frontend-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":296},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":53},{"name":"openapi-copy","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":25},{"name":"both-parts","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":972},{"name":"contract-doc","phase":"check","layer":"docs","status":"passed","exitCode":0,"durationMs":13},{"name":"agents-md-workspace","phase":"check","layer":"docs","status":"passed","exitCode":0,"durationMs":14},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":7},{"name":"backend-lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":138},{"name":"backend-typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":476},{"name":"backend-test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":1666},{"name":"backend-http-contract","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":325},{"name":"backend-openapi-drift","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":131},{"name":"backend-build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":32},{"name":"backend-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"frontend-lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":269},{"name":"frontend-typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":236},{"name":"frontend-test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":2719},{"name":"frontend-build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":198},{"name":"frontend-e2e","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":1830},{"name":"frontend-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":6},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":292},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":11},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":31},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":28},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":146},{"name":"frontend-client-drift","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":434},{"name":"frontend-generated-hook-used","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"backend-api","phase":"serve","layer":"serve","status":"passed","durationMs":568},{"name":"frontend-web","phase":"serve","layer":"serve","status":"passed","durationMs":547}]}
```
