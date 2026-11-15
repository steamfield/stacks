# CLI development scripts

Start with [dev.ts](dev.ts) for source invocations with checkout-local logs and
development data. It preserves terminal behavior and exit status, and rotates
log files. [build.ts](build.ts) compiles `src/bin.ts` into the package-named
executable with dotenv and bunfig autoload disabled.

[prepare.ts](prepare.ts) installs lefthook hooks during dependency installation
when a hook configuration exists outside CI; unavailable hooks do not fail the
install.

`check-file-headers.sh` is the `file-headers` hygiene check for source under
`src/`, `scripts/` and `tests/`. Package scripts run these tools from the project root.

