# Run notes

Status: DRAFT 2026-10-26. Holds one note per recorded run; the first three are 1.6b's
2026-10-27 gate runs. The gate runs are also the first evidence for the D5 brief budget, which is a
hypothesis until they record brief size next to time to green.

Each gate or bench run gets a file named `<date>-<stack>.md` (add `-<n>` for a second run
the same day). The ledger (`packages/cli/registry/runs.json`, from
[2.0c](../archive/phases/phase-2.0c-run-ledger-2026-10-30.md)) is the machine-readable copy;
these notes are what a person reads.

The [2026-10-27 library QA report](2026-10-27-library-qa/REPORT.md) covers all ten
bundled stacks and both apps with Terra 6.1 agents. It includes
[setup timings](2026-10-27-library-qa/timings.md), reproducible findings, captured
verification results and cleanup records. These diagnostic runs were not
imported into the release ledger.

Every note records the fields below; 2.0c's ledger import skips a note that lacks a required one:

| Field | What |
|---|---|
| Stack and fragments | The composition, with preset |
| Repo commit | The stacks commit the CLI and registry were built from, so 2.0c can recompute the fingerprint |
| CLI | How it was run: the compiled dev binary and working registry (until 0.2), the packed tarball's file digest, or `npx stacks@<version>` |
| Agent | Agent and version, interactive or headless |
| Brief size | `briefWords` and `fixedWords` from `new --json` |
| Times | `new` to first passing `test`-layer step, `new` to first green `verify` (from the state record) |
| Verify count | Number of `verify` runs in `runs.jsonl` |
| Interventions | Lines under `## Asked` in `.stacks/NOTES.md`, and anything the maintainer typed |
| Outcome | `green`, `partial`, `failed`, `infra`, with `tamperCheck` |
| Findings | The `## Findings` lines worth acting on, each with the fix it led to |
| Final verify record (optional) | The last line of `.stacks/state/runs.jsonl`, pasted as JSON; 2.0c's import fills `run` from it |
| Agent minutes (optional) | Wall-clock minutes the agent ran; 2.0c's import fills `agentMinutes` from it |

Bench notes also record the agent selection rule, how it ended, turns, hook names
(`unknown` when detection is unavailable), the verify-wrapper call count beside agent
verify runs, and whether the note has been reviewed. Continuations link the earlier
note in both directions and add one intervention; timings stay relative to the original
scaffold. App runs include time to the first green base from the run history.
