# Development scripts

These scripts support local setup and package verification; they are outside the
platform-neutral library and may use Node APIs.

Start with [consumer.ts](consumer.ts) to follow the published-package check. It packs
the library, installs the tarball into a temporary copy of `../tests/consumer/`, then
typechecks and runs the TypeScript and JavaScript fixtures on Node. Run it with
`bun run test:consumer`; the package's prepack script builds the output first.

[prepare.ts](prepare.ts) runs during `bun install` and installs lefthook hooks when
`lefthook.yml` exists. It skips CI and reports an unavailable hook installer without
failing dependency installation.

`check-file-headers.sh`, when present, is the `file-headers` verify step: it lists source
files under `src/`, `scripts/` and `tests/` that lack a file-level doc comment.
