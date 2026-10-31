# Stack library QA report

Status: EXECUTED 2026-10-27 (manual QA; product fixes deferred)

Three Terra 6.1 agents exercised all ten bundled stacks and both app fragments
using the current-source packed CLI 0.3.1. Every composition reached green
manifest checks. Manual QA found eleven CLI/recipe friction items and multiple
implementation gaps that those checks missed. The results below identify the
working flows, actual defects, ecosystem friction and untested behavior; they
do not certify complete implementation of every recipe requirement.

## Coverage

| Unit | Current result | Detail |
| --- | --- | --- |
| typescript-cli | Full verify green, 13/13; config-file logLevel implementation gap | [CLI app report](apps.md) |
| typescript-api | Full verify green, 14/14; manual Node and web-handler checks | [Web/API report](web-api.md) |
| mobile-expo | Full verify green, 17/17; real API/DB and web smoke, native bundles | [Runtime report](runtimes.md); account/device and recipe gaps remain explicit |
| go-cli | Full verify green, 12/12; broader CI passed after documented toolchain update | [Runtime report](runtimes.md) |
| astro-api | Full verify green, 15/15; production HTTP and browser checks | [Web/API report](web-api.md) |
| astro-blog | Full verify green, 12/12; production/dev browser, RSS and sitemap checks | [Web/API report](web-api.md) |
| cloudflare-react-router | Full verify green, 9/9; local Workers/browser and scheduled-work checks | [Web/API report](web-api.md) |
| python-react | Full verify green, 14/14; real browser, contract and hook checks | [Runtime report](runtimes.md) |
| react-router | Fresh full verify green, 14/14; production browser and health checks | [Web app report](web-app.md) |
| tauri-react | Full verify green, 17/17; real packaged macOS app exercised | [Runtime report](runtimes.md) |
| openrouter-chat-cli | Full verify green, 18/18; required search/eval features incomplete in this run | [CLI app report](apps.md) |
| openrouter-chat | Full verify green, 15/15; stub-backed browser flows; recorder/eval/export-metadata gaps | [Web app report](web-app.md) |

All ten stacks composed successfully in both default and sandbox previews with
the Codex adapter. Both app compositions also previewed successfully. Bundled
validation returned no errors or warnings. Those composition checks do not
certify runtime behavior. The actual runtime runs use sandbox plus full
verification where feasible, isolated CLI state, and local services/stubs.

The repository's automated baseline passed all six `rr check` partitions:
2,784 tests passed, three skipped, and 35 additional installed-package end-to-end
tests passed. [CLI evidence](cli.md) includes the package identity, composition
matrix, command behavior and test counts.

Captured evidence uses portable path placeholders. JSON and text output were
formatted for review without changing result values or reported outcomes.

## Setup time

Measured CLI scaffold writes took 184–217 ms across the ten bases, with a median
of 192 ms. Agent time to first green averaged about six minutes, ranging from
2m 22s to 8m 56s. Full verification including production builds took up to
10m 21s for Tauri. These are single warm diagnostic runs, some interleaved or
restarted; green verification preceded further manual checks and did not prove
complete recipe compliance.

Adding and implementing CLI chat after a green base took about 18m 31s to first
app green, or 28m 37s including the base. Web chat took about 11m 4s after add,
or 15m 48s including its base. [Timing details](timings.md) record every stack's
values, timestamp sources, later audit time and measurement limitations.

## CLI and recipe findings

