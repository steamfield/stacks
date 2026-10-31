# Gate run: python-react, 2026-10-28

| Field | Value |
|---|---|
| Stack and fragments | `python-react`, no added fragments, preset `sandbox` |
| Repo commit | `cbba4c2aa746a695d3602e5465c5960122cd0cea` |
| CLI | Compiled dev binary stacks@0.3.1, installed with the working registry |
| Agent | codex 0.165.0, headless; explicit --agent |
| Credentials | codex login |
| Model | gpt-6.1-terra |
| Target agents | `codex` |
| Brief size | `briefWords` 4828, `fixedWords` 891 |
| Times | first passing `test`-layer step 1.3 min; first green `verify` never min |
| Verify count | 1 agent runs; 1 wrapper calls |
| Interventions | 2 |
| Outcome | `failed`, tamperCheck: "full"; ledger result fail |
| Agent ended | exit; 1 turns |
| Agent minutes | 1.4 |
| Hooks fired | unknown |

Reviewed 2026-10-28: a recipe defect. The brief told the agent to delete uv's stub script, the
shipped command guard refused the removal, and the agent stopped as the project's guard rule says.
The brief now has uv write no stub.

## Agent notes

## Findings

## Asked

- The command guard rejected removal of the uv-generated backend stub; it remains in place.
- shadcn rejected the guessed preset radix-nova; the current CLI accepts nova.


## Run record

```json
{"schemaVersion":1,"at":"2026-10-28T23:19:09.024Z","cli":"0.3.1","agent":"none","outcome":"failed","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":3126,"secondsSinceCreated":90,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":77},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":30},{"name":"lint","phase":"check","layer":"lint","status":"failed","failureKind":"step","exitCode":2,"durationMs":43},{"name":"typecheck","phase":"check","layer":"typecheck","status":"failed","failureKind":"step","exitCode":2,"durationMs":135},{"name":"test","phase":"check","layer":"test","status":"failed","failureKind":"step","exitCode":2,"durationMs":1124},{"name":"home-route-test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":30},{"name":"api-contract","phase":"check","layer":"check","status":"failed","failureKind":"step","exitCode":2,"durationMs":270},{"name":"build","phase":"check","layer":"build","status":"skipped","durationMs":0},{"name":"readme-filled","phase":"check","layer":"check","status":"failed","failureKind":"step","exitCode":1,"durationMs":8},{"name":"agents-md-filled","phase":"check","layer":"check","status":"failed","failureKind":"step","exitCode":1,"durationMs":7},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":4},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":19},{"name":"git-hooks-configured","phase":"check","layer":"check","status":"failed","failureKind":"step","exitCode":1,"durationMs":6},{"name":"api","phase":"serve","layer":"serve","status":"passed","durationMs":749},{"name":"web","phase":"serve","layer":"serve","status":"passed","durationMs":622}]}
```
