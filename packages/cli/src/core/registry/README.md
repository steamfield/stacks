# core/registry

This folder finds stacks and fragments. Whenever a command needs an entry (`stacks list`, `show`,
`new`, `add`, `search`, `validate`, `create`), it asks the `Registry` service defined here, which
reads the registry roots, picks the winning copy of each entry and checks it is safe to read.

## How it fits

Commands build the service with `registry.ts::Registry.layer`, over the roots that
`registry.ts::defaultRoots` returns (project, user, bundled) or `registry.ts::remoteRoots`, which
also turns on the signed remote index. Commands that only need local entries use the first, so they
never make a network request. Core modules such as `core/compose/`, `core/list.ts`, `core/show.ts`,
`core/create.ts` and `core/validate/` then read entries through the service's methods.

The folder depends on `core/remote-index.ts::RemoteIndex` (downloads and caches index bundles),
`core/search/sidecar.ts` (search cards, vocabulary, dependency cards and `authors.json`) and on the
entry format schemas in `@steamfield/stacks-format`. Like the rest of `core/`, it never imports
`platform/` or `commands/` and reads the filesystem only through Effect's `FileSystem` and `Path`.

Two rules from `.claude/rules/architecture.md` ("Trust model") live here:

- Point 2: `registry.ts::trustOf` decides trust from where an entry was found. Project entries and
  entries from a bundled root replaced by `STACKS_REGISTRY_DIR` are untrusted; user entries and the
  shipped bundled ones are trusted. `remote.ts` trusts index entries only from the official URL.
- Point 1, indirectly: the registry only reads entries and never runs anything in them. It also
  never follows a symlink inside an entry, so an entry can't make the CLI read or copy a file from
  somewhere else on the machine.

## The flow

1. The first method call runs `load` in `Registry.layer` once. For each root in priority order,
   `load.ts::loadRoot` lists `stacks/` and `fragments/` by sorted name and turns each directory
   into a candidate: `STACK.md` or `FRAGMENT.md` decoded by `entry.ts::decodeEntry`, or a
   rejection naming what's wrong. It also registers each entry's deep check without running it.
2. `registry.ts` keeps the first root's candidate for each kind and id. The lower copies become
   the winner's `shadows`, and trust is set with `trustOf`. The result is sorted stacks first,
   then fragments, each by id.
3. `remote.ts::remoteRegistry` merges in the signed index when the roots ask for it, between the
   user and bundled roots. It reuses a bundled entry whose files match the index digest, and
   downloads others only when someone asks for that entry.
4. `catalog` returns names and tags from that view without any deep check. `get`, `all`, `files`,
   `tree`, `read` and `bytes` first run the entry's deep check (`tree.ts::walkEntry`, cached for
   the invocation), which turns a symlink or an unreadable directory into a failure.

Everything is cached inside the layer for one invocation only. A second invocation builds a new
layer and reads the disk again.

## Files

| File | What it owns |
| --- | --- |
| `registry.ts` | The `Registry` service and its layer, the roots, `trustOf`, picking winners and the typed failures for a rejected entry |
| `load.ts` | Reading one root into candidates, rejection messages, the newer-schema skip and the project root's symlink rule |
| `tree.ts` | Reading inside an entry without following symlinks: the walk, the tree, the shipped file list and single-file reads |
| `remote.ts` | Merging the signed index between user and bundled entries, pinned default fragments and their bundled fallback |
| `entry.ts` | The `Entry` and `RejectedEntry` shapes, frontmatter splitting and decoding, and which shipped files reach a project |
| `types.ts` | The internal shapes the loading modules share (`Candidate`, `Rejection`, `Skipped`, `Walked`) |

## Terms

- **Root**: one place entries are found, in priority order: `project` (`.stacks/` in the working
  directory), `user` (the user registry directory), `index` (the signed remote index) and
  `bundled` (the registry shipped in the package, or `STACKS_REGISTRY_DIR`).
- **Candidate**: what one entry directory became after loading, an entry or a rejection.
- **Winner** and **shadows**: the highest root's candidate for a kind and id wins; the origins of
  the lower copies it hides are its `shadows`, and `show` and `list` report them.
- **Rejected entry**: a directory that is there but can't be used (bad frontmatter, an id that
  doesn't match the directory name, a missing markdown file, a symlink). Its `error` is one line
  that `list` and `validate` print, so the wording is user-visible. Asking for one with `get`
  fails with `EntryInvalid`, or `PermissionDenied` when it was unreadable.
- **Skipped**: what loading passed over without rejecting: an entry whose `schema_version` is
  newer than this CLI reads (so a lower root's copy can win) and a symlinked project root or
  `stacks/` or `fragments/` under it. `validate` reports these.
- **Deep check**: the walk of an entry's whole tree for symlinks and unreadable directories. It
  runs per entry, on demand, so listing names stays cheap as the registry grows.
- **Pinned composition**: an index stack's exact default fragments, by digest, carried on
  `Entry.composition` so the composition matches what was proven.

## Where to start

Read `registry.ts::Registry.layer` first: the `load` and `view` effects show the whole flow, and
the returned object maps each method to its step. Then `load.ts::loadRoot` for how a directory
becomes a candidate, and `remote.ts::remoteRegistry` for the index. AGENTS.md ("Architecture
map", the `src/core/registry/` and `src/core/remote-index.ts` entries) has the same facts in brief.

Tests, all in `packages/cli/tests/`:

- `registry.test.ts`: precedence, shadows, trust, rejections, symlinks and reads.
- `registry-single-entry-acceptance.test.ts`, `registry-single-entry-regressions.test.ts`: that a
  command needing one entry deep-checks only that one, and how a deep-check failure is reported.
- `remote-index.test.ts`, `remote-origin-edge.test.ts`: the index merge, pinned fragments and
  bundled identity.
- `entry-schema.test.ts`: frontmatter decoding and its one-line messages.
- `list.test.ts`, `list-project.test.ts`, `show.test.ts`, `bundled-registry.test.ts`: the
  registry as the commands show it.
