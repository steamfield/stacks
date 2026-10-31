# Phase 3.2a: Git sources and the untrusted origin

Status: DEFERRED 2026-10-27 to phase 4 or later. Gated: starts only when someone outside the maintainers asks for third-party sources, and after open question 18 is answered. Neither has happened, so the phase 2-3 run on 2026-10-27 left it unbuilt; the release's remote origin (roadmap, Feature gaps, "3.2c") reuses its hardened git calls and still needs its own plan.

| Field | Value |
|---|---|
| Goal | A user can add a git repository of stacks as a source pinned to one commit, fetched with hardened `git` calls that run nothing from the repository or the user's git setup; its entries appear as `origin: "source"` and untrusted; and a person (never an agent) can allowlist a project entry or confirm a source commit with `stacks trust`, recorded in the trust store |
| Traces to | Success row 5: "Stacks and fragments in `~/.stacks` and third-party sources, not only the bundled registry." The stack author: "for themselves, their team, or strangers." Jobs: "the emotional job underneath all of these is trust ... why the CLI never runs commands from an entry." Risk: "Third-party stacks ship hooks or scripts the user's agent will run" |
| Depends on | 3.1a (soft: `show`'s report is the interim review). 0.3b's `Processes.exec` (argv spawn with no shell, captured output and a timeout) for every `git` call, and `Processes.which`. 1.0's registry. Demand gate: the roadmap's dashed edge; see [risks](../risks-and-open-questions.md#risks), "A community registry never forms" |
| Blocks | 3.2b. Nothing in phase 4 depends on it |
| Decisions needed | Open question 18 (blocks this sub-phase): keep or disable the user's global git config, credential helper included. The design below assumes "disable" and says what changes otherwise. D19 (proposed): if project entries were trusted by default, `stacks trust stack|fragment` would only matter for shadowing entries. Open question 9: the limits of "a person confirmed" apply unchanged |
| Settles | How a source is identified, pinned, fetched, stored and removed; where sources rank; the trust store's shape; the `stacks trust` command |

## Scope

In:

- `stacks source add <git-url> [--ref <branch|tag|sha>] [--name <name>] [--json]`, `source list [--json]`, `source remove <name> [--json]`.
- The source origin in the registry loader, ranked last.
- The trust store at `$XDG_STATE_HOME/stacks/trust.json` ([roadmap, Other shared facts: Trust store](../roadmap.md#other-shared-facts)), read by the registry loader for project and source entries.
- `stacks trust stack <id>`, `trust fragment <id>`, `trust source <name>`, each with `--dry-run`; `trust list [--json]`; `trust revoke <digest>` and `trust revoke source <name>`.
- `Settings.sources`.

Out:

- `source update` and its diff, and the allowlist trust report (3.2b).
- Signature verification of commits. The pin and the content digest are the integrity mechanism.
- Automatic updates, a central list of sources, and tarball downloads (one fetch path only).
- Annotating `verify` output with step origins.
- Any CI wiring (D23).

## Design

### Where this fits

3.2a makes sources exist and makes trust grantable; 3.2b makes source changes reviewable. Until 3.2b lands, `stacks trust` shows `show`'s full output (3.1a) for each entry, which lists every file, body, command and verify step but marks nothing. 3.2b swaps in the allowlist trust report ([Trust model](../roadmap.md#trust-model) point 6) at the same call site and adds `source update`. Don't publish a release that has 3.2a without 3.2b.

### Untrusted behavior is already built

Every rule for untrusted entries is in [Trust model](../roadmap.md#trust-model) point 3 and keys off `Entry.trusted`, which exists from 1.0 (point 2). This sub-phase adds no new untrusted behavior: it sets `trusted` for source entries and, through the trust store, for allowlisted project entries. The acceptance tests prove each point-3 rule holds for a source entry.

### Identity and storage

A source is a URL plus a pinned commit, recorded in `Settings.sources`, an ordered array of `SourceConfig`:

```ts
// src/schemas/source.ts
export const CommitSha = /* Schema.String, pattern ^[0-9a-f]{40}([0-9a-f]{24})?$, branded "CommitSha" */;
export const SourceConfig = Schema.Struct({
  name: EntryId,                       // kebab-case, unique
  url: Schema.String,                  // validated as below, stored as given
  ref: Schema.optional(Schema.String), // what the user asked for; 3.2b's update reuses it
  commit: CommitSha,                   // the pin
  addedAt: Schema.String,
});
```

No trust lives here: `config.json` is agent-editable, and confirmations go to the trust store (point 4). An agent that edits `commit` or `url` gets entries that no confirmation matches, so they read as untrusted.

The name defaults to the URL's last path segment without `.git`; a collision or a non-kebab result is `BadInput` asking for `--name`.

Checkouts live at `$XDG_DATA_HOME/stacks/sources/<name>/<commit>/`, written once and never rewritten, with `.git` removed. Inside a checkout the layout is 1.0's registry layout, at the repository root or under `registry/` if that directory exists.

`source remove <name>` deletes the config entry, every checkout under `sources/<name>/`, and the trust store's confirmations for that name. A checkout no config entry names is never read, and leaving a confirmation behind would silently re-trust a later source added under the same name and URL. Projects already built from the source keep working: their manifest holds the steps.

### Precedence

Sources rank last, after every other origin (project, user and bundled from 1.0, and the index when 4.0d adds it). A source can add ids but can't shadow one another origin provides: such an entry is hidden from lookup, and `list` shows a warning naming it. Between sources, `Settings.sources` order decides. The reason is the agent path: an agent told "use go-cli" must not get an unreviewed source's copy. A team that wants its own `go-cli` uses another id, or copies it into the user directory with `create --from source` (3.1b), which runs the review.

`Entry` needs the source name for `list`, `show` and the brief. This sub-phase adds an optional `source` field (the source's name) to `Entry` and to the `list --json` and `show --json` entries, as [roadmap, Contracts: Entry and its listing](../roadmap.md#types-and-schemas) records. `EntryRef` in the manifest records only `origin: "source"`, so the manifest schema is unchanged.

### Fetching

The only process this sub-phase starts is the CLI's own `git`, located with `Processes.which` and run with `Processes.exec(argv, opts)` (0.3b), which spawns the argv directly with no shell, so a URL or ref is always one literal argument. `Processes.run` (which goes through `/bin/sh -c`) is never used here.

URL rules, checked before any process starts (`BadInput` otherwise):

- No leading `-`.
- Scheme `https://`, `ssh://`, scp-like `user@host:path`, or `file://`. Everything else (`http://`, `git://`, `ext::`, bare paths) is refused.
- No password in userinfo for any scheme, and no userinfo at all for `https://` and `file://`. A token in a URL would end up in `config.json` and in process listings.
- `--ref`, when given, has no leading `-` and is a valid ref name or a commit SHA. Without it, the ref is `HEAD`.

Environment: `childEnv` with every inherited `GIT_*` variable dropped, then `GIT_TERMINAL_PROMPT=0`, `GIT_ALLOW_PROTOCOL=https:ssh:file`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null` (see open question 18 below) and `GIT_SSH_COMMAND="ssh -o BatchMode=yes"`.

Every call carries `-c core.hooksPath=/dev/null -c core.fsmonitor=false -c protocol.ext.allow=never -c submodule.recurse=false`. The sequence:

```
git init --quiet --template= <tmp>
git -C <tmp> <hardening> fetch --quiet --depth 1 --no-tags --no-recurse-submodules -- <url> <ref>
git -C <tmp> <hardening> rev-parse --verify --end-of-options 'FETCH_HEAD^{commit}'
git -C <tmp> <hardening> ls-tree -r -z FETCH_HEAD
git -C <tmp> <hardening> -c core.symlinks=false checkout --quiet --detach FETCH_HEAD
```

- `--template=` keeps `git init` from copying template hooks.
- The commit is whatever `rev-parse FETCH_HEAD` resolves, never the ref text.
- `ls-tree` rejects the source when the tree holds a symlink (mode `120000`) or a submodule (`160000`), before checkout, because `core.symlinks=false` would otherwise turn a symlink into a plain file that 1.0's symlink check can't see.
- Each call runs with `Processes.exec`'s timeout set to `GIT_TIMEOUT` (2 minutes, one constant in `src/core/sources/git.ts`, injectable for tests); interruption kills the process group (0.3b).
- The checkout goes to a temporary directory under `$XDG_DATA_HOME/stacks/sources/` and is renamed into place only after every entry decodes, so a half-fetched source never appears and nothing is written to `config.json`.

Open question 18. Disabling the global config (`GIT_CONFIG_GLOBAL=/dev/null`) means no program from the user's git setup runs and behavior is the same on every machine; private repos work over SSH through the user's SSH agent, not over HTTPS through a stored credential. If the maintainers answer "keep it", drop that one variable: the `-c` flags above still override the user's hooks and fsmonitor, the hostile-config test below must still pass, and the user's credential helper, `url.*.insteadOf` and filter drivers apply as they would for their own `git fetch`.

Failures never echo or log git's stderr (it can hold URLs and hostnames from the user's setup). Git exits 128 for network, auth and unknown-ref failures alike, so there is no retryable distinction: `SourceFetchFailed` (new tag, exit 4, not retryable) with `details: { stage, exitCode }`, `stage` one of `git-missing`, `fetch`, `resolve`, `checkout`, `timeout`.

No other command fetches. `list`, `new` and the rest read stored checkouts only.

### The trust store

```ts
// src/schemas/trust.ts
export const TrustStore = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  entries: Schema.Array(Schema.Struct({ digest: Schema.String, kind, id: EntryId, confirmedAt: Schema.String })),
  sources: Schema.Array(Schema.Struct({ name: EntryId, url: Schema.String, commit: CommitSha, digest: Schema.String, confirmedAt: Schema.String })),
});
```

- `entryDigest` (`src/core/trust/digest.ts`) is sha256 over an entry directory's files sorted by relative path, each as path, length and raw bytes. A source's `digest` is the same function over its checkout directory.
- A project-origin entry is trusted when its current `entryDigest` is in `entries`. Editing any file in it makes it untrusted again.
- A source entry is trusted when `sources` holds the config's `name`, `url` and `commit` and the checkout's current digest. Editing the checkout or the pin makes every entry in it untrusted.
- Written by temp file and rename. An unreadable or higher-version store is treated as empty with one warning, so a broken store can only remove trust. When the state directory isn't writable, confirming fails `PermissionDenied` with `details.reason: "state-unwritable"`.

### `stacks trust`

| Command | Does |
|---|---|
| `trust stack <id>`, `trust fragment <id>` | Allowlist the project-origin entry with that id in the current project (`--dir` to choose one) by its digest |
| `trust source <name>` | Confirm the source's pinned commit and checkout digest |
| any of the above with `--dry-run` | Print the trust report and record nothing; allowed under an agent |
| `trust list [--json]` | Every confirmation, with whether it still matches |
| `trust revoke <digest>`, `trust revoke source <name>` | Remove confirmations; allowed under an agent, since it only removes trust |

A confirmation follows point 4: `PermissionDenied` (`details.reason` `agent` or `no-tty`) unless `AppConfig.agent` is `"none"` and `Host.stdinIsTTY` is true, with or without `--yes`. Otherwise it prints the trust report on stderr, asks y/N, and records on yes; `--yes` skips the question, never the trust report. `source add` never confirms: it records the pin untrusted and prints `stacks trust source <name>` as the next step.

### Interfaces

```ts
// src/core/sources/sources.ts
export class Sources extends Context.Service<Sources, {
  readonly list: Effect.Effect<ReadonlyArray<SourceState>>;
  readonly add: (url: string, opts: { ref?: string; name?: string }) =>
    Effect.Effect<SourceState, BadInput | SourceFetchFailed | EntryInvalid | PermissionDenied>;
  readonly remove: (name: string) => Effect.Effect<void, NotFound | PermissionDenied>;
  readonly fetch: (url: string, ref: string) =>
    Effect.Effect<{ commit: CommitSha; dir: string }, SourceFetchFailed | EntryInvalid>; // 3.2b reuses
}>()("stacks/Sources") {}

// src/core/trust/store.ts
export class Trust extends Context.Service<Trust, {
  readonly read: Effect.Effect<TrustStore>;
  readonly isTrustedEntry: (digest: string) => Effect.Effect<boolean>;
  readonly isTrustedSource: (s: SourceConfig, digest: string) => Effect.Effect<boolean>;
  readonly confirm: (c: Confirmation) => Effect.Effect<void, PermissionDenied>;
  readonly revoke: (r: Revocation) => Effect.Effect<void, NotFound | PermissionDenied>;
}>()("stacks/Trust") {}
```

Core stays platform-free: git through `Processes.exec`, files through Effect `FileSystem` and `Path`.

### Failure modes

| Case | Result | Exit |
|---|---|---|
| Bad URL, ref or name; name collision | `BadInput`, no process started | 2 |
| `git` not on PATH | `SourceFetchFailed`, stage `git-missing` | 4 |
| Fetch, resolve or checkout fails, or times out | `SourceFetchFailed` with its stage; git's stderr not shown | 4 |
| No entries at the root or under `registry/`; an entry fails to decode | `EntryInvalid`; nothing stored | 2 |
| Symlink or submodule in the tree | `EntryInvalid`, reason `symlink` or `submodule`; nothing stored | 2 |
| Confirm under an agent or without a TTY | `PermissionDenied`, reason `agent` or `no-tty` | 6 |
| Trust store not writable | `PermissionDenied`, reason `state-unwritable` | 6 |
| Unknown source or entry id | `NotFound` | 2 |
| Stored checkout deleted by hand | `list` warns and omits the source | 0 |

### Decided here

| Question | Decision | Why |
|---|---|---|
| Pin | By resolved commit, never by branch | A source changes only when the user moves the pin |
| Rank | Last; no shadowing | An agent naming a known id never gets unreviewed content |
| Trust key | Commit plus checkout digest; entry digest for project entries | Editing a confirmed thing un-confirms it |
| `source remove` | Deletes config entry, checkouts and confirmations | Nothing dangling to re-trust later |
| Retryable fetch failures | None | Git's exit status can't tell network from auth |

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/src/commands/source.ts`, `trust.ts` | New handlers |
| `packages/cli/src/core/sources/` | `sources.ts`, `git.ts` (URL rules, env, hardening, timeout), `fetch.ts` |
| `packages/cli/src/core/trust/` | `store.ts`, `digest.ts` |
| `packages/cli/src/schemas/source.ts`, `trust.ts` | `SourceConfig`, `CommitSha`, `TrustStore` |
| `packages/cli/src/schemas/config.ts` | `sources` |
| `packages/cli/src/core/registry/` | Source origin, rank, `source` field, trust lookups for project and source entries |
| `packages/cli/src/errors.ts` | `SourceFetchFailed` row |
| `packages/cli/src/cli.ts` | Register `source` and `trust` |
| `packages/cli/tests/sources.test.ts`, `trust.test.ts` | New |
| `packages/cli/README.md`, `AGENTS.md`, `docs/authoring.md` | Sources, trust, what untrusted changes |

## Acceptance tests

Sources are real repositories made with `git init` and commits in a temporary directory, addressed by `file://`. No network.

1. `source add file://<repo>` stores a checkout at the resolved SHA; `list --json` shows its entries with `origin: "source"`, `source: "<name>"`, `trusted: false`.
2. Hostile user config: the test HOME's `.gitconfig` sets `core.hooksPath` to a directory of marker-writing hooks, `core.fsmonitor` to a marker-writing script and `init.templateDir` to a template with hooks. After `source add`, no marker exists. Runs with and without `GIT_CONFIG_GLOBAL`, so it holds whichever way open question 18 goes.
3. URLs `--upload-pack=touch x`, `-oProxyCommand=x`, `ext::sh -c touch% x`, `http://...` and `https://user:tok@host/r` exit 2 and the `Processes` test layer records no spawn.
4. At the git layer, a fetch of an `ext::` URL with URL validation bypassed fails and writes no marker (`GIT_ALLOW_PROTOCOL` and `protocol.ext.allow`).
5. A fake `git` on PATH that sleeps: with a 1 s test timeout, `SourceFetchFailed` stage `timeout`, and its process group is gone.
6. An unknown ref exits 4; stderr doesn't contain the URL or any git output; `config.json` is unchanged.
7. A tree with a symlink, and one with a submodule, exit 2 and leave nothing under the sources directory.
8. Empty PATH: stage `git-missing`.
9. Point 3 for a source entry: `new <source-stack>` with an agent binary on PATH doesn't launch and the brief opens with stop-and-confirm; `add <source-fragment>` with `CLAUDECODE=1` gives `digestRecorded: false`; if 3.1b has landed, `create --from source` with `CLAUDECODE=1` exits 6.
10. `trust source <name>` with `CLAUDECODE=1` exits 6 (`agent`); without a TTY exits 6 (`no-tty`); with a TTY, no marker and `--yes`, `trust.json` holds name, url, commit and digest, `config.json` is byte-identical, and `new` then launches as normal.
11. After confirming, editing a file in the checkout, or editing `commit` in `config.json`, makes the entries untrusted.
12. `trust stack <id>` on a project-origin stack makes it trusted; editing its body makes it untrusted; under `CLAUDECODE=1` it exits 6.
13. `trust source <name> --dry-run` under `CLAUDECODE=1` prints the trust report, exits 0 and writes nothing.
14. `source remove` deletes the config entry, every checkout and the confirmations.
15. A source stack with a bundled id is hidden; `list` warns; `new <id>` uses the bundled one.
16. An unreadable `trust.json` is treated as empty with one warning.
17. `list` with a configured source starts no process.
18. Shell metacharacters stay literal: a `file://` URL to a repository whose directory name contains `;touch x` and `$(touch y)` (valid under the URL rules) is added successfully, the `Processes` test layer records one `exec` per git call with the URL as a single argv element and no `run` call, and neither `x` nor `y` exists afterwards in the working directory or the test HOME.

## Exit criteria

- Acceptance tests pass; `bun run check` is green from the repo root.
- Open question 18 is answered and the design matches the answer.
- A maintainer adds a real team repository as a source, reviews it with `trust source --dry-run`, confirms it, and builds one project from it to a green `verify`, recorded in a run note in [plans/runs/](../runs/README.md).
- `AGENTS.md`, the CLI README and the authoring guide describe sources, `stacks trust` and what untrusted changes.

## What this plan may get wrong

- Shallow fetch of an arbitrary SHA needs the server to allow it (`uploadpack.allowReachableSHA1InWant`). Common hosts do; a self-hosted server may not, and the fix is a full fetch for SHA refs.
- Hashing every checkout on every command that loads the registry costs time on large sources. If it shows, cache the digest keyed by the checkout's directory mtime in the state directory.
- "Sources never shadow" may frustrate a team that wants its `go-cli` to win. The user-directory copy is the escape hatch; revisit if teams ask.
- Disabling global git config (if that's the answer to question 18) breaks private HTTPS sources. The error says only "fetch failed"; the README needs to say why.
