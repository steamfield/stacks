# Invocation test support

Start with [cli.ts](cli.ts): `runCli` composes real Node services with the
application layers, captures streams and returns an exit status. It supplies
temporary directories and a JSON-line decoder for assertions in the parent tests.

[setup.ts](setup.ts) runs before application modules in both test runners. It
removes inherited secret and application settings, redirects home and XDG paths
to a temporary directory, and removes that directory on process exit.

The invocation helper calls the same `main` and `runInvocation` used by the
process entry, so tests exercise the actual output and failure boundary.

