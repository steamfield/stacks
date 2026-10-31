# Phase 4.1a: Usage telemetry, CLI side

Status: EXECUTED 2026-10-28 (D17 decided: opt-out with these protections)
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | If the maintainers agree to collect usage (D17), the CLI records anonymous `new`, `add`, `verify`, `show` and `error` events, each field tied to the metric that reads it, tells the user before anything is sent, checks consent again before every send, honors every standard off switch, deletes what it queued when the user turns it off, and has no visible effect on any command's stdout, `--json` output, exit code or timing beyond a bounded flush |
| Traces to | "None of these are collected today. Opt-in telemetry would cover the first two." Success rows 1, 2 and 5. Assumption 5 ("Watch whether people use `new` from a terminal or ask their agent to run it"), which is D9's instrumentation. The trust job: "the user wants to start work in a project they don't have to audit first" |
| Depends on | 4.0a (`packages/format`, where the event schema lives), D17 (consent model, proposed), open question 5. Soft: [3.0](phase-3.0-add-fragments-to-repo-2026-10-30.md) (`add.ts`), [3.1a](phase-3.1a-show-and-preview-2026-10-30.md) (`show.ts`), [3.1b](phase-3.1b-create-and-authoring-guide-2026-10-30.md) (the `preset` value), [4.0d](phase-4.0d-cli-remote-origin-2026-10-30.md) (origin `index`, `--offline` and `STACKS_OFFLINE`). Each hook or field that comes from one of these is added here only if its owner has landed; otherwise the owner adds it, against this sub-phase's schema, when it lands |
| Blocks | 4.1b, which starts after this sub-phase fixes the `TelemetryEvent` schema; 4.1c-4.1e and 4.2a-4.2d through it |
| Decisions needed | D17. If declined, 4.1a to 4.1e, 4.2d and 4.2e are dropped; 4.2a and 4.2b shrink to publishing ledger results; 4.2c ships only its telemetry-free views. If opt-in, the consent table keeps every row and `enabled` additionally requires `"telemetry": true` |
| Settles | Event contents, the consumer of each field, and the never-sent list; identity; consent order and when it is checked; the spool; purge on disable and reset; the release-build seam; failure isolation; how a released schema version is frozen |

## Scope

In:

