# Server development scripts

Start with [smoke.ts](smoke.ts), the check of the built server through MCP
Inspector's CLI. Run `bun run build` before `bun run smoke`; the script lists tools
and checks their names, descriptions and input schemas.

[prepare.ts](prepare.ts) runs during dependency installation and installs
lefthook hooks when `lefthook.yml` exists outside CI. An unavailable installer
is reported without failing installation.

`check-file-headers.sh` is the `file-headers` hygiene check. It reports source
under `src/`, `scripts/` and `tests/` that lacks a file-level doc comment.

