# Manual library QA closure

Status: EXECUTED 2026-10-28 for CLI/recipe remediation and targeted recurrence QA.
The temporary applications' remaining implementation and coverage limits are
recorded below. A green manifest is evidence for its commands, not certification
of every instruction in a brief.

Input: the [original report](../runs/2026-10-27-library-qa/REPORT.md), its five group
reports and [timings](../runs/2026-10-27-library-qa/timings.md). Historical evidence
and the run ledger are unchanged. This report covers QA remediation;
[metadata enrichment](metadata-decoration-2026-10-30.md) records its separate integration
and the maintainer's authorization to land those cards.

Current main's discovery cards had already been approved in the parallel search
work. Thirteen became stale after these recipe edits. Their claims were checked
against the changed recipes and their digests refreshed through the existing
restamp operation. Copy, provenance and all existing review dates stayed identical;
no unread draft was approved.

## CLI and recipe findings

| Finding | Change | Verification |
| --- | --- | --- |
| QA-01: unrelated processes killed | Mobile's logging shell delegates to an owned-process launcher. Busy API/Metro ports fail before database startup. Exit, failure, SIGINT, SIGTERM and hangup clean up only spawned groups. Process exit starts cleanup even if a watcher retains output pipes; draining is bounded. A late signal also replaces the earlier exit status. | Ten real-process tests cover listeners, descendants, inherited pipes, failed readiness, startup failure and signals. Unrelated work survives. [Late-signal evidence](../runs/2026-10-28-qa-followup/mobile-shutdown.md). |
| QA-02: missing native guidance | API stacks, the CLI base and both chat apps ship shared docs/guidance with native pointers. Claude retains thin path-scoped rules. Shared chat documentation qualifies Claude-only guards. | Sixteen composed cases resolve guidance and native links for Claude, Codex, Cursor and OpenCode; a deliberately broken native link fails. |
| QA-03: stale evidence called proven | Catalog text says historical pass. Historical JSON and show's sameContent comparison remain; list does not fingerprint or download every entry. | Current/stale/absent evidence, three audiences and built Node command probes. |
| QA-04: circular Effect bootstrap | When the generated skill is absent, start with installed declarations; create it after core compilation and maintain it on upgrades. Fragment and stack guidance agree. | Four adapter tests inspect both guidance sources. |
| QA-05: checker prompt exits successfully | Astro check first resolves its checker and TypeScript with automatic installation disabled, then invokes the installed checker. Missing dependencies fail with an installation command. | Missing, installed, deliberate-type-error and restored-source cases through the real checker. |
| QA-06: JSON recovery points above | NotFound names the executable list command while retaining suggestions, fixed safe messages and stream contracts. | JSON, plain agent and human PTY success/failure. |
| QA-07: Python request-id casing | Wire prose, example and required JSON/OpenAPI tests use requestId. Python may use request_id internally with a serialization alias. | Composed guidance regression; a new complete Python application was not rebuilt. |
| QA-08: global Rustup update | Tauri install passes --no-self-update to this invocation. | Rendered Makefile executed with isolated tool shims; installed read-only help confirms the option. |
| QA-09: a no-op sets first-test timing | The conditional hook-directory command uses check, so absent tests cannot set firstTestPassAt. runs labels the existing value as completion of the first successful test-command run. | Absent hooks leave it unset; an actual HTTP test sets it. Existing JSON fields and ordinary test behavior remain. |
| QA-10: shipped helper fails formatting | CLI chat's rendered stub-pid.ts follows the prescribed base formatter. | Actual Biome formatting of the composed artifact. |
| QA-11: preview lifecycle unclear | Astro preview passes --ignore-lock and documents foreground stopping and checkout-local preview stop. | Production build, HTTP 200, owned shutdown and closed port. |

Owning plans record the intended wording and layer changes before assertions were
updated. Canonical brief digests are prose snapshots, not new run proof.

Fresh QA also exposed ambiguous database cleanup and response rewriting guidance.
Mobile now drops only exact database names created by its run; a prefix cannot
establish ownership or abandonment. Both Effect API guides explain that responses
must change before transport send, using the installed pre-response mechanism.
The full HTTP matrix must assert actual Node and web wire behavior.

