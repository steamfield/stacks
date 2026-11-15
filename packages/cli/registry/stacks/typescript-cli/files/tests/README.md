# CLI invocation tests

Start with [cli.test.ts](cli.test.ts) for parser, stdout, JSON and safe-error
contracts. [config-logging.test.ts](config-logging.test.ts) checks real
configuration precedence, emitted records, file-sink failures and invocation
isolation.

[helpers/cli.ts](helpers/cli.ts) runs the real invocation boundary with Node
services, temporary paths and captured writers. [helpers/setup.ts](helpers/setup.ts)
clears inherited application settings before modules load.

Vitest runs these tests and adjacent source unit tests on Node.
`../e2e/binary.test.ts` separately exercises the Bun-compiled artifact; both
runners load the isolation helper.

