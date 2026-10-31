# Stack library manual QA

Status: EXECUTED 2026-10-27

This run exercises the ten bundled stacks and both app fragments using Terra 6.1
agents. The deliverable is evidence and a report of CLI and recipe friction for a
later improvement plan. Product source, registry entries and the run ledger stay
unchanged. Agents may repair their temporary projects, recording each repair.

## Execution

| Work item | Scope | State | Dependency |
| --- | --- | --- | --- |
| Prepare | Isolated worktree, catalog, packed CLI and shared protocol | Complete | None |
| QA CLI application | typescript-cli, openrouter-chat-cli | Complete, with recorded implementation gaps | Prepare |
| QA web and APIs | astro-api, typescript-api, astro-blog, cloudflare-react-router | Complete | Prepare |
| QA web application | Fresh react-router, openrouter-chat run | Complete, with stated limits | QA web and APIs |
| QA other runtimes | go-cli, python-react, mobile-expo, tauri-react | Complete, with stated limits | Prepare |
| Synthesize | Coverage matrix, deduplicated findings, reproduction evidence and limitations | Complete | All QA groups |
| Close | Verify evidence and temporary project/process cleanup | Complete | Synthesize |

Current checkpoints: typescript-cli reached 13/13 full verification,
openrouter-chat-cli 18/18, typescript-api 14/14, astro-api 15/15, astro-blog 12/12,
cloudflare-react-router 9/9, go-cli 12/12, python-react 14/14, mobile-expo 17/17,
tauri-react 17/17, the fresh react-router 14/14, and openrouter-chat 15/15.
These are verification outcomes with named manual checks; group reports retain
the limits of recipe coverage. All temporary projects and owned processes have
been cleaned up. Mobile's owned database volume was
removed after a user-approved manual cleanup step: the static command guard had
still rejected the exact deletion command after approval. The parent subsequently
confirmed that the volume was absent, with no containers or network for its
Compose project remaining.

The Tauri install target unexpectedly self-updated Rustup from 1.29.1 to 1.29.2.
The temporary Makefile now uses the supported `--no-self-update` option for
subsequent QA, but the machine update has not been rolled back. This is recorded
as a recipe finding rather than hidden under temporary-project cleanup.

## Protocol

Use the packed current-source CLI under Node. Discover with list/show/help, scaffold
with the sandbox preset and Codex adapter, read the whole generated brief and native
guidance, and build the requested project using current dependencies. Run the exact
verify command in the brief with the same isolated state as scaffold. Run full
verification including production-tagged checks when feasible. Inspect meaningful
behavior beyond a green exit. Preserve the manifest and its verification strength.

For apps, prove the base slice first and then implement the app. Exercise app addition
to an existing base where feasible. Use local provider stubs rather than paid calls.
Do not deploy, publish, push, change personal tool configuration or use credentials.
External account and device requirements remain explicit limitations.

Each group writes its own report here. Record composition, adapter, package identity,
tool versions, timing, actual verification counts/outcomes, behavior exercised,
friction, reproducible findings, workarounds, unsupported conclusions and cleanup.
Use portable paths in tracked reports, relative to a named temporary QA root; never
include personal paths, credentials or personal host names. Preserve compact logs
or result excerpts before deleting projects. Distinguish recipe defects, CLI defects,
implementation mistakes and environmental limitations. A partial run is not a pass.

After each run, stop only processes/containers owned by that run, remove owned data
volumes, delete its temporary project and confirm cleanup. Keep findings even when a
stack cannot reach green. No ledger import: these are manual diagnostic runs.