The root test guard now follows the tool's working directory, parsed directory
changes and Bun's --cwd. It allows scoped TSX tests while preserving rr for opted-in
projects. Eight real-project regressions failed seven cases with the old guard;
the corrected guard and existing tests passed 55/55. Destructive policy is unchanged.

## Independent eval report checkpoint

The fresh web eval still exited zero with combined token counts and incomplete
model aggregates. Both app manifests now run the shipped openrouter-ai checkpoint
instead of trusting their eval script's exit status.

The application implements scripts/eval.ts with --dry-run, --models and --report
per [report v1](../../packages/cli/registry/fragments/openrouter-ai/files/docs/eval-report.md).
The checkpoint requests two synthetic models, clears inherited provider settings,
disables implicit dotenv loading in its child and reads a fresh report through a
bounded nonsymlink file handle. It validates required cases, separate token fields,
verdict counts, cost totals and latency medians. Missing metadata is explicit null;
unknown members make the corresponding total null. Fail/error or no passes fail;
truncated keeps its existing distinct policy.

Structurally valid results, including failed outcomes, are retained as uniquely
timestamped artifacts under ignored .eval/results. Invalid fields produce safe
index/field diagnostics; runner failures name a direct diagnostic command. The
shared vendor helpers add no eval manifest step to vendor-only compositions.

The unchanged [incomplete web result](../runs/2026-10-28-qa-followup/web-app-evidence/eval-dry-run.txt)
is rejected by the new checkpoint despite its former command exiting zero.
A small real HTTP application boundary produced six calls across two models and
a valid report; corrupting a cost aggregate failed. [Sanitized evidence](../runs/2026-10-28-qa-followup/eval-checkpoint-evidence.json)
records the command results. This establishes report completeness and consistency;
the runner must still use real application programs, bounded cases and meaningful
scorers. The checkpoint cannot infer those facts from JSON.

## Fresh Terra follow-up

All three follow-up groups used new temporary projects and unchanged generated
manifests. Their detailed reports retain assertions, observations and limits.

| Area | Observed result | Remaining scope |
| --- | --- | --- |
| [CLI base and chat](../runs/2026-10-28-qa-followup/cli-app.md) | Base 14/14, app 20/20. Real config/logging precedence, emitted/suppressed JSONL and compiled overrides; searched model selection in source/compiled PTYs; partial streaming/Stop persistence; tool states; schema wire; retries before output; deadline abort/report; safe errors; MCP response after EOF. | The scratch app did not implement every history/resume, model cache/routing, CLI option, turn timeout or final usage requirement. Real recording replay was explicitly skipped. |
| [Web chat](../runs/2026-10-28-qa-followup/web-app.md) | 17/17 manifest steps, 32 focused tests and seven production-browser flows. Keyless refusal with zero provider requests, synthetic whole/split tool replay, export, clipboard failure, partial text/tool state, models pagination/cache, limits, schema wire and local provider errors. | The scratch eval's incomplete aggregates triggered the independent checkpoint above. Scorer quality, some disconnect/network/discovery/accessibility edges and complete base architecture remain unverified. Four real-recording tests were skipped. |
| [Mobile](../runs/2026-10-28-qa-followup/api-mobile.md) | Concurrent real Postgres clones held distinct rows; template reuse and failed post-clone cleanup; transitive import graph deny/near misses; real provider/hook/hc auth/cache seam with external SDK/fetch stubs; parsed CI filters and status behavior; headless iOS/Android exports. | These were authored proving slices, not a complete new mobile app. Migration failure/crash recovery, every import form and full workflow/project checking were not exercised. Real Clerk accounts/devices and hosted CI remain external. |
| [TypeScript and Astro APIs](../runs/2026-10-28-qa-followup/api-mobile.md) | 31 TypeScript API and 39 Astro API/startup/static cases through real Node and platform-free web handlers, including response encoding/defects, safe IDs, request/defect log counts and static/API misses. | Production logger sink/format/collision behavior and entry startup wiring were not certified. Astro's complete island/client/proxy was not rebuilt. |

