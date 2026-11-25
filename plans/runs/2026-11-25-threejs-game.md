# Gate run: threejs-game, 2026-11-25

| Field | Value |
|---|---|
| Stack and fragments | `threejs-game`, no added fragments, preset `sandbox` |
| Repo commit | `bc1d06cec7bc164f4a9d9eb1f7dfb371dc688ffb` |
| CLI | Compiled dev binary stacks@0.15.0, installed with the working registry |
| Agent | Claude Code 2.1.331, headless; explicit --agent |
| Credentials | token |
| Model | haiku |
| Effort | agent default |
| Target agents | `claude` |
| Brief size | `briefWords` 4131, `fixedWords` 974 |
| Times | first passing `test`-layer step 0.9 min; first green `verify` 3.2 min |
| Verify count | 4 agent runs; 3 wrapper calls; mismatch: agent may have called verify another way |
| Interventions | 0 |
| Outcome | `green`, tamperCheck: "full"; ledger result pass |
| Agent ended | exit (success); 6 turns |
| Agent minutes | 6.8 |
| Hooks fired | block-destructive.sh, detect-secrets.sh, format-changed.sh, lint-on-write.sh, session-start.sh, typecheck-on-write.ts |

This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.

## Agent notes

# Notes

## Findings

- Brief Start step 1 says to run `bun add` with no versions; the Setup section then says pin three, @types/three and Rapier exactly. Did both: caret at first, then `bun add --exact` for those three (three 0.187.0, @types/three 0.187.0, Rapier 0.21.0). The brief doesn't say which @types/node major; chose 24 to match the Node LTS line.
- Brief says CI runs the coverage target when the project has one. The project has no coverage script, so CI runs `bun run test`.
- Brief says to record the Bun version in `packageManager`; it's `bun@1.4.2` (the installed Bun). It doesn't say which Bun to record when it's unclear, so the installed one was used.
- `gh` isn't authenticated here, so the latest action tags were read with `git ls-remote --tags` (checkout v7, setup-node v7, setup-bun v2, upload-artifact v7). Used major-tag refs as the brief allows.
- Brief "Done" is `stacks verify --all` exits 0. The bench wrapper sets `PORT_WEB=61025`; used it for every verify run.
- Lint, typecheck, unit tests and e2e passed on the shipped code with no source changes needed. The only code-side work was the shipped config and docs.
- The brief's `lefthook` note says `exclude` takes only globs; used `exclude: [".stacks/**"]` and `lefthook validate` accepts it.
- Verify fill steps were the only failures on the first run, so `docs/harness.md`, `.claude/README.md` and `README.md` were filled from what's on disk, not from guesses.

- `.claude/commands/feature.md` names `main` as the base branch and the PR template; this repo's branch is `master` with no remote. CI triggers on `master` per the brief's rule. Left feature.md unchanged; the user should decide the default branch.
- Reviewer pass found doc claims that were wrong (Playwright builds itself, PORT_WEB read by the repo, plugin marketplaces configured). Fixed in AGENTS.md, README.md and .claude/README.md; added .github/pull_request_template.md which feature.md references.

## Asked


## Run record

```json
{"schemaVersion":1,"at":"2026-11-25T07:40:42.205Z","cli":"0.15.0","agent":"none","outcome":"green","scope":"full","tamperCheck":"full","acceptedChanges":false,"durationMs":9290,"secondsSinceCreated":421,"steps":[{"name":"install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":344},{"name":"git-hooks-install","phase":"setup","layer":"install","status":"passed","exitCode":0,"durationMs":56},{"name":"lint","phase":"check","layer":"lint","status":"passed","exitCode":0,"durationMs":192},{"name":"typecheck","phase":"check","layer":"typecheck","status":"passed","exitCode":0,"durationMs":197},{"name":"test","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":2811},{"name":"build","phase":"check","layer":"build","status":"passed","exitCode":0,"durationMs":285},{"name":"e2e","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":4076},{"name":"readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"agents-md-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":10},{"name":"claude-md-imports-agents","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":8},{"name":"claude-readme-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":7},{"name":"hooks-smoke","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":348},{"name":"ci-workflow","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":14},{"name":"harness-doc-filled","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":9},{"name":"file-headers","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":134},{"name":"git-hooks-validate","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":37},{"name":"git-hooks-jobs","phase":"check","layer":"check","status":"passed","exitCode":0,"durationMs":31},{"name":"git-hooks-commit-msg","phase":"check","layer":"test","status":"passed","exitCode":0,"durationMs":154},{"name":"web","phase":"serve","layer":"serve","status":"passed","durationMs":566}]}
```