- A `Telemetry` service with non-failing entry points used by `new`, `add`, `verify` and `show`, and by the error path of `new` and `add`.
- `stacks telemetry status|enable|disable|reset|flush [--json]`.
- A `--source <web|docs|skill|cli|other>` flag on `new` and `add`: how the user came to run it (D9's instrumentation).
- A first-run notice; nothing queued on the run that shows it.
- Random install and per-project ids, stored outside the project.
- A spool with caps, a bounded flush, backoff and a debug mode.
- `TelemetryEvent` schema and its JSON Schema export in `packages/format`, with a committed snapshot of the export for each released `schemaVersion`.
- The brief's one-line rule to relay the notice.

Out:

- The ingest server (4.1b). Tests use a local recording server.
- Dependency names and versions read from the project's files. [4.2d](phase-4.2d-dependency-telemetry-client-and-ingest-2026-10-30.md) adds them to `verify` under `schemaVersion: 2`, allowlisted names only (D25, [proposed](../../requirements.md#proposed-decisions)).
- Events from `list`, `validate`, `doctor`, `runs` or `telemetry`.
- A project-local fallback when the home directory is read-only.

## Design

### Where this fits

Telemetry is five sequential sub-phases. This one defines the event schema and the client; 4.1b builds ingest against that schema (it can't start until the schema is fixed here); 4.1c adds the server's scheduled maintenance; [4.1d](phase-4.1d-telemetry-integrity-and-alerts-2026-10-30.md) keeps stored data honest and raises alerts; [4.1e](phase-4.1e-telemetry-launch-and-runbook-2026-10-30.md) is the launch procedure. The release that turns collection on ships only after 4.1e's procedure has run.

### Consent (D17, proposed)

| Option | For | Against |
|---|---|---|
| Opt-out with protections: notice first, nothing sent on the notice run, standard switches, off in CI and source builds | Enough projects to reach 4.2a's minimums; the common pattern for developer CLIs; the published schema makes it auditable | A harder trust sell for a tool that hands a repo to an agent; most runs start inside an agent, so the user may only see the notice if the agent relays it |
| Opt-in | No trust cost | Opt-in rates are usually a small fraction, so 4.2a's thresholds would likely never be met |

Recommendation: opt-out with the protections below, and only in a release whose README and schema page describe it.

Consent is resolved in this order, first match wins. `telemetry status --json` returns `{ reason, installId?, noticeShownAt?, spooled }`: `reason` from the table below, `installId` only once one exists, `noticeShownAt` from `notice.json` when the notice has been shown, and `spooled`, the number of queued events. An install id is created when the first event is queued, which is on the first enabled run after the notice run; the notice run itself creates none.

| Reason | Cause | Spool at flush |
|---|---|---|
| `flag` | `--no-telemetry` on this command | Kept |
| `offline` | `--offline` or `STACKS_OFFLINE=1` | Kept |
| `do_not_track` | `DO_NOT_TRACK` set to anything but empty, `0` or `false` | Deleted |
| `environment` | `STACKS_TELEMETRY_DISABLED`, same rule | Deleted |
| `config` | `"telemetry": false` in `config.json` | Deleted |
| `config_invalid` | `config.json` fails to decode | Kept (the user may be mid-edit), nothing sent |
| `ci` | `CI` set to any value | Deleted |
| `source_build` | `AppConfig.releaseBuild` is false | Nothing exists to delete |
| `home_not_writable` | The state directory can't be written | Nothing exists |
| `not_notified` | Enabled, but the notice hasn't been shown: this run shows it and queues nothing | Nothing exists |
| `enabled` | None of the above | Sent |

Consent is resolved twice: when an event would be queued, and again at the start of every flush. A flush that finds anything other than `enabled` sends nothing. For the per-invocation reasons (`flag`, `offline`) the spool stays, because the user turned telemetry off for one command. For the standing reasons it is deleted, so events queued before the user said no never leave later when the switch is lifted.

All env reads happen in `config.ts`. `Settings` gains `telemetry: Schema.optional(Schema.Boolean)` (roadmap, Contracts: Other shared facts, Settings fields).

### The release-build seam

`AppConfig.releaseBuild: boolean`. `bin.ts` sets it from a constant the release build defines (`scripts/build.ts` passes it through the bundler's `define` for the npm bundle only, 0.2); `bun run dev`, Vitest and any other build see `false`. The test helper (`tests/helpers/cli.ts`) can set it to `true` to exercise the enabled path. No env variable or flag can set it, so no environment can make a source build send.

### Notice

On the first run where consent would be `enabled`, the CLI writes the notice to stderr (human mode) or as an additive `notice` field in the result (JSON mode) and creates `notice.json` with an exclusive create, so two concurrent first runs can't both count as notified. That run queues nothing. The notice names what's collected, links the `/telemetry` privacy page (4.1b), which lists what is and isn't collected and links the schema, and gives the off switch in one command. The brief (1.1) gains one ground rule: "If stacks printed a telemetry notice, tell the user once, in one sentence, including how to turn it off."

### Identity

| File (under `$XDG_STATE_HOME/stacks/telemetry/`) | Holds |
|---|---|
| `install.json` | `{ installId }`, a random UUID |
| `notice.json` | When the notice was shown |
| `projects/<projectKey>.json` | `{ telemetryProjectId, scaffoldedAt, stack, fragments, steps }`; `projectKey` is the manifest's project id ([1.2b](phase-1.2b-manifest-state-and-detection-2026-10-30.md)) and `telemetryProjectId` is a separate random UUID |
| `spool/` | Queued events |
| `flush.json` | Backoff and `Retry-After` state |

The directory is created with mode `0700` and every file in it with `0600`. A project record whose `scaffoldedAt` is older than 365 days is deleted at the next flush: a verify that late counts only toward step totals, like a fresh clone.

Nothing is written into the project, and the manifest's project id appears nowhere in what's sent, so a public repo can't be linked to events. A fresh clone on another machine has no project file; its verify events carry no project link and count only toward step totals. If the state directory can't be written, nothing is sent: an id that can't be persisted would turn every verify into a new project. 4.2a shows the no-verify share so that loss is visible.

### Disable and reset

| Command | Effect |
|---|---|
| `telemetry disable` | Writes `"telemetry": false` to `config.json`; deletes `spool/`, `projects/`, `install.json` and `flush.json`. Keeps `notice.json` |
| `telemetry reset` | Deletes `spool/`, `projects/` and `flush.json`; writes a new `installId`. Consent unchanged |
| `telemetry enable` | Writes `"telemetry": true`; a new `installId` is created on the next event |
| `telemetry flush` | Runs the flush below now, with the same consent check and deadline raised to 5 s, and reports `{ sent, kept, rejected, reason }`. Useful before a machine is wiped, and for checking a server by hand (4.1e) |

`disable` and `reset` work under a detected agent and without a TTY: turning telemetry off must always be easy, and the agent relaying the notice may be the one asked to do it. `enable` follows trust model point 4 ([roadmap, Trust model](../../roadmap.md#trust-model)) and refuses with `PermissionDenied` when `AppConfig.agent` is not `"none"` or `Host.stdinIsTTY` is false, so an agent can't turn back on what the user turned off.

### Events

The `TelemetryEvent` schema lives in `packages/format/src/telemetry.ts` (`schemaVersion: 1`, see roadmap, Contracts: Schema versions, Telemetry event row), with a JSON Schema export for the schema page.

Envelope: `schemaVersion`, `eventId` (UUID, the server's idempotency key), `type`, `installId`, `projectId` (the telemetry project id, absent when unknown), `cliVersion`, `os` (`darwin`, `linux`, `other`), `nodeMajor`, `agent` (`AppConfig.agent`), `sentAt`.

| Type | Adds |
|---|---|
| `new` | `stack` (id, or `custom` for anything not from the official index or bundled set), `fragments` (same rule), `without`, `preset`, `targetAgents`, `handoff` (the manifest's `handoff.kind` from 1.4), `source` (the `--source` value, absent when not given), `origin`, `nonOfficial`, and `fingerprint` only when every entry is official |
| `add` | Same as `new` |
| `show` | `kind` (`stack`, `fragment`), `id` (or `custom`). No project id: nothing was scaffolded |
| `error` | `command` (`new`, `add`), `code`: the error tag, from a closed list of `errors.ts` tags (`ComposeConflict`, `EntryInvalid`, `TargetNotEmpty`, `NotFound`, `BadInput`, `PermissionDenied`, `Interrupted`, `Defect`; any other tag sends `other`). `stack` when it resolved to an official id. No message, no details, no project id |
| `verify` | `scope`, `outcome` (the `RunRecord` outcome from 1.3b, see roadmap, Contracts: Run record), `tamperCheck`, `steps` (each `{ name, phase, layer, status, failureKind?, duration }`; names sent only if they were in the steps recorded at scaffold time, else `custom`; duration bucketed to 5s, 30s, 2m, 10m, longer), `stepsChanged` (count), `secondsSinceScaffold`, `secondsToFirstTestPass` (from `firstTestPassAt`, when set) |

`origin` is `bundled` or `index` when every entry came from that origin, `mixed` when the official entries came from both. `nonOfficial` is `{ user, project, source }`: how many entries came from each non-official origin, counts only, never ids (the never-sent list below still holds). An event with any non-official entry still sends `stack: "custom"` for it.

The `verify` event carries no `stages` (3.5b's optional `RunRecord.stages`): `outcome` is the whole run's, so a run with a green base and a failing app stage sends `failed`.

Only `green` counts as green anywhere downstream. "Env blocked" is not sent; 4.2a derives it from the step results.

Every field names its reader. A field with no reader isn't sent; a new reader for an unsent field is a new field and a schema version.

| Field | Read by |
|---|---|
| `installId`, `projectId` | Distinct-project counting and per-install caps (4.1b, 4.2a) |
| `cliVersion` | Released-version check (4.1b); internal counts per release (4.1d) |
| `os`, `nodeMajor` | Internal failure counts by platform and Node line (4.1d `daily_metrics`), which inform the supported range (D12, D22) |
| `agent` | Per-agent green rate within a stack (4.2a, [open question 31](../../risks-and-open-questions.md#open-questions-for-the-maintainers)) |
| `stack`, `fragments`, `without` | Projects, green rate, attach and `--without` rates (4.2a; `without` read from the scaffold event's payload within the 28-day window) |
| `fingerprint` | Green rate per exact composition inside one stack (4.2a `byComposition`) |
| `preset` | Green rate per preset as a breakdown inside one stack, the `--sandbox` measure (4.2a `byPreset`) |
| `targetAgents` | Internal share of projects per target agent (4.1d), which decides which native adapters to maintain ([3.4b](phase-3.4b-native-agent-adapters-2026-10-30.md)) |
| `handoff`, `source` | Entry-point share (4.2a, D9; `source` read from the scaffold event's payload within the 28-day window) |
| `origin`, `nonOfficial` | Internal counts of index reach and non-official use (4.1d), the "people write their own" row of the success table |
| `show` events | Pick rate: scaffolds over installs that showed the stack (4.2a) |
| `error` events | The no-verify share split into "failed" and "stopped" (4.2a); spikes per code after a release (4.1d) |
| `verify` fields | Green rate, time to green, time to first test, step failure shares, env-blocked share (4.2a) |

### Freezing released schema versions

The JSON Schema export of each released `schemaVersion` is committed as `packages/format/schemas/telemetry-event.v<N>.json` when the first release that sends it is published. A test exports every version the code still defines and requires it to equal its snapshot byte for byte, so editing `TelemetryEvent` v1 after release fails the build; a change means a new version and a new snapshot. 4.1b serves the snapshots and validates against the same schemas.

Never sent: paths, directory or project names, git remotes, usernames, hostnames, environment variable values, decision answers, brief or NOTES text, file contents, command lines, output tails, custom entry ids, and anything from `--offline` runs. This list goes in the README and on the schema page, and it is a promise: a field that breaks it is a new consent question, not a code change.

### Spool and flush

Each event is one JSON file in `spool/`, written by temp file and rename. Caps: 500 files and 7 days, oldest dropped first. At the end of `new`, `add` and `verify` (for `new` and `add`, after the scaffold is written and before handoff, since a launched agent can run for hours), the CLI re-checks consent, claims up to 50 events by renaming them into a per-process directory, posts them with an 800 ms deadline, and deletes them only on a `202` whose `rejected` ids are a subset of those sent. Anything else returns them to the spool and records backoff (10 minutes, or the server's `Retry-After`). A claimed directory older than 10 minutes is returned by the next flush.

`STACKS_TELEMETRY_DEBUG=1` prints each event as JSON to stderr instead of queuing it. `STACKS_TELEMETRY_URL` points sending at another server; the default is the API host chosen under D16.

### Interfaces

```ts
// packages/cli/src/telemetry/index.ts
export class Telemetry extends Context.Service<Telemetry, {
  readonly consent: Effect.Effect<Consent>;
  readonly recordScaffold: (input: ScaffoldFacts) => Effect.Effect<void>; // never fails
  readonly recordVerify: (record: RunRecord) => Effect.Effect<void>;      // never fails
  readonly recordShow: (entry: ShowFacts) => Effect.Effect<void>;        // never fails
  readonly recordError: (input: ErrorFacts) => Effect.Effect<void>;      // never fails; called by new and add before the error is rendered
  readonly flush: Effect.Effect<void>;                                    // never fails, bounded, re-checks consent
}>()("stacks/Telemetry") {
  static layer: Layer.Layer<Telemetry, never, FileSystem.FileSystem | Path.Path | HttpClient.HttpClient | AppConfig>;
}
```

Every method is wrapped in `Effect.catchCause` at this boundary and logs only at debug level. This is the one documented place where an error is deliberately swallowed, because a telemetry failure is never the user's problem; the file says so at the top. Defects inside it are still logged as class and stack frames per `AGENTS.md`.

### Failure isolation

| Fault | Visible effect |
|---|---|
| Server down, slow, 4xx or 5xx | None beyond at most 800 ms once per backoff window |
| Spool unwritable | None; event dropped |
| Bug inside event building | None; logged at debug |
| Interrupt during verify | The partial verify event is spooled before teardown; flushed only if time allows |

Telemetry never writes to stdout, never changes an exit code, and never adds warnings to `--json` output. The one additive JSON field is `notice` on the notice run.

## Files and areas touched

| Path | Change |
|---|---|
| `packages/format/src/telemetry.ts` | `TelemetryEvent` and its JSON Schema export (additive) |
| `packages/format/schemas/telemetry-event.v1.json`, `packages/format/tests/telemetry-schema.test.ts` | Frozen snapshot and the equality test |
| `packages/cli/src/telemetry/` | `index.ts`, `consent.ts`, `ids.ts`, `events.ts`, `spool.ts`, `client.ts` |
| `packages/cli/src/commands/telemetry.ts` | `status`, `enable`, `disable`, `reset`, `flush` |
| `packages/cli/src/commands/new.ts`, `add.ts`, `verify.ts`, `show.ts` | Hook points; `--source` on `new` and `add` |
| `packages/cli/src/config.ts`, `src/schemas/config.ts` | Switches, `releaseBuild`, `telemetry` setting |
| `packages/cli/src/bin.ts`, `scripts/build.ts` | Release-build constant |
| `packages/cli/tests/helpers/cli.ts` | `releaseBuild` override |
| `packages/cli/src/core/brief/` | Notice-relay rule |
| `packages/cli/README.md` | What's sent, what's never sent, how to turn it off |

## Acceptance tests

Against a real local HTTP server that records requests and can hang, return 500 or reject ids. Enabled-path tests set `releaseBuild: true` through the test helper.

1. Consent table: one test per row; `telemetry status --json` reports the expected reason.
2. Without the helper override, every command sends nothing and creates no telemetry files (the `source_build` row), even with every env switch cleared.
3. First enabled run prints the notice and the server receives nothing; `telemetry status --json` then reports `reason: "enabled"`, `noticeShownAt` set, no `installId` and `spooled: 0`. The second run creates the install id and its flush delivers its events; `status` then reports that `installId`.
4. Queue an event, then set `DO_NOT_TRACK=1` and run a command: no request, spool empty. Same with `"telemetry": false`. With `--no-telemetry` instead: no request, spool kept, next normal run sends it.
5. `telemetry disable` deletes spool, project files and `install.json`; `telemetry reset` changes `installId` and empties the spool. `telemetry enable` with an agent marker set exits 6 (`PermissionDenied`); `disable` under the same marker succeeds.
6. With the server hanging, `new --json` stdout and exit code are byte-identical to a disabled run, finishing within 1 second of it.
7. A spool write that fails (`spool/` is a file, after the notice run): every command's output and exit code unchanged.
8. No serialized event contains the project directory name, the manifest project id or any custom entry id (property test over random names and ids).
9. A step added by hand is sent as `custom`.
10. `show go-cli` queues one `show` event with no project id; `new` failing `TargetNotEmpty` queues one `error` event with `code: "TargetNotEmpty"` and no message; a tag outside the closed list is sent as `other`.
11. `new` with one bundled and one user-directory fragment sends `origin: "bundled"`, `nonOfficial: { user: 1, project: 0, source: 0 }` and `fragments` containing `custom`, and the serialized event contains no user entry id.
12. `new --source skill` sends `source: "skill"`; without the flag the field is absent; `--source other-thing` is `BadInput`.
13. No serialized event has a `yes` or `existingRepo` field; every field in the schema appears in the field-consumer table (a test reads the table's field list from a constant shared with the docs).
14. `telemetry flush --json` with three queued events and a recording server: `sent: 3`, spool empty; with `DO_NOT_TRACK=1`: `sent: 0`, `reason: "do_not_track"`, spool deleted.
15. The telemetry directory is `0700` and every file `0600` after a run; a project record with `scaffoldedAt` 366 days old is gone after the next flush, one 364 days old stays.
16. The schema snapshot test fails when a field is added to `TelemetryEvent` v1 (a fixture edit in the test), and passes on the committed snapshot.
17. The notice text contains the `/telemetry` URL.
18. Spool caps: 600 queued become 500, oldest gone; events older than 7 days dropped.
19. Two processes flushing at once never send the same `eventId` twice.

### Realistic edge cases

20. A read-only home/state directory sends nothing, keeps command output unchanged and never writes a project-local fallback.
21. A corrupt `install.json` never sends under an unpersisted identity and leaves command output unchanged.
22. A corrupt spool file is discarded without blocking delivery of valid queued events.
23. A full/unwritable spool directory drops the new event without changing command output or exit status.
24. A 202 response naming an event id not sent keeps the entire batch and records backoff; valid rejected ids are removed and counted.
25. 429 and 503 honor `Retry-After` (seconds and HTTP date), keeping events and preventing a premature retry.
26. An interrupted flush preserves every claimed event; stale claims are recovered by a later flush without lost ids.
27. A symlinked state path and a project path containing spaces and non-ASCII characters keep telemetry outside the project.
28. Consent is checked again at flush after an event was queued, including every standing off switch and transient offline switches.
29. Debug mode emits only schema-valid events on stderr, without queuing or sending them, and still honors consent.
30. A fresh clone has no telemetry project link; known verifies use the separate telemetry id, bucket durations and report the whole run outcome.

## Exit criteria

- D17 decided. Acceptance tests pass; `bun run check` green from the repo root.
- The `TelemetryEvent` schema is fixed and 4.1b can start.
- The README section and schema page text exist; no release collects before [4.1e](phase-4.1e-telemetry-launch-and-runbook-2026-10-30.md)'s launch procedure has run and that text is published.

## What this plan may get wrong

- 2026-10-28 (scope follow-up): the `mobile-expo` + `rr` compositions now use 5,999 words (default) and 6,000 words (sandbox) of the 6,000-word budget. The next fixed brief sentence needs a budget decision rather than more shortening. The orchestrator corrected the two locked test setups and approved the README, release/Host wiring, canonical snapshot and help-table updates; the implementer leaves the locked tests unchanged.

- 2026-10-28 (review): consent must re-read raw file settings after long commands; the normal invocation cache is too stale. Consent updates also preserve raw settings so temporary environment path overrides are not saved. Standing opt-outs purge pending data even on commands that do not flush.
- 2026-10-28 (review): the flush budget covers maintenance and claim work as well as HTTP. Project expiry advances in batches of 50, with a cursor in `flush.json`; backoff skips maintenance. An expired project outside that batch is removed on a later eligible flush, while verify refuses expired links immediately. Staging directories are excluded from event/project scans.
- 2026-10-28 (review): abandoned pending or malformed notices need recovery. Claims carry an ownership token, recover after ten minutes, and finalizers settle only their own token. Explicit reset reports `reset: false` if cleanup or identity rotation fails; disable still saves the opt-out and reports `cleared: false` when old state could not be removed.
- 2026-10-28 (review): scaffold events must wait for the human harness picker, then queue and flush before launch. An `add` event also needs a newly computed complete-composition fingerprint; the existing manifest retains the original scaffold fingerprint, which is stale after additions.

- 2026-10-28 (implementation): the required ground rule changes canonical brief fixtures and initially made two `mobile-expo` + `rr` compositions exceed the 6,000-word budget by 8–9 words. Shortening two fixed ground rules by nine words preserves their meaning and fits the budget without changing registry content. The contract freezes the canonical snapshots and the help test's exhaustive exit table; their updates need the orchestrator/test author.
- 2026-10-28 (implementation): locked item 7's `add` and `verify` setups send a scaffold event before their final zero-request assertion, contrary to item 3; the request assertion must measure requests after setup. The malformed-config item 28 writes a file without creating its parent directory. Both tests were corrected in review (setup requests are cleared; the directory is created).
- 2026-10-28 (review): the notice's privacy link is `/telemetry` on the host that receives the events, built from the configured endpoint, because no site domain exists yet; item 17 checks for that URL instead of any `https` link.
- 2026-10-28 (landing): `stacks search` arrived on main after this plan; it carries the notice like every other command, and its result schema gained the optional `notice` field.
- 2026-10-28 (implementation): a JSON notice cannot count as shown until stdout accepts its result. `notice.json` is claimed exclusively with a pending marker and settled after output; failed first commands remove their pending notice, and concurrent invocations queue nothing while delivery is pending.
- 2026-10-28 (implementation): custom `STACKS_REGISTRY_DIR` and unsigned index origins use the existing `bundled`/`index` origin labels but are untrusted. They must be redacted and counted under `nonOfficial.source`; origin labels alone do not prove official identity. Verify's name allowlist extends from actual official composition steps, never from an edited manifest during `add`.

- 2026-10-28 (tests written): the first draft gave `Telemetry` a `recording()` layer for tests. That would stub this repo's own service (rules/cli/testing.md), so item 7 fails the real spool write instead, and the service has only `layer`.
- 2026-10-28: no API host exists yet, so there is no default telemetry URL, as 4.0d has no default index URL. `Telemetry.layer` takes `officialUrl`, which `bin.ts` leaves undefined until a host exists; `STACKS_TELEMETRY_URL` (read in `config.ts`) overrides it. With neither, consent is `no_endpoint`, placed after `source_build`: nothing is queued and nothing exists to delete. The enabled-path tests set `STACKS_TELEMETRY_URL` to their recording server. `TelemetryEvent` v1 has landed in `packages/format` (`TelemetryBatch` is the POST body, `TelemetryAccepted` the 202 body); `origin` is absent when no entry is official, and the sender posts to `<url>/v1/events` (roadmap "API route map").
- Losing every run from a read-only home may lose most agent-sandboxed runs, which skew toward failures. If the no-verify share is high, revisit a project-local queue.
- `handoff` alone may not separate "the user asked their agent" from "the user ran `new` in a terminal inside an agent session". `agent` plus `handoff` is the cheap signal.
- Deleting the spool on `CI` means a developer who exports `CI=1` in their shell loses queued events. That errs the right way.