These residual implementation omissions are not automatically bugs in the stacks
CLI or underlying frameworks. Named acceptance suites now require the missed
behavior explicitly; independent report validation catches the concrete eval
omission. Broader application compliance still requires inspecting real assertions
and manual behavior.

## Timings

The [original timing table](../runs/2026-10-27-library-qa/timings.md) covers every
stack and both apps: CLI writes had a median of 192 ms, and first green averaged
about six minutes in warm diagnostic runs. First green preceded later audits.

Fresh follow-up writes took 205 ms for the CLI base and 285 ms for the web base.
CLI chat first reached green 7m47s after add; its final expanded run completed
about 20 minutes after add. Web chat first reached green about 10m37s after add,
then continued implementation/testing for roughly another ten minutes. These
single manual runs include pauses, downloads and repairs; their green timestamps
do not measure complete recipe compliance. Exact start, first-test and run-end
timestamps remain in each linked report. API/mobile checks were targeted and did
not establish full-green times.

## Verification and review

- Regression-first and manual reversion reproduced the findings. Restoring the
  original guidance/commands/layers produced 43 failures and six preservation
  controls; review regressions separately caught inherited pipes, unsafe fixture
  cleanup, bootstrap conflicts and broken links. Old broad kill paths never ran.
- The late-signal regression failed with exit 7 versus 143 before the fix and on
  reversion. All ten process tests passed locally and on the earlier failing host.
  The original uninstrumented exit-1 observation remains qualified in its note.
- Removing eval case/aggregate enforcement produced 26 failures; removing wrapper
  validation produced eight, and removing cleanup produced 16. The retained Terra
  report is a real negative control. The final validator/checkpoint files pass
  72 tests; two blank-finish cases also went red on manual reversion.
- The checkpoint unit's rr gate passed six partitions: 2,906 tests passed, six
  skipped, plus 35 installed-package e2e tests after actual packing/installing.
  JSON, plain-agent and human-PTY built CLI composition/error probes passed.
- The parent refactor gate passed five partitions; a remote startup-failure
  fixture once returned 1 instead of 4. Captured output was added without
  relaxing the assertion. Its full 138-file CLI rerun on that host passed all
  2,369 tests with three platform skips. That uninstrumented event was not
  reproduced or assigned a speculative cause.
- Six evidence files were formatted. Parsed values stayed identical in all ten
  JSON evidence files. The golden fixture was restored byte-for-byte from HEAD;
  its judgments, thresholds and skip behavior were not changed.
- The [QA-fix review](../runs/2026-10-28-qa-followup/reviews/qa-fixes.md) found four
  issues, all fixed and revert-tested. The [checkpoint review](../runs/2026-10-28-qa-followup/reviews/eval-checkpoint.md)
  approved that new unit. Each deliverable received one review. The parent then
  reviewed/refactored the diff, adding the late-signal and nonblank-field fixes.

Final merged-tree rr gate passed six/six partitions after integration with main:
2,477 CLI, 47 bench, 155 format and 377 root tests passed, with four total skips;
35 additional installed-package end-to-end tests passed. Lint checked 1,124 files,
and typechecking passed. Log directory suffix: check-20261028-011610. The independent
QA checkout's tracked golden fixture was materialized after the merge; its contents
and assertions were not changed by this remediation.

## Cleanup and external limits

All owned temporary apps, isolated state, dependencies, servers, browser assets
and fixture processes were removed after preserving evidence. The mobile
follow-up's tmpfs Postgres container was stopped and removed; no persistent volume
was created or deleted. The existing Docker confirmation policy was preserved.

The remediation made no global tool/config changes or paid provider calls.
Historical host changes remain documented in the original report. Real-provider
formats/costs, recording quality, account/device flows, Windows, hosted CI,
deployment and publication were not certified. Existing Orval/AJV, peer dependency
and Go advisory recovery guidance remains versionless. Local tests exercised 402
mapping and the documented MCP EOF workaround; upgrades still need their own
appropriate validation.

