# Workspace development scripts

Start with [dev.ts](dev.ts), which runs the API and Astro together and stops both
when either exits. It records process ownership and saves terminal and structured
logs. [dev-bg.ts](dev-bg.ts) starts, reuses or stops that session for agents;
[dev-pid.ts](dev-pid.ts) tracks its processes and [dev-status.ts](dev-status.ts)
reports readiness.

[dev-logs.ts](dev-logs.ts) defines shared records and paths; [logs.ts](logs.ts) filters
them. Smoke tests build temporary projects with [helpers/dev.ts](helpers/dev.ts).
[boundaries-lint.test.ts](boundaries-lint.test.ts) probes workspace import rules.
[prepare.ts](prepare.ts) installs configured hooks outside CI.

When present, `check-file-headers.sh` checks headers under root `src/`, `scripts/`
and `tests/`.
