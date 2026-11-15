# core/deps

This folder holds the two low-level halves of the dependency reader: a guarded file read and
pure manifest parsing. Together they let `core/deps.ts::readDependencies` find out which
well-known libraries a project uses, and at which major version, after a green `stacks verify`,
without running any of the project's tools.

## How it fits

Telemetry is the only consumer. After a green verify run, `telemetry/projects.ts` may attach
the project's dependencies to its verify event, at most once every 7 days per project. It calls
`core/deps.ts::readDependencies` with the signed dependency allowlist cached on the machine
(`core/allowlist.ts`). `deps.ts` decides which files to read for each ecosystem and which names
to keep; this folder reads and parses those files.

The CLI executes nothing it reads (`.claude/rules/architecture.md`, "Trust model", point 1), so
nothing here asks `npm`, `pip`, `go` or `cargo` for an answer. Manifests and lockfiles are read
as data. Like the rest of `core/`, the folder never imports `platform/` or `commands/`; file
access goes through Effect's `FileSystem` and `Path`, passed in by the caller.

## The flow of one read

1. `deps.ts::readDependencies` resolves the project root's real path and builds a `read`
   function over `files.ts::readProjectFile`.
2. For each ecosystem, `deps.ts` reads the manifest (`package.json`, `pyproject.toml`, `go.mod`,
   `Cargo.toml`) and parses it with `parse.ts::json` or `parse.ts::toml`.
3. It keeps only allowlisted names, then finds each one's major: from the installed
   `node_modules/<name>/package.json` for npm, from `go.mod` itself for Go, and from the lockfile
   (`uv.lock` or `poetry.lock`, `Cargo.lock`) through `parse.ts::packageMajors` for PyPI and
   crates.
4. `deps.ts` merges duplicates, sorts by ecosystem then name, and caps the list at 100.

Every step that can't read or parse a file treats it as absent. The report is best-effort, so a
missing lockfile means an unknown major (`null`), and a broken manifest means nothing from that
ecosystem.

## Files

| File | What it owns |
| --- | --- |
| `files.ts` | `readProjectFile`: one file read, refused when its given or real path leaves the project root, when it isn't a regular file, or when it is over 2 MiB |
| `parse.ts` | Pure parsing: JSON and TOML to plain records, `major`, `names`, and `packageMajors` for lockfile package rows |

The ecosystem readers and the Go `go.mod` parser live in `core/deps.ts` itself, next to the
exported `readDependencies` and `goAllowlistKey`.

## Terms

- **Allowlist**: the signed list of public package names per ecosystem (`DependencyAllowlist`
  from `@steamfield/stacks-format`). A name not on it is never reported, so a private package's
  name stays on the machine.
- **Major**: the part of a version the report keeps. `18.3.1` gives `18`; a `0.x` version keeps
  its minor (`0.7.9` gives `0.7`), since each `0.x` minor may break compatibility. `null` means
  unknown: not installed, not locked, or locked at two majors with no root row to choose.
- **Root row**: the lockfile row for the project's own package. Its dependency list says which
  version the project uses directly when the lockfile holds several, and it wins in
  `packageMajors`.

## Where to start

Read `core/deps.ts::readDependencies`, then `parse.ts::packageMajors`. The tests are
`packages/cli/tests/dependency-reader.test.ts` and `dependency-reader-extra.test.ts`; the
telemetry side is covered by `dependency-telemetry-client.test.ts` and
`dependency-telemetry-edge.test.ts`.
