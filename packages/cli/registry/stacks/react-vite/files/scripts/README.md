# Browser development setup

[prepare.ts](prepare.ts) runs during dependency installation outside CI. It
installs lefthook hooks when `lefthook.yml` exists and downloads Playwright's
Chromium browser when Playwright is installed. Setup failures print a manual
retry command without failing dependency installation.

`check-file-headers.sh` supplies the `file-headers` hygiene check. It reports
source under `src/`, `scripts/` and `tests/` that lacks a file-level doc comment,
excluding fixtures and generated output.

The package scripts invoke these tools from the project root. CI performs its
own hook-free dependency and browser setup.

