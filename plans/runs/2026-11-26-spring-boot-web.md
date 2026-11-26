# Gate run: spring-boot-web, 2026-11-26

| Field | Value |
|---|---|
| Stack and fragments | `spring-boot-web`, no added fragments, preset `sandbox` |
| Repo commit | `797545b43d26add56c06cddba3a417a26c9814d3` |
| CLI | Compiled dev binary stacks@0.15.0, installed with the working registry |
| Agent | codex 0.171.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 4674, `fixedWords` 953 |
| Times | first passing `test`-layer step 2.2 min; first green `verify` 2.2 min |
| Verify count | 3 agent runs; 3 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 3.3 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

- Java is present through Homebrew but the system `java` shim cannot find it; the Makefile locates the installed keg.
- The lint-on-write hook explicitly does not run for Java; Maven Enforcer and compiler checks run through make instead.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-26T22:35:18.389Z","cli":"0.15.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":31464,"secondsSinceCreated":229,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":2126},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":45},{"name":"fmt-check","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":1779},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":1152},{"name":"compile","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":1951},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":6997},{"name":"test-integration","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":5331},{"name":"build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":2243},{"name":"dev-cycle","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":4900},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":4},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":463},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":12},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":32},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":28},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":162},{"name":"web","phase":"serve","layer":"serve","status":"passed","durationMs":4212}]}
```
