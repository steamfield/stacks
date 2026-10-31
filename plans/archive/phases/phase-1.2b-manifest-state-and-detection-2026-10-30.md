# Phase 1.2b: `new`: manifest, state record and agent detection

Status: EXECUTED 2026-10-26; batch-reviewed, fixed, merged to main (PR #4)

Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | `new` writes `.stacks/manifest.json` with its step digest and the out-of-project state record that holds the second digest copy, and the CLI detects the agent that called it, so verify, tamper detection and handoff have what they read |
| Traces to | "That is why `verify` exists, why the brief refuses to let the agent weaken a step" (Jobs, the trust paragraph); job 5, "a target I can verify against"; the agent user, who "runs `new`, reads the brief, builds, and loops on `verify`" |
| Depends on | [1.2a](phase-1.2a-new-scaffold-and-templates-2026-10-30.md) (the `new` command, the safe writer and its write order and rollback, `NewResult`), [1.1](phase-1.1-composition-and-brief-2026-10-30.md) (`Composition`, the commands map, `targetAgents`), [0.3b](phase-0.3b-processes-and-signals-2026-10-30.md) (`config.ts::childEnv`, which strips the markers this file defines) |
| Blocks | [1.3a](phase-1.3a-verify-runner-and-probes-2026-10-30.md) (reads the manifest and the marker list), [1.3b](phase-1.3b-tamper-detection-and-run-records-2026-10-30.md) (digest and state record), [1.4](phase-1.4-handoff-and-entry-points-2026-10-30.md) (detection, the manifest's `handoff` field), [3.0](phase-3.0-add-fragments-to-repo-2026-10-30.md) (reuses the manifest and digest) |
| Decisions needed | D14 shapes how the digest is used, not what is written: the manifest digest and state record are written here whichever way D14 goes, so 1.2b does not block on it. D19: the manifest records `trusted` per entry. Open question 9 (detection can be evaded) changes nothing here; it is about how much 1.3b relies on it |
| Settles | Manifest format and location, with the optional fields later sub-phases fill; the step digest's canonical form; the state record; the agent marker list; `TargetNotEmpty`'s `scaffold` detail |

## Scope

In:

- `Manifest`, `ManifestStep`, `EntryRef`, `digestSteps` and `ProjectState` (roadmap,
  Types and schemas), written in 1.2a's write order.
- `--sandbox` marking `prod` steps `skipByDefault` in the manifest.
- Agent detection: `AppConfig.agent: DetectedAgent` and `config.ts::AgentMarkers`
  (roadmap, Types and schemas: Agent detection and TTY), and the marker list `childEnv`
  strips.
- `TargetNotEmpty`'s `details.scaffold` for a target that already holds a manifest.
- `stateRecord` in `NewResult`.

Out:

- The TTY fields `Host.stdinIsTTY` and `Host.stdoutIsTTY` (0.3a owns them; 1.3b and 1.4
  read them).
- Reading the state record back, the tamper check and `--accept-changes` (1.3b).
- Filling `handoff` (1.4) or `fingerprint` (2.0a). `add`'s `mode` and `stack: null`
  (3.0); the manifest declares them now so 3.0 needs no version bump.

## Design

### Manifest

`Manifest`, `ManifestStep` and `EntryRef` are the roadmap contract (Types and schemas:
Manifest), owned here, and the manifest's `schemaVersion` rule is the Schema versions
table's Manifest row. JSON, decoded with Schema on every read, excess properties
rejected.

```ts
// src/schemas/manifest.ts
const EntryRef = Schema.Struct({
  id: Schema.String,
  origin: Schema.NonEmptyString,       // an Origin; see "Readers" below
  trusted: Schema.Boolean,
})

const ManifestStep = Schema.Struct({
  ...VerifyStep.fields,                // 1.0, with withStepDefaults applied: name, run, cwd?,
                                       // phase, tags (with the CLI's "app" tag on an app's
                                       // steps), expect?: { http, within }, layer?, timeout
  owner: Schema.String,
  skipByDefault: Schema.Boolean,       // true for prod steps under --sandbox
})

const Manifest = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  projectId: Schema.String,            // random UUID from Effect's Random
  createdAt: Schema.String,            // ISO, from Clock
  cli: Schema.String,                  // stacks version that wrote it
  mode: Schema.Literals(["new", "add"]), // 1.2b writes "new"; 3.0 writes "add"
  preset: Schema.Literals(["default", "sandbox"]),
  agents: Schema.Array(AgentId),
  stack: Schema.NullOr(EntryRef),      // new always writes one; 3.0 may write null
  fragments: Schema.Array(EntryRef),
  env: Schema.Record(Schema.String, Schema.String),
  commands: Schema.Record(Schema.String, Schema.String),
  verify: Schema.Array(ManifestStep),
  verifyDigest: Schema.String,         // "sha256:<hex>" from digestSteps
  briefWords: Schema.Number,
  handoff: Schema.optional(Schema.Struct({ // filled by 1.4
    kind: Schema.Literals(["inside-agent", "launch", "print"]),
    agent: Schema.optional(Schema.Union([AgentId, Schema.Literal("other")])), // DetectedAgent without "none"
    at: Schema.String,
  })),
  fingerprint: Schema.optional(Schema.String), // "sha256:<hex>", filled by 2.0a
})
```

JSON rather than YAML because the CLI writes it and agents and tools read it: JSON has
one canonical form to hash, Schema decodes it directly, and it needs no second
dependency beyond the `yaml` reader 1.0 adds for frontmatter.

#### Readers and later fields

- `handoff` and `fingerprint` are declared optional now, so 1.4 and 2.0a fill them under
  `schemaVersion: 1` and every CLI from 1.2b on decodes a manifest that has them. 1.2b
  writes neither. Neither is part of the digest.
- `mode: "add"` and `stack: null` are in the schema from the start for the same reason;
  a 1.x `verify` reads a manifest that 3.0 wrote.
- `EntryRef.origin` is decoded as a non-empty string, not the `Origin` literal set.
  Decided here: 3.2a and 4.0d add `"source"` and `"index"`, and a manifest written by a
  newer CLI must stay readable by an older `verify`, which only needs the steps. Code
  that needs the literal (1.4's trust check) narrows it and treats an unknown value as
  untrusted.
- Any other new field is excess and fails decode; the Schema versions rule says such a
  field bumps `schemaVersion`. A manifest with `schemaVersion` above 1 fails
  `InvalidConfig` with `details: { path, schemaVersion }` and the fixed "upgrade
  stacks" message, from one function, `core/manifest.ts::readManifest`, which 1.3a,
  1.3b, 1.4 and 3.0 call.

### Step digest

`src/core/manifest.ts::digestSteps` is the roadmap contract (Types and schemas: Step
digest). What it covers is [Trust model](../../roadmap.md#trust-model), point 5: every
field verify reads from each step, with defaults applied and keys sorted, plus the
manifest's `env` and `preset`, excluding `owner`. Its input is
`{ verify, env, preset }`, not the whole manifest, so a later optional field can't change
the digest by accident. Output is `"sha256:" + hex` over the canonical JSON (keys sorted
at every level, arrays in order). Step order is part of the input, because verify runs
steps in order.

Acceptance test 3 lists the step fields one by one, so a field added to `VerifyStep`
without a matching digest test fails review rather than slipping through. `expect` is
digested as the whole nested object, so a changed probe URL or `within` changes the
digest, and the `app` tag is digested with the other tags, so an agent can't move an app
step into the base stage unnoticed. An app project needs no manifest version 2: the
stage of a step is its `app` tag (3.5b).

### Project state record

`src/core/project-state.ts::ProjectState` is the roadmap contract (Types and schemas:
Project state record), with `schemaVersion: 1` per the Schema versions table. 1.2b writes
it at `$XDG_STATE_HOME/stacks/projects/<projectId>.json`:

```ts
const ProjectState = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  projectId: Schema.String,
  manifestPath: Schema.String,         // real path of .stacks/manifest.json
  verifyDigest: Schema.String,        // whole set, same value as the manifest's
  stepDigests: Schema.Record(Schema.String, Schema.String), // step name -> digest of that step
  settingsDigest: Schema.String,      // env + preset
  createdAt: Schema.String,
  firstGreenAt: Schema.NullOr(Schema.String),     // 1.3b fills
  firstTestPassAt: Schema.NullOr(Schema.String),  // 1.3b fills
})
```

`stepDigests` and `settingsDigest` come from the same `digestSteps` module
(`digestStep`, `digestSettings`, same canonical JSON and defaults), so 1.3b's
`VerifyChanged` can say which steps were removed, added or edited, and whether `env` or
`preset` changed, instead of only "something changed". The whole-set `verifyDigest`
stays the pass/fail test; the per-part digests only explain a failure.

`manifestPath` is the real path (`FileSystem.realPath` after the manifest is written), so
1.3b's lookup by path (Trust model, point 5: no record for the project id, then by path)
matches however the project was reached. This is the second copy D14 compares against; an
agent that edits both the manifest steps and `verifyDigest` leaves this one unchanged.

`config.ts::Paths` gains `state` (`STACKS_STATE_DIR` when set, else
`XDG_STATE_HOME`, default `~/.local/state`, plus `SLUG`); `bun run dev` points it at
`packages/cli/.dev/state`, as it does data at `.dev/data`. If the state directory isn't writable (some agent sandboxes allow writes only in
the project), `new` still succeeds and reports `stateRecord: false`; 1.3b then reports
the tamper check as manifest-only, which never passes the gate (D20). The state record is
written after `.stacks/` and before `git init` (1.2a's write order), and 1.2a's
rollback removes it when a later step fails.

### An existing scaffold

A target that already holds `.stacks/manifest.json` fails `TargetNotEmpty` (1.2a)
with `details.scaffold`: `"unfinished"` when the state record for that manifest's
`projectId` has no `firstGreenAt` (or there is no record), `"green"` otherwise. Human mode
adds a hint: for `unfinished`, "an earlier `new` wrote this; continue with
`.stacks/BRIEF.md`, or remove the directory to start again"; for `green`, "this is a
finished project; use `add` (3.0) to extend it". The roadmap's Error tags row for
`TargetNotEmpty` names this detail.

### Agent detection

Owned here (roadmap, Types and schemas: Agent detection and TTY), because 1.3a, 1.3b, 1.4
and 3.0 all need it and 1.2b is the first sub-phase they all depend on. 1.2b itself only
defines and tests it; 1.4 uses it for handoff and 1.3b for `--accept-changes`
([Trust model](../../roadmap.md#trust-model), point 4).

`config.ts::AgentMarkers` is one schema-checked constant. Each marker has an optional
`confirmed` date, set only once someone has checked it against the agent's docs; none
has been yet (open item below):

| Agent | Markers (any one set and non-empty) |
|---|---|
| `claude` | `CLAUDECODE`, `CLAUDE_CODE` |
| `codex` | `CODEX_SANDBOX`, `CODEX_CI`, `CODEX_THREAD_ID` |
| `opencode` | `OPENCODE`, `OPENCODE_CLIENT` |
| `cursor` | `CURSOR_AGENT`, or `CURSOR_EXTENSION_HOST_ROLE=agent-exec` |
| from `AI_AGENT` | The cross-agent convention; its value is matched by prefix against the ids above (`claude...` is `claude`), and any other non-empty value is `"other"` |

Cursor's trace id variable is not a marker because its integrated terminal sets it for
people too.

`AppConfig.agent` is a lazily read `Effect<DetectedAgent>`, where
`src/schemas/entry.ts::DetectedAgent` is `AgentId | "other" | "none"` (the roadmap
contract type, defined next to `AgentId`). It is checked in the table's order and read
only in `config.ts`. `"other"` is a generic marker such as `AI_AGENT` naming no known
agent, and it counts as detected: Trust model point 4's test is `agent !== "none"`, so
an unrecognized agent can't confirm anything. Every place that records or decides on the
detected agent (1.3b's `RunRecord.agent`, 1.4's `HandoffDecision`, 4.0c's
`LastRun.agent`) uses `DetectedAgent`, so `"other"` always encodes.

Detection never changes the target agents: `targetAgents` (1.1) reads `--agents`, then
`Settings.agents`, then `claude` (open question 28). Acceptance test 9 checks that end to
end.

The same constant gives `childEnv` (0.3b) the full list of marker names to strip from
verify steps' environment, including `AI_AGENT`.

### Settled here

| Question | Answer | Why |
|---|---|---|
| Manifest format | JSON at `.stacks/manifest.json` | Canonical hashing, direct Schema decode, one fewer dependency |
| Later manifest fields | `handoff`, `fingerprint`, `mode: "add"`, `stack: null` declared now | Filling them later needs no version bump |
| `EntryRef.origin` in the manifest | Non-empty string | Older readers survive new origins |
| Second digest copy | Under `XDG_STATE_HOME`, keyed by project id, with the manifest's real path | Outside the project, so editing project files can't hide a changed step |
| Unknown `AI_AGENT` value | `"other"`, a detected agent | An agent nobody listed must not be able to confirm anything |

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/src/core/manifest.ts` | `readManifest`, `writeManifest`, `digestSteps`, `digestStep`, `digestSettings` |
| `packages/cli/src/core/project-state.ts` | `ProjectState` read and write |
| `packages/cli/src/core/scaffold/target.ts` | The unfinished-scaffold check (`details.scaffold`) |
| `packages/cli/src/schemas/manifest.ts` | `Manifest`, `ManifestStep`, `EntryRef` |
| `packages/cli/src/schemas/entry.ts` | `DetectedAgent` next to `AgentId` |
| `packages/cli/src/schemas/new.ts` | `NewResult.stateRecord` filled |
| `packages/cli/src/commands/new.ts` | Writes the manifest and the state record in 1.2a's order |
| `packages/cli/src/config.ts` | `Paths.state`, `AgentMarkers`, `AppConfig.agent` |
| `packages/cli/tests/manifest.test.ts`, `tests/agent-detection.test.ts`, `tests/new-manifest.test.ts` | New |

## Acceptance tests

Through `runCli` with temp HOME, XDG dirs and a temp `cwd`.

1. `new fixture-stack app --sandbox --json` writes `.stacks/manifest.json` that
   decodes, with `briefWords` equal to the result's, and `stateRecord: true`.
2. The manifest's `verifyDigest` equals `digestSteps(manifest)`, and the state record
   holds the same digest, the project id, `schemaVersion: 1` and `manifestPath` equal to
   the real path of the manifest (on macOS, under `/private/var`).
3. Digest coverage, one case per field: changing any of `name`, `phase`, `layer`, `run`,
   `cwd`, `tags` (including removing the `app` tag from an app's step), `expect.http`,
   `expect.within`, `timeout`, `skipByDefault`, an `env` value or `preset` changes the
   digest; reordering keys, changing `owner`, or adding `handoff` or `fingerprint`
   doesn't; writing a default explicitly (`timeout: "10m"`, `tags: []`,
   `within: "60s"`) doesn't.
4. Forward reads: a manifest with `handoff`, `fingerprint`, `mode: "add"`,
   `stack: null` and an `origin: "source"` decodes; one with an unknown top-level key
   fails; one with `schemaVersion: 2` fails `InvalidConfig` with
   `details.schemaVersion: 2`.
5. With `XDG_STATE_HOME` unwritable, `new` succeeds with `stateRecord: false`.
6. A failure injected after the state record was written (a later file made unwritable,
   or `git init` hanging past an injected interrupt) removes the state record along with
   1.2a's files.
7. `--sandbox` marks `prod` steps `skipByDefault`; without it they aren't.
8. Detection: for each row of `AgentMarkers`, `runCli` with that marker in `env` gives
   that `AppConfig.agent`; `AI_AGENT=claude-code` gives `claude`, `AI_AGENT=foo` gives
   `"other"`, no markers gives `"none"`. A property test (`@effect/vitest`): any env
   containing a marker gives a value other than `"none"`.
9. Detection doesn't change target agents: with `CODEX_THREAD_ID` set and no `--agents`
   flag or `Settings.agents`, `AppConfig.agent` is `codex` and the manifest's `agents` is
   still `["claude"]`, with only `adapters/claude/` files written.
10. The state record's `stepDigests` has one entry per step name; editing one step changes
    only that entry (and `verifyDigest`); changing an `env` value changes only
    `settingsDigest` (and `verifyDigest`).
11. A target with `.stacks/manifest.json` and no green state record fails
    `TargetNotEmpty` with `details.scaffold: "unfinished"`; after a state record with
    `firstGreenAt` set, `"green"`.

## Exit criteria

- Tests pass; `bun run check` green from the repo root.
- `AGENTS.md` documents the manifest, the state record and agent detection in its
  architecture map.
- What was built matches the roadmap contracts this file owns (Manifest, Step digest,
  Project state record, Agent detection, the marker list for Child environment).

## What this plan may get wrong

- `XDG_STATE_HOME` may not be writable in exactly the sandboxes where tamper detection
  matters most. If 1.6b's gate runs show `stateRecord: false` often, D14's second copy is
  weaker than it looks and D14's row should say so.
- Agent markers change without notice; checking them against each agent's docs and
  recording `confirmed` is the only defense. An agent whose shell tool sets no marker is `"none"` (open question 9).
- 2026-10-26: the step fields this plan first digested included `check` and `probe`.
  The amended D18 replaced them with `expect` and dropped built-in checks; the digest
  covers whatever `VerifyStep` has, so only test 3's field list changed. The same change
  retired the planned manifest version 2 for app projects.
- Writing `briefWords` into the manifest duplicates the result's value; if nothing reads
  it from the manifest by 2.0c, drop it under a version bump rather than keep a field
  without a reader.
- 2026-10-26, from executing the core (everything that doesn't need `new`), on
  feat/phase-1b in parallel with 1.2a:
  - **What shipped.** `schemas/manifest.ts` (`Manifest`, `ManifestStep`, `EntryRef`);
    `core/manifest.ts` (`buildManifest`, `encodeManifest`, `readManifest`,
    `writeManifest`, `digestSteps`, `digestStep`, `digestSettings`, `canonicalJson`,
    `MANIFEST_PATH`); `core/project-state.ts` (`ProjectState`, `projectStateFor`,
    `writeProjectState`, `removeProjectState`, `readProjectState`, `projectStatePath`);
    `config.ts` (`Paths.state`, `AgentMarkers`, `detectAgent`, `AppConfig.agent`,
    `AGENT_MARKER_NAMES`). `DetectedAgent` already existed in `schemas/entry.ts` from 1.0.
  - **What remains for the wiring step, after 1.2a merges.** In `commands/new.ts`: call
    `buildManifest(composition, { briefWords })`, write `encodeManifest(manifest)` to
    `MANIFEST_PATH` through 1.2a's safe writer (so its rollback tracks the file), then
    `writeProjectState(manifest, <manifest path>)` before `git init`, register
    `removeProjectState(write)` in the rollback finalizer, and set
    `NewResult.stateRecord` to `write.written`. In `core/scaffold/target.ts`: when the
    target holds `MANIFEST_PATH`, read it with `readManifest`, look the record up with
    `readProjectState(manifest.projectId)`, and add `details.scaffold` (`green` when
    `firstGreenAt` is set, else `unfinished`, also when the manifest doesn't decode) to
    `TargetNotEmpty`, with the human hints above. Acceptance tests 1, 2 (end to end), 5
    and 6 (through `new`), 7 (through `new`) and 11 belong to that step; the core of 2, 3,
    4, 5, 7, 8, 9 and 10 is tested now in `tests/manifest.test.ts`,
    `tests/project-state.test.ts` and `tests/agent-detection.test.ts`.
  - **`InvalidConfig` gained details.** The tag had none. It now has the closed
    `{ path, schemaVersion? }`; a manifest that isn't JSON or doesn't decode carries the
    path, and one with `schemaVersion` above 1 carries the version too, checked before the
    decode so a newer manifest with new keys still reports its version. The fixed "upgrade
    stacks" text is a human detail line, since a tag's message is fixed. A missing
    manifest is `NotFound` with no details (1.3a sets `looked`, the string 1.5 added, to the
    directory its walk started from) and an unreadable one is
    `PermissionDenied` `read`.
  - **`ManifestStep` keeps `VerifyStep`'s optional fields.** It spreads
    `VerifyStep.fields` without `VerifyStep`'s check (which refuses the CLI's `app` tag),
    and keeps only the serve-needs-expect rule. `buildManifest` writes resolved steps, but
    a hand-edited step that drops a default still decodes, and the digest applies
    `withStepDefaults` so it matches.
  - **`owner` is the entry id.** 1.1's owners are `{ kind, id }` because a stack and a
    fragment may share an id; the manifest keeps the plan's string. `owner` is outside the
    digest and only explains a step, so the ambiguity is cosmetic.
  - **`projectId` is restricted** to letters, digits and `-`. It names the state record
    file, so an edited manifest with `../` in it can't point 1.3b's lookup elsewhere.
  - **The state record is written without following links.** It goes to a fresh
    temporary file opened with exclusive create and is renamed over
    `<projectId>.json`, which replaces a planted link instead of writing through it.
    `manifestPath` is `FileSystem.realPath` of the manifest the caller just wrote; if that
    fails the write is `PermissionDenied` `read`. Any filesystem failure under the state
    directory is `{ written: false }` with one warning log line, not an error.
  - **Project id.** Effect 4.0.6's `Random` has no UUID function, so `buildManifest`
    builds a version 4 UUID from 16 `Random` bytes; a seeded `Random` gives a fixed id.
  - **Scaffold facts.** `buildManifest` takes only the composition (which carries the
    preset and agents) and `briefWords`. The project name and template variables have no
    manifest field in this plan's schema, so they aren't passed.
  - **Marker confirmation dates** were first all set to 2026-10-26, the date this
    plan's table was written, without checking any agent's documentation. Review
    removed them: `confirmed` is now optional and unset on every marker.
  - **`childEnv` is unchanged.** It already takes a `remove` list; 1.3a passes
    `AGENT_MARKER_NAMES` when it builds a verify step's environment. Git commands from
    `new` don't strip them.
- 2026-10-26, from wiring the core into `new` on feat/phase-1:
  - **The manifest is in `NewResult.written`** (and so in the brief's list of files
    written), like every other file `new` writes. The `new` tests' expected file lists
    gained it on purpose.
  - **The manifest is built once, before the first write**, from the brief's first count.
    When `git init` fails and 1.2a re-renders the brief, the manifest is replaced through
    the safe writer with the new `briefWords`; its id and digest stay, so the state record
    written before git still matches it.
  - **The state record's rollback is `Effect.acquireRelease`**, not a hook into the
    writer: the record is outside the project, so the writer doesn't track it. Acquiring
    is uninterruptible, so a record that was written always has its release.
  - **`details.scaffold` is computed only when the target's entries include
    `.stacks`.** A missing manifest (including a `.stacks/` without one) gives
    no `scaffold` key; one that can't be read or decoded, or a newer `schemaVersion`, is
    `unfinished`. The record is looked up by project id only, not by `manifestPath`.
  - **The `green` hint doesn't tell the user to run `add`**, which doesn't exist until
    3.0. It reads "This is a finished project." and "Next: pick another directory for a
    new project; `add` will extend this one once it ships." 3.0 should point it at the real
    command. Both hints end with a `Next:` line, replacing the generic one.
  - **Test file**: the `new` acceptance tests are in `tests/new-manifest.test.ts`
    (tests 1, 2, 5, 6, 7, 11, and 9 through `new`), plus a test that the rewritten
    brief's count reaches the manifest. `tests/new.test.ts`'s SIGINT test on a real
    process now also checks the state record is removed. Test 6 uses the interrupt during
    `git init`, the only step after the state record; there is no later file write to make
    unwritable.
  - **Manual run** with the realistic fixture registry in sandbox mode: ten files
    written (the manifest included), a fresh repository, `stateRecord: true`, the record
    under `$XDG_STATE_HOME/stacks/projects/` with the manifest's real path, and a
    rerun into the same directory gave `TargetNotEmpty` with `scaffold: "unfinished"`
    and the hint.
- 2026-10-26, from the code review of `new` on feat/phase-1:
  - **Open item for 1.3b: every agent marker is unverified.** No row of
    `AgentMarkers` has been checked against its agent's documentation, so none has a
    `confirmed` date. `CLAUDE_CODE`, `CODEX_CI` and `CODEX_THREAD_ID` may not exist at
    all; `CLAUDECODE`, `CODEX_SANDBOX`, `OPENCODE`, `OPENCODE_CLIENT`, `CURSOR_AGENT`,
    `CURSOR_EXTENSION_HOST_ROLE=agent-exec` and `AI_AGENT` need checking too. Before
    1.3b makes `--accept-changes` depend on detection, check each one, drop those that
    don't exist and set `confirmed` on the rest.
  - **`STACKS_STATE_DIR`** replaces the whole state directory (no `stacks/`
    appended), matching `STACKS_DATA_DIR`. `bun run dev new` used to write its
    records into the developer's real `~/.local/state`.
  - **`projectStatePath` checks the id itself.** `ProjectId` is exported from
    `schemas/manifest.ts` and `projectStatePath` returns no path for an id it refuses, so
    `readProjectState` gives no record and `writeProjectState` gives `{ written: false }`
    whatever string a caller passes, not only for a decoded manifest.
  - **Human mode says when the record wasn't written**: "State record: not written (the
    state directory isn't writable), so verify's tamper check will use the manifest
    only." JSON callers already had `stateRecord: false`.
