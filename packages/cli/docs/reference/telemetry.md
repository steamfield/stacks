# Telemetry

Published releases send anonymous usage to `https://stacks.steamfield.io`; the [privacy page](https://stacks.steamfield.io/telemetry) explains the policy. Source builds never collect, even if a URL is configured, and local packs have no official endpoint. A release build with an endpoint uses opt-out consent: the first enabled invocation shows a notice and queues nothing. That first notice describes dependency reporting and records notice version 2 once delivered. Users who saw the earlier notice see a second notice on their next enabled run, which also queues nothing. It creates an install id only when a later invocation records an event.

Turn it off with `stacks telemetry disable`. This works in scripts and under agents. It saves `"telemetry": false` and removes pending events, deferred scaffolds, install identity, project links and backoff, retaining the notice. `telemetry enable` requires a person with terminal stdin. `telemetry reset` rotates the identity and clears pending events, deferred scaffolds and project links without changing consent. `telemetry status --json` reports the consent reason, notice time, persisted identity when present and queued event count. `telemetry flush --json` attempts one batch with a five-second deadline; `stacks schema telemetry` describes all telemetry command results.

Every command accepts `--no-telemetry` to skip one invocation while retaining queued events. `--offline` and `STACKS_OFFLINE=1` also retain them without recording or sending anything. Set `DO_NOT_TRACK` or `STACKS_TELEMETRY_DISABLED` to any value except empty, `0` or `false` to disable collection; any set `CI` disables it too. Standing opt-outs delete pending events at flush. Invalid settings preserve pending events without sending them. `STACKS_TELEMETRY_DEBUG=1` prints validated events to stderr instead of queuing or sending, subject to the same consent checks. `STACKS_TELEMETRY_URL` overrides the endpoint for development; the sender posts its own batch to `<url>/v1/events` and executes nothing it reads.

The client sends schema v3 `new`, `add`, `show`, scaffold-error and verify events; queued schema v1 and v2 events remain deliverable. Entry names are sent only for trusted bundled or official index content; other names become `custom`. Non-official use is counted by origin. The fingerprint is included only for entirely official compositions. Verify reports the whole run outcome, five duration buckets, the count of nonempty items under `## Asked` in NOTES.md when readable, and names allowlisted when official entry steps were added. Fresh clones have no telemetry project link. Install and telemetry project ids are separate random UUIDs; the manifest project id is never transmitted.

If the first notice appears during `new` or `add`, the client saves a project link and deferred scaffold facts without creating an install id or sending an event. The first enabled run queues that scaffold event before its own events, using the original scaffold time and project id. A standing opt-out deletes deferred scaffolds.

A green verify event may include `deps`: allowlisted dependency names and installed major versions read from root manifest and lock files, with npm installed versions read from `node_modules`. The client reads dependencies only after consent is enabled, the dependency notice has been delivered, a signed allowlist is available in the local cache, and the project has a telemetry link. After queuing a report, it records `depsSentAt` and skips later reports for that project for seven days; simultaneous verifies may each report. Verify never refreshes the allowlist. Failed verifies and other event types carry no `deps`.

Never sent: paths, directory or project names, git remotes, usernames, hostnames, environment variable values, decision answers, brief or NOTES text, command lines, output tails, custom entry ids, anything from offline runs, or file contents (the one exception is the allowlisted dependency names and major versions read from manifest and lock files).

State lives under `<stacks state directory>/telemetry/` (`STACKS_STATE_DIR`, otherwise `$XDG_STATE_HOME/stacks`). Directories are created with mode `0700` and files with `0600`: `notice.json`, `install.json`, `projects/<manifest-id>.json`, `deferred/<manifest-id>.json`, `spool/<event-id>.json` and `flush.json`. Project links expire after 365 days; queued events after seven days. The spool retains the newest 500 events. Flush claims at most 50 by atomic rename into `claims/<uuid>/`; interrupted attempts return their claims, and later attempts recover claims older than ten minutes. Only a valid 202 response whose rejected ids belong to the batch removes events. Failure retains events with ten-minute backoff, or the server's `Retry-After`. Automatic flushes use an 800 ms HTTP deadline. Commands other than `new`, `add`, and `verify` flush after their output is written. Spool and network failures never change command output or exit status.

The human and agent notices appear on stderr. JSON results gain one optional `notice` field. The second notice names dependency reporting, links to `<telemetry endpoint>/telemetry` for the allowlist and privacy details, and gives `stacks telemetry disable` as the off switch. A pending marker counts as notified only after output is delivered; abandoned markers recover after ten minutes. When stacks prints a notice, tell the user once, in one sentence, including how to disable telemetry. Do not enable it for a user from an agent.

The whole automatic flush has an 800 ms budget, with interrupted claims returned before completion. Backoff is checked before maintenance; project expiry advances through 50 records per eligible flush using a cursor in `flush.json`. A known expired project is excluded from verify events immediately. Reset reports `reset: false` if cleanup or rotation cannot finish. Disable saves the opt-out even if cleanup fails, and then reports `cleared: false`; neither control command claims successful deletion when state is unwritable.

## Schema v3 fields

Every field has a use on the receiving side. `stacks schema telemetry` covers the control commands' results; the event schema itself is `TelemetryEventV3` in `@steamfield/stacks-format`.

| Field | Events | What it's for |
| --- | --- | --- |
| `schemaVersion` | all | Selects the ingest schema |
| `eventId` | all | Random UUID; makes delivery idempotent |
| `type` | all | `new`, `add`, `verify`, `show` or `error`; routes the event |
| `installId` | all | Random install UUID; counts distinct installs and applies per-install caps |
| `cliVersion` | all | Checks for a released version and counts use per release |
| `os` | all | `darwin`, `linux` or `other`; failure counts per platform |
| `nodeMajor` | all | Failure counts per Node line |
| `agent` | all | The detected agent; green rate per agent |
| `sentAt` | all | Event time; retention windows |
| `projectId` | `new`, `add`, `verify` | Random telemetry project UUID, separate from the manifest's id; counts distinct projects |
| `stack` | `new`, `add`, `error` | Projects and green rate per stack |
| `fragments` | `new`, `add` | How often each fragment is attached |
| `without` | `new`, `add` | How often default fragments are left out |
| `preset` | `new`, `add` | Green rate per preset |
| `targetAgents` | `new`, `add` | Share of projects per adapter target |
| `handoff` | `new`, `add` | How the project was handed to an agent |
| `source` | `new`, `add` | The `--source` attribution, when given |
| `origin` | `new`, `add` | `bundled`, `index` or `mixed`; how far the index reaches. Absent when no entry is official |
| `nonOfficial` | `new`, `add` | Counts of user, project and other non-official entries |
| `fingerprint` | `new`, `add` | Green rate per composition; only for entirely official compositions |
| `kind`, `id` | `show` | Which entries people review |
| `command`, `code` | `error` | Which of `new` or `add` failed, and its error tag; failure spikes per release |
| `scope` | `verify` | Full or partial verify scope |
| `outcome` | `verify` | The run outcome; green rate |
| `tamperCheck` | `verify` | How much of verify's tamper check ran |
| `steps` | `verify` | Each step's name, phase, layer, status, failure kind and duration bucket (`5s`, `30s`, `2m`, `10m`, `longer`); step failures and environment blockage |
| `stepsChanged` | `verify` | How many steps changed; changed-step share |
| `secondsSinceScaffold` | `verify` | Time to green |
| `secondsToFirstTestPass` | `verify` | Time to the first successful test command |
| `asked` | `verify` | Counts agent questions before verify |
| `deps` | green `verify` | Allowlisted dependency names and installed majors; dependency trends |
