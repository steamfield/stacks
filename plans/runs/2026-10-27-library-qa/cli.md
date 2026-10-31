# CLI discovery and composition QA

Status: EXECUTED 2026-10-27

The orchestrator exercised the same packed CLI as the Terra agents. This file
records cross-cutting CLI checks; the group reports cover actual project builds.

## Package and environment

The source baseline was `02a8554ebed597c554107468fdf73d2ea7907f41`, package
`@steamfield/stacks` 0.3.1. The locally built tarball SHA-256 was
`fc9ebc83774e06e36689df710a2b4eb467f633ae8b5d21fb408ed0744686fe65`.
The archive was extracted and its executable ran under Node 24.21.0 on macOS;
Bun 1.4.2 built the package. This exercises packed asset resolution, but does not
claim a fresh npm installation was tested. The repository command guard refused
the attempted local npm installation, so extraction was used.

Discovery used offline mode with isolated configuration, state and data. The CLI
reported the packed registry and skill present, no configuration errors, and its
remote origin disabled. Later probes also isolated the cache. No real provider
credentials or external index were used.

## Checks and outcomes

`list --json` discovered ten stacks and twenty fragments, including two fragments
in the app category. `list apps` and `list apps --json` both returned
`openrouter-chat` and `openrouter-chat-cli` with their supported bases. `show`
returned guidance, dependencies, files and verification contracts for an app.
`new`, `list` and `validate` help described the applicable flags and exit codes.

A repeated `new` into an unfinished scaffold exited 2 with TargetNotEmpty,
`scaffold: "unfinished"` and an instruction to continue from the existing brief.
`list --dir` correctly returned the base's applied and addable fragments. Adding
the web chat app to go-cli was rejected with a ComposeConflict `applies_to`
reason. The safety-check scaffold was removed after these probes.

All twenty previews of ten stacks across default and sandbox presets succeeded
with the Codex adapter. Both sandbox app compositions also succeeded. Every
preview returned no missing tools or warnings on this machine. Previews created
no target projects. These are composition checks, not runtime passes.

| Stack | Default brief words | Sandbox brief words | Planned files, Codex |
| --- | ---: | ---: | ---: |
| astro-api | 5,184 | 5,189 | 43 |
| astro-blog | 3,739 | 3,747 | 19 |
| cloudflare-react-router | 2,589 | 2,594 | 15 |
| go-cli | 3,242 | 3,247 | 18 |
| mobile-expo | 5,201 | 5,206 | 25 |
| python-react | 4,759 | 4,767 | 19 |
| react-router | 4,567 | 4,572 | 29 |
| tauri-react | 4,777 | 4,785 | 22 |
| typescript-api | 5,190 | 5,195 | 43 |
| typescript-cli | 4,672 | 4,677 | 28 |

The web app composition returned 6,887 brief words and 33 planned files; the CLI
app returned 7,202 words and 34 files. Counts above are the CLI's `briefWords`
field for this adapter, independent of its separate `fixedWords` field.

Bundled `validate --json` exited 0: ten stacks, twenty fragments, zero errors,
zero warnings and eleven notes. Six notes reported stacks without a sandbox pass;
four reported content changed since a historical pass. One note described a
Docker deployment conditional reachable only with an explicit addition.

Invalid `list app --json` exited 2 with a Usage envelope and an `apps` suggestion.
Misspelled `new react-routr` exited 2 with a NotFound envelope and a `react-router`
suggestion. `runs --json` and `verify --json` outside a project exited 2 with the
project recovery instruction. Successful JSON probes had empty stderr; failures
had empty stdout and a final JSON envelope. These checks found no stream-contract
failure.

The repository baseline gate also passed through `rr check`: all six partitions
succeeded. Its logs showed 131 CLI test files with 2,252 passed and one skipped,
one bench file with 47 passed, ten format files with 115 passed, fifteen root
files with 370 passed and two skipped, plus 35 installed-package end-to-end
tests with no failures. Lint checked 893 files and typechecking succeeded. These
automated baseline results do not certify the manually built projects.

## CLI-01: current catalog labels stale evidence as proven

Severity: medium. Owner: CLI catalog presentation and proof metadata.

Reproduce against this package:

```sh
<cli> list stacks
<cli> show astro-blog --json
<cli> validate --json
```

`list stacks` prints `proven 2026-10-27` for astro-blog, go-cli, python-react and
typescript-cli. For every one of those entries, `show --json` returns
`lastRun.result: "pass"` together with `lastRun.sameContent: false`. Validation
also reports `ledger-changed` for all four. The catalog's JSON result has the
historical fingerprint, but no corresponding freshness field.

A reader selecting a stack sees a claim of proof for the current catalog entry
without learning that its content has changed. Historical passes should remain
available, with wording or metadata that makes the missing current proof clear.
Until then, checking `show` or `validate` is a recovery step before relying on the
catalog label.

Source ownership is `core/list.ts::rowLastRun` and
`core/list-report.ts::ledgerFields`; the more detailed current-content comparison
already exists in `core/show.ts`. This is a presentation and trust-calibration
finding, not evidence that any historical run was invalid.

The captured catalog text and selected actual `show` fields are retained in
[catalog-and-recovery.json](cli-evidence/catalog-and-recovery.json), together with
the JSON typo recovery probe. Temporary paths are replaced with `<qa-root>`.

## CLI-02: a JSON typo recovery points above instead of naming its target

Severity: low. Owner: CLI error guidance.

```sh
<cli> new react-routr <qa-root>/typo --json
```

The NotFound envelope correctly includes `details.suggestions: ["react-router"]`,
but its `next` field says `use one of the ids above.` The JSON stream has no
rendered list above it. An agent can recover by inspecting details, so this is
minor wording friction. An explicit command or a reference to the suggestions
field would make the recovery instruction self-contained.

## Adapter composition cross-check

After the API agent found missing rule references, four additional previews
compared Codex and Claude scaffolds of typescript-api and astro-api. The Codex
file lists contain neither the linked `effect-api.md` nor the linked `testing.md`.
The Claude lists contain both under `.claude/rules/src/` for typescript-api and
`.claude/rules/api/` for astro-api. This confirms the missing-file difference is
in the composed assets rather than a generator merge mistake. The related recipe
finding and its end-to-end impact belong in the web/API report.

## Limits

This cross-cutting pass covers packed execution, noninteractive agent text and
JSON output. It does not certify interactive launch/pickers, signed remote
origins, installation/update, other adapters, deployments or paid integrations.
Default-preset coverage here is composition only. Runtime coverage and cleanup
are recorded separately by each Terra group.
