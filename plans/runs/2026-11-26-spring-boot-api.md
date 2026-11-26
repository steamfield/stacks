# Gate run: spring-boot-api, 2026-11-26

| Field | Value |
|---|---|
| Stack and fragments | `spring-boot-api`, no added fragments, preset `sandbox` |
| Repo commit | `797545b43d26add56c06cddba3a417a26c9814d3` |
| CLI | Compiled dev binary stacks@0.15.0, installed with the working registry |
| Agent | codex 0.171.0, headless; bench default |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Effort | medium |
| Target agents | `codex` |
| Brief size | `briefWords` 4486, `fixedWords` 954 |
| Times | first passing `test`-layer step 2.8 min; first green `verify` 2.8 min |
| Verify count | 3 agent runs; 3 wrapper calls |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit; 1 turns |
| Agent minutes | 4.3 |
| Hooks fired | unknown |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

## Findings
- The brief says to test lint-on-write with the configured linter, but the shipped hook deliberately ignores Java and Maven Enforcer checks the project rather than individual files.
- Java was reported as available on PATH, but the system launcher had no registered JDK; Homebrew openjdk@25 was already installed and the Makefile finds it.

- Tests pass but Mockito emits a warning about dynamically attaching its agent on Java 25; future JDKs will require explicit agent configuration.
- The development server selects an available port by default, so the documented 8080 foreground health URL does not apply to dev-bg.
- The generated Windows Maven wrapper uses CRLF, which git diff --check reports as trailing whitespace without a Git attributes rule.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-26T22:31:06.973Z","cli":"0.15.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":51141,"secondsSinceCreated":311,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":4534},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":87},{"name":"fmt-check","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":3575},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":2978},{"name":"compile","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":3871},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":12360},{"name":"test-integration","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":9452},{"name":"build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":5042},{"name":"dev-cycle","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":4899},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":10},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":5},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":438},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":11},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":34},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":30},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":160},{"name":"api-conventions","phase":"check","layer":"docs","status":"passed","exitCode":0,"durationMs":7},{"name":"api","phase":"serve","layer":"serve","status":"passed","durationMs":3630}]}
```
