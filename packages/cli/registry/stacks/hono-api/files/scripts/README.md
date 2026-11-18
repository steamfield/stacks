# Development scripts

[prepare.ts](prepare.ts) runs during dependency installation. It installs
lefthook hooks only when `lefthook.yml` exists outside CI, so it does not create
an example hook configuration. An unavailable installer is reported without
failing `bun install`.

[openapi.ts](openapi.ts) asks the app's own `/openapi.json` route for the
document in process, with no server or port. `bun run openapi` writes it to
`openapi.json` and formats it with Biome; `bun run check:openapi` exits 1 when
the committed file is missing or differs from a fresh document, comparing parsed
JSON so formatting doesn't count. Commit `openapi.json` with every route or
schema change.

`check-file-headers.sh` supplies the `file-headers` hygiene check for source under
`src/`, `scripts/` and `tests/`. It reports missing file-level comments; folder
reading guides remain an authoring judgment.

The package scripts invoke these files from the project root.
