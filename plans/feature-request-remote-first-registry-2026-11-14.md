# Feature request: make the hosted index the source of truth for entry content

Status: PROPOSED 2026-11-14. Not scheduled. Priority: high (2026-11-15), next after the
`feat/agent-dx` release, paired with
[moving the registry into its own repository](feature-request-registry-repo-2026-11-15.md).
Raised after a timeboxed `stacks new typescript-library`
dry run where nobody could tell which copy of the stack the agent had received.

## Problem

Stack and fragment content reaches a user from two places that release on different schedules:

- The bundled registry, `packages/cli/registry`, shipped inside the npm package. It changes only
  when someone runs `bun run release` and publishes to npm.
- The hosted, signed index at `https://stacks.steamfield.io` (`DEFAULT_API_URL` in
  `packages/cli/src/bin.ts`). stacks-api's `prod:deploy` builds it with `build:index` from whatever
  stacks git checkout `STACKS_CLI_DIR` points at (`~/Projects/stacks-api/scripts/production.ts`).

Correction, checked later the same day: released CLIs don't consult the hosted index at all yet.
`bin.ts` passes `officialUrl: undefined` to `RemoteIndex.layer`, and `INDEX_PUBLIC_KEYS` in
`packages/format/src/index-keys.ts` is empty. So unless `STACKS_INDEX_URL` is set, a CLI runs only
from its bundled registry, and content reaches users only through npm releases. Doing this request
starts with ending that interim state: ship the production public key in stacks-format and set
`officialUrl`. Everything below describes how the code behaves once an index URL is configured.

The registry resolves `project`, `user`, `index`, `bundled` in that order
(`order` in `packages/cli/src/core/registry/remote.ts`). The index already shadows the bundled copy,
so in practice the bundled copy only serves as a release-time snapshot and offline fallback. But the
CLI never says which one it used, and both copies can be stale:

- The index body is cached for 24 hours (`DAY` in `packages/cli/src/core/cached-fetch.ts`).
  `current()` returns the cached body without a request while it is younger than that, so a deploy
  can take up to a day to reach a machine that fetched recently.
- A fetch has a 1500 ms deadline. A failure backs off for 10 minutes, or 24 hours for a 404, and
  the CLI silently falls through to the cached or bundled copy.
- The brief names an entry's origin only for untrusted entries (`T.untrusted.entry` in
  `packages/cli/src/core/brief/render.ts`), so a trusted entry served from the index, the cache or
  the bundle looks the same in the brief and in `.stacks/manifest.json`.

What happened on 2026-11-14: typescript-library refinements landed on main, the production index
was deployed from that commit, and 0.8.0 was published to npm afterwards. When we triaged a dry-run
agent's feedback, we couldn't tell whether it had seen the old stack (index cached before the
deploy) or the new one. `stacks doctor` shows when the index was last cached, but nothing ties a
generated project to the content it was generated from.

What happened on 2026-11-15: a machine with CLI 0.9.0 installed ran `stacks search "slide
presentation"`. Search ranks through the hosted API, which knows the current registry, so it
returned `decks` as a strong match with `Next: stacks show decks, then stacks new decks <dir>`.
`decks` first shipped in 0.11.0, and with the remote index off the CLI resolves only its bundled
registry, so `stacks show decks` answered `Not found.` The API could reach the entry, the CLI could
reach the API, and the user still had to upgrade the CLI to get one new stack. Once the index is on,
an entry the bundled registry lacks should resolve from the index for `show`, `new` and `add`
(stacks and fragments alike), with `minCli` deciding whether this CLI can use it. Until then,
`mergeHits` in `packages/cli/src/core/search/merge.ts` keeps API-only hits and `next()` in
`packages/cli/src/core/search/report.ts` points at `show` and `new` for them, a hint the CLI can't
satisfy; search should mark those hits as needing a newer CLI (or the index) instead.

A second, smaller problem: production builds the index from a working checkout. At the time of
writing, `STACKS_CLI_DIR` in the production settings points at a developer's checkout that sits
on a feature branch. The 0.8.0 deploys had to override it with a scratch `STACKS_PRODUCTION_DIR`.
If entry content is going to ship by deploy rather than by npm release, the deploy has to build from
a pinned ref.

## Goal

Entry content (stacks, fragments, deps metadata) ships by deploying the index. The CLI uses fresh
content when it can, says plainly when it can't, and records which content each project came from.
A CLI release is needed only for CLI behavior or a new entry schema, and `minCli` gates it.

## Proposal (recommended)

Keep the bundled registry as a cold-start and offline fallback, and make the index authoritative
with visible provenance.

1. Fresh index on the commands that write projects. `stacks new` and `stacks add` revalidate the
   index before composing instead of trusting a body younger than 24 hours. Use a conditional
   request: the server sends an `ETag` (or `Last-Modified`), and the CLI stores it in the cache
   state and sends `If-None-Match`. A 304 costs one round trip and no body. Read-only commands
   (`list`, `show`, `search`) keep the 24-hour TTL. Keep the existing deadline and backoff
   behavior, but a write command should ignore a backoff set by a read command's failure. Decide
   whether to raise the 1500 ms deadline for write commands; see the open questions.
2. A visible fallback. When a write command can't refresh, print one line naming the source used
   and its age, for example
   `index unreachable (timeout); using cached index from 2026-11-13 18:40 (21h old)` or
   `... using the registry bundled with stacks 0.8.0`. The line goes to stderr and into the `--json`
   result. It is not an error. Exit codes don't change.