| ID | Severity | Area | Finding | Evidence |
| --- | --- | --- | --- | --- |
| QA-01 | High | mobile-expo | Shipped development launcher can kill unrelated work by command pattern or port; it does not verify process ownership | [Runtime report](runtimes.md#finding-dev-script-can-terminate-unrelated-processes) |
| QA-02 | Medium | Native agent guidance | Codex-only API scaffolds and both chat apps refer to Claude-only rule files that are not composed | [Web/API report](web-api.md#finding-codex-only-api-briefs-reference-missing-rules), [CLI app report](apps.md#p2-codex-only-app-guidance-names-rules-that-were-not-supplied), [web app report](web-app.md) |
| QA-03 | Medium | CLI catalog | Four current entries are labelled proven although their content differs from their historical green evidence | [CLI-01](cli.md#cli-01-current-catalog-labels-stale-evidence-as-proven) |
| QA-04 | Low | Effect fragment | The shipped skill says to load a project Effect skill before coding, while the brief creates that separate skill after core compilation | [CLI app report](apps.md#p2-a-fresh-effect-skill-is-required-before-it-exists) |
| QA-05 | Low | Astro blog check | Missing checker dependencies can produce an interactive installation prompt with exit 0, which verification treats as a successful check | [Web/API report](web-api.md#finding-astro-check-can-report-success-without-running-a-check); encountered during incomplete setup |
| QA-06 | Low | CLI JSON recovery | A misspelled stack's `next` instruction refers to IDs above, while suggestions are only in the JSON details field | [CLI-02](cli.md#cli-02-a-json-typo-recovery-points-above-instead-of-naming-its-target) |
| QA-07 | Low | python-react | Error-envelope instructions conflict over `requestId` versus `request_id` on the wire | [Runtime report](runtimes.md); agent chose the later shared camelCase convention |
| QA-08 | Medium | tauri-react | Shipped install target permits Rustup to self-update globally even when the pinned toolchain is present; observed 1.29.1 to 1.29.2 | [Captured install output](runtimes-evidence/tauri-install-rustup.txt); per-command `--no-self-update` prevents repeat |
| QA-09 | Medium | CLI timing and conditional harness steps | `firstTestPassAt` can be set by a successful conditional hook-test command that ran no tests | [Initial React Router evidence](apps-evidence/react-router-test-layer-timings.json); actual Vitest health test passed later |
| QA-10 | Low | CLI chat shipped file | Adding the app to a green base introduced a shipped file that failed formatting under the required base config | [CLI app report](apps.md#p2-added-app-file-needs-formatting-under-the-prescribed-base-configuration) |
| QA-11 | Low | Astro blog preview | Preview backgrounds under an agent; the recipe describes that behavior for dev but omits the corresponding preview cleanup guidance | [Web/API report](web-api.md#finding-astro-preview-also-backgrounds-under-an-agent) |

Finding descriptions are diagnostic input for a later improvement plan. Product
source, recipes and the run ledger have not been changed. A toolchain or peer
dependency repair is recorded as setup friction when current documentation
already provides the recovery; its absence as a fixed version in a recipe is
not itself a defect in this versionless recipe model.

## What green verification missed

The CLI base accepted a config-file `logLevel` setting without applying it. The
CLI chat implementation had a model selection control without search/filtering,
and its eval command omitted several prescribed result fields, per-model
statistics, timestamped files, independent scorer tests and per-case deadlines.
These are concrete omissions in this run's agent-built projects. The authored
tests and manifest commands still passed. They are not automatically defects in
the CLI runner or proof that the recipe caused the mistake, but they show why
green verification alone cannot certify the full requested product.

The [CLI app report](apps.md) separates those omissions from untested edges and
the explicitly skipped paid-provider recording replay. The web app omitted
recorder/replay and paid eval scripts, complete export usage metadata and several
test matrices. Other reports identify logging, auth and device coverage limits. Improvement
planning should retain both the product findings above and these observed
verification gaps, without counting an agent's unfinished code as a broken
framework or CLI.

## Cleanup and limits

All temporary projects, owned servers, browsers, isolated state and build data
were removed after preserving evidence. The mobile run's Docker container,
network and database volume are confirmed absent. Volume deletion required
user-approved manual cleanup because the static repository guard rejected it
even after approval. The group reports record their process and port checks.

Tauri installation self-updated Rustup from 1.29.1 to 1.29.2 on the host. The
temporary project's subsequent runs suppress self-update; no global rollback
was attempted. Removing QA projects does not revert that tool-manager update.

These runs do not certify paid provider access, deployment, real account sign-in,
remote CI execution or every possible optional-fragment combination. Runtime
outcomes are scoped to the named compositions and manual behavior actually
exercised. A green verifier does not establish independent compliance with every
sentence of a recipe; specific omissions stay visible in each report.
