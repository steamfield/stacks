# Development scripts

Start with [dev.ts](dev.ts), the foreground API wrapper. It saves terminal output,
rotates logs and records its processes. [dev-bg.ts](dev-bg.ts) starts, reuses and stops
that session for agents. [dev-pid.ts](dev-pid.ts) tracks ownership;
[dev-status.ts](dev-status.ts) reports readiness and problems.

[dev-logs.ts](dev-logs.ts) owns record parsing and paths; [logs.ts](logs.ts) filters
records as text or JSON. Smoke tests use temporary projects from
[helpers/dev.ts](helpers/dev.ts). [boundaries-lint.test.ts](boundaries-lint.test.ts)
probes Biome's architecture rules. [prepare.ts](prepare.ts) installs configured hooks
outside CI.

When present, `check-file-headers.sh` checks documentation headers under `src/`,
`scripts/` and `tests/`.
