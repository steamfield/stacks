# Development scripts

[prepare.ts](prepare.ts) runs during dependency installation. It installs
lefthook hooks only when `lefthook.yml` exists outside CI, so it does not create
an example hook configuration. An unavailable installer is reported without
failing `bun install`.

`check-file-headers.sh` supplies the `file-headers` hygiene check for source under
`src/`, `scripts/` and `tests/`. It reports missing file-level comments; folder
reading guides remain an authoring judgment.

The package scripts invoke these files from the project root.

