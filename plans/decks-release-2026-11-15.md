# Decks stack and the next CLI release

Status: DRAFT 2026-11-15. Not started. The maintainer chose to merge `decks` without a bench proof,
knowing it cannot install until `@steamfield/decks` is on npm. The maintainer runs the final
`bun run release` themself; an agent prepares everything up to it.

## Where this stands

- The `decks` stack exists only on the local branch `feat/decks-stack` in the main checkout (one
  commit, `feat(registry): add the decks stack for Decks slide-deck projects`), not pushed, no pull
  request. It adds `registry/stacks/decks/` (STACK.md, a Claude adapter, four files) and
  `registry/search/stacks/decks.json`.
- Its commit message lists what is pending: the `@steamfield/decks` allowlist row and dependency
  card, golden judgments, and a bench run. It was proven locally against a packed `1.0.0-rc.0`
  tarball of the decks framework (conventional and story decks, `verify --all` green).
- `@steamfield/decks` is not on npm (`npm view` returns 404 on 2026-11-15). The framework's own
  repository is `~/Projects/decks` (read-only for this work). Until it is published, `bun install`
  fails in a scaffolded `decks` project, so the bench cannot run and a user who picks the stack gets
  a failed `install` step.
- `origin/main` is at `908fcb16`, ten commits past `v0.9.0` (fixes and refactors, including
  `packages/format/src/search/schema.ts` renaming the search result's last-run shape to
  `SearchLastRun`). Nothing since `v0.9.0` is published. npm has `@steamfield/stacks` 0.9.0,
  `@steamfield/stacks-format` 0.7.0 and `@steamfield/stacks-mcp` 0.1.2.

## Steps

1. On `feat/decks-stack`:
   - Add the `@steamfield/decks` row to `packages/cli/registry/allowlist.json`.
   - Add its dependency card to `packages/cli/registry/deps/npm.json`, following the neighbouring
     cards and the card rules in `packages/cli/docs/maintaining.md` (an agent's draft carries its
     `reviewedAt` date when written). Take what the package is from `~/Projects/decks`, not memory.
   - Add golden judgments for `decks` to `packages/cli/tests/fixtures/search/golden.json` as
     `maintaining.md` describes: read the entry first, respect the tune/holdout split, and keep
     holdout queries out of, and five consecutive words away from, the sidecar's `requests`.
   - Run `bun run dev validate` and fix every error finding. (A Claude Code session started from the
     `stacks-api` checkout had its command guard block `bun run dev` as a foreground server; run it
     from a terminal or a session in this repository.) An unproven-ledger finding for `decks` is
     expected.
     Check whether it fails the gate or `build:index`; if it does, stop and record exactly what
     blocks rather than weakening a check or writing a ledger record that no run produced.
   - Update what the tests require when a bundled stack is added (bundled brief digests, stack
     lists, search fixtures). Find those by running the scoped tests.
2. Run the gate once (`rr check`, since the clone is opted in) and read the counts. Commit.
3. Merge into `main` after fetching `origin/main`, push, delete the merged branch. No history
   rewrites, no force-push.
4. Prepare the release without publishing:
   - `@steamfield/stacks` needs a new version. `@steamfield/stacks-format` needs one only if its
     published surface changed since 0.7.0 (diff `packages/format/src` against `v0.9.0`; the
     `SearchLastRun` rename is the known candidate). `@steamfield/stacks-mcp` as
     `scripts/release.ts` and `packages/format/README.md` ("Publishing") require.
   - Bump versions and anything that pins them, commit, push.
   - `bun run release:dry-run` and read it. It packs and checks all three packages and publishes
     nothing.
5. The maintainer runs `bun run release` (publishes format, CLI, MCP in that order from
   `origin/main` and tags `v<cli version>`). If only the format package must be out first,
   `bun run release:format` does that alone.
6. After the publish, from the `stacks-api` checkout: `bun run prod:deploy -- --ref v<new version>`
   (dry run first with `--dry-run`), then retry the Worker's latest build or push a commit to
   `stacks-api` `main`. The site only changes when its build reads the new index.
7. Once `@steamfield/decks` is published: `bun run bench decks --keep` (maintainer tokens), commit
   the ledger record, and release again if the stack should carry a proof.

## What a user sees before step 7

`stacks list` shows `decks` unproven. `stacks new decks` writes the files and the brief; the
brief's install step (`bun install`) fails with a 404 for `@steamfield/decks`. Nothing in the CLI
checks that a stack's dependencies exist on npm, so there is no earlier warning.

## Findings that shaped this plan

- `prod:deploy --ref <commit older than v0.9.0>` fails: its `--previous` check needs the production
  key that stacks 0.9.0 added, so the previous live index cannot be verified by older checkouts
  (`https://stacks.steamfield.io/v1/index.json: signature verification failed`). The live index was
  built at stacks `ed53c72` (the `v0.8.0` line); redeploying it as it was is no longer possible.
  A deploy has to move the index to `v0.9.0` or later.
- Released CLIs do not read the hosted index yet (`feature-request-remote-first-registry-2026-11-14.md`):
  content reaches CLI users only through npm releases, so a `prod:deploy` changes the site and the
  API, not what `stacks new` writes.
- Two repositories release in sequence: stacks (npm), then stacks-api (index and site). The index
  must be built from the tag that was just published.

## What this plan may get wrong

- Whether an unproven `decks` stack fails `validate` or `build:index`. If it does, the maintainer's
  "merge unproven" choice needs another route (a ledger exemption, or merging after the bench).
- The version numbers: decide them from the diff, not from this file.
