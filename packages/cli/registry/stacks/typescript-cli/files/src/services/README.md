# Invocation services

Start with [output.ts](output.ts), which buffers successful results for stdout
and sends notes and safe errors to stderr through injected writers. It owns
text versus JSON presentation and maps writer failures.

[host.ts](host.ts) supplies runtime metadata from the process entry or tests.
[invocation.ts](invocation.ts) lets a command record its name for the final
command log, with fresh state per run.

[../runtime.ts](../runtime.ts) composes application layers, and
[../bin.ts](../bin.ts) supplies platform services and real writers.
Core diagnostics consume these interfaces without reading process globals.