3. Provenance in the project. Record, per composed entry, `origin` (`index`, `bundled`, `user`,
   `project`), the entry `digest`, and for index entries the index `commit` and `generatedAt` (or
   whatever the signed index header carries). Store it in `.stacks/manifest.json` (or the project
   state record) and print one line in the brief for the stack, for example
   `typescript-library: index ed53c72, fetched 2026-11-14 18:40`. `stacks verify` and
   `stacks doctor` can then answer "what was this project built from" without guessing.
4. `stacks doctor` reports the index commit, cache age, ETag and last outcome, plus, for each
   bundled entry the index shadows, whether the digests differ. Also add a `stacks index refresh`
   command, or a `--refresh` flag on `new`/`add`, that forces a refetch and ignores backoff.
5. `minCli` stays the gate. An entry that needs a newer CLI (a new manifest field, such as the
   `--payload none` declaration being added on `feat/agent-dx`) ships with a raised `minCli` in the
   index header. An older CLI rejects that index and falls back to cache or bundled with the
   message from item 2, plus `run stacks update`. Check whether `minCli` should be per entry rather
   than per index, so one new-schema stack doesn't push every older CLI back to its bundled copy.
   That's the main design question here.
6. Pinned deploys. stacks-api's `prod:deploy` builds the index from a fetched tag or commit of the
   stacks repo (a clean, temporary worktree or clone of `origin`) rather than from `STACKS_CLI_DIR`.
   The ref is passed explicitly (`prod:deploy --ref v0.8.1` or `--ref <sha>`). It is recorded as
   the index `commit`, and the deploy refuses a dirty tree. This change lives in
   `~/Projects/stacks-api` and should land as a separate commit there.

The fallback order stays `project`, `user`, `index`, `bundled`. The existing digest shortcut in
`resolveEntry`/`pinnedFragments` stays too: when a bundled entry's directory matches the index
digest, it uses the bundled copy and downloads nothing.

## Alternative considered: stop shipping entries in the npm package

Drop `packages/cli/registry` from the published package. The CLI would populate its cache from the
API on first use and run only from that cache. This is not recommended for now:

- An offline or first-run `stacks new` with an empty cache would fail outright. That covers fresh
  machines, CI runners and sandboxes.
- The CLI tests, `validate`, the composition snapshot tests and `build:index` itself read the
  bundled tree. They would need a fixture registry or a live server, and the second makes the gate
  network-dependent.
- Every composition becomes downloads, because the digest shortcut has nothing local to match.

What it would buy is a smaller package and one copy of the content. If package size becomes a
problem, a middle step is to bundle only the stacks with the most `new` traffic as a seed and fetch
the rest.

## Constraints

- D2 (`plans/README.md`): the CLI never runs a command from an entry. This proposal only fetches,
  verifies and copies files. Nothing here may execute entry content.
- Signature verification (`packages/cli/src/core/remote-index/verification.ts`) applies to every
  index body and bundle. A failed verification is handled like an unreachable index: fall back and
  say so. Never use unverified content.
- `STACKS_OFFLINE=1` and `--offline` mean no requests at all. In offline mode the item 2 message
  says "offline" rather than an error reason.
- `STACKS_INDEX_URL` and `STACKS_REGISTRY_DIR` overrides keep working, and the provenance in item 3
  reflects them (`overridden: true`).
- Trust: today's index entries are trusted. Nothing in this change alters the trust of user,
  project or git-source entries (phases 3.2a and 3.2b).

## Acceptance

Behavior tests, with the HTTP client faked at the boundary and real filesystem caches in temp dirs:

- `new` with a cached index under 24h old and a server returning 200 with new content uses the new
  content and records the new commit.
- `new` against a server returning 304 makes one request, uses the cache and records the cached
  commit.
- `new` with the server timing out falls back to the cache, prints the fallback line with the cache
  age, and still exits 0. With no cache, it falls back to bundled and says so.
- `list` within 24 hours of a fetch makes no request.
- An entry in the index but not in the bundled registry (the 2026-11-15 `decks` case) resolves for
  `show`, `new` and `add`, and a `search` hit for it gets a `Next:` hint the CLI can follow.
- An index whose `minCli` is above the running version is rejected. The CLI falls back and the
  message names `stacks update`.
- A bad signature is rejected and falls back, and the message says the signature failed.
- `--offline` makes zero requests and the message says offline.
- `.stacks/manifest.json` (or the state record) and the brief carry origin, digest and index commit
  for the stack and each fragment.
- `doctor` shows the index commit, cache age and the bundled-versus-index digest differences.
- stacks-api: `prod:deploy --ref <tag>` builds from that ref in a clean temporary checkout, records
  it as the index commit, and refuses a dirty or missing ref.

Docs: update the CLI docs for the refresh behavior, the fallback message and the new
manifest/brief fields, plus `plans/` (roadmap row and trust model). In stacks-api, update the
deploy runbook.

## Open questions

- Should `minCli` be per entry or per index (item 5)?
- What deadline should write commands use? 1500 ms keeps `new` snappy. Something around 5 s makes a
  silent fallback on a slow network less likely. The fallback is visible either way.
- Does the server already send `ETag`/`Last-Modified` for the index and bundles, or does stacks-api
  need that first?
- Should `stacks verify` warn when the project's recorded index commit is older than the current
  index, for example "typescript-library has changed since this project was created"?

## Sequencing

This is separate from the `feat/agent-dx` work (verify split, `--payload none`, `--preset lean`,
`--own-repo`, the brief action list). Land it after that release. If `feat/agent-dx` adds manifest
fields to stack entries, that release should already raise `minCli`. This request then makes the
fallback for older CLIs visible instead of silent.

Land it together with [the registry repository split](feature-request-registry-repo-2026-11-15.md)
(decided 2026-11-15). Item 6's pinned deploy builds from a tag of that repository rather than of
this one, so design the two together: shipping the index key and `officialUrl` is what makes a
merged community stack reach users without a CLI release.
