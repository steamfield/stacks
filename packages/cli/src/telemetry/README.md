# telemetry

This folder is the CLI's anonymous usage reporting. When someone scaffolds a project, views an
entry, hits a failure in `new` or `add`, or runs `verify`, the CLI may queue a small event saying
so, and send queued events to the stacks server later. Those events are where the published
stats (green rate, time to green, which fragments get used) come from.

Telemetry is best effort and opt-out. It never changes a command's output or exit, it sends
nothing until the user has seen a one-time notice, and `stacks telemetry disable` (or
`DO_NOT_TRACK`, `STACKS_TELEMETRY_DISABLED`, `--no-telemetry`, `--offline`, CI) turns it off.

## How it fits

`index.ts::Telemetry` is the only way in. `main.ts` provides its layer and calls
`flushAfterOutput`; `cli.ts` calls `notify`; `commands/new.ts`, `commands/add.ts`,
`commands/show.ts`, `commands/telemetry-hooks.ts` and `core/verify/record.ts` record events;
`commands/telemetry.ts` (`stacks telemetry`) reads `status` and calls `flushNow` and `clear`.
`commands/telemetry-hooks.ts` also uses `events.ts::official`, and `commands/telemetry.ts` uses
`storage.ts::write` to save the telemetry setting in the user's `config.json`.

Inside, the folder depends on `AppConfig` (consent inputs, the state path, the endpoint),
`Host`, `Output` (the notice and debug notes), `HttpClient` (the one POST), `Allowlist` (the
cached dependency allowlist), and on `core/` for composition, fingerprints, manifests and
dependency reads. Event shapes come from `@steamfield/stacks-format` (`TelemetryEventV3` and its
older versions); they are a wire contract with the server.

This folder is one of the few places allowed to use `catchCause`: `index.ts::safe` wraps every
method so a failure, a defect or an interruption becomes a fixed fallback and a debug log line.
Defects are logged by class and stack frames only.

## The flow of one event

1. A command calls a record method, for example `recordVerify(record)`.
2. `notify` runs first, once per invocation: it asks `consent.ts::consent` for the reason, and
   `notice.ts::showNotice` prints the notice when one is due. On a run that isn't a notice run, it
   also sends any scaffolds saved under `deferred/` by an earlier notice run.
3. If consent is `enabled` and this isn't the notice run, the event body is built (`events.ts`,
   with `projects.ts::verify` or `projects.ts::scaffold` for project facts, and
   `composition.ts::completeAddFacts` for `add`), wrapped in its envelope, validated and written
   to the spool by `spool.ts::enqueue`.
4. Later in the same run, `flush` or `flushAfterOutput` calls `client.ts::deliver`, which claims
   a batch of up to 50 events, posts it to `<url>/v1/events` under a deadline, and deletes the
   sent files or puts them back.
5. When the invocation ends, the layer's finalizer calls `notice.ts::settleNotice` to record
   whether the notice reached the user.

`new`, `add` and `verify` flush themselves; any other command that recorded something asks
`main` to flush once its output is written (`markFlushAfterOutput`), so sending never delays
what the user sees.

## Consent order

`consent.ts::consent` returns the first reason that applies, in this order, and
`stacks telemetry` shows it: `flag` (`--no-telemetry`), `offline`, `do_not_track`, `environment`
(`STACKS_TELEMETRY_DISABLED`), `config_invalid` (the settings file can't be read), `config` (the
setting is off), `ci`, `source_build`, `no_endpoint`, `home_not_writable`, `not_notified`, then
`enabled`. For the standing reasons (`do_not_track`, `environment`, `config`, `ci`) the queued
events are deleted.

## Files

| File | What it owns |
| --- | --- |
| `index.ts` | The `Telemetry` service: notice handling per invocation, record methods, flush, status, clear |
| `consent.ts` | The ordered consent rules and which reasons purge the queue |
| `notice.ts` | The one-time notice, its exclusive claim in `notice.json`, settling and recovery |
| `events.ts` | Pure event bodies, the official-entry privacy rule, the field-consumer table |
| `composition.ts` | Checking an `add` event's manifest facts against the registry |
| `projects.ts` | Project links, first-test-pass times and the dependency facts on a verify event |
| `spool.ts` | The on-disk queue: enqueue, trim, claim, restore and stale-claim recovery |
| `client.ts` | One flush: the POST, the server's answer, backoff and project-link pruning |
| `storage.ts` | File helpers for the telemetry directory and the schemas of its files |

## Terms

- **Telemetry directory** (the "store" in code): `telemetry/` under `Paths.state`, outside every
  project. `storage.ts` lists what it holds.
- **Official entry**: trusted, and from the bundled registry or the signed remote index. Only
  official ids are sent; any other id is sent as `custom`.
- **Notice run**: the invocation that prints the notice. It sends nothing; `new` and `add` on it
  save their scaffold under `deferred/` and create the project link, so the next enabled run sends
  the scaffold and the project's first verify still counts.
- **Claim**: a directory under `claims/` (for spooled events) or a pending `notice.json` (for the
  notice) that marks work one run has taken, so concurrent runs don't repeat it. A claim left by a
  run that died is recovered after ten minutes.
- **Project link**: `projects/<manifest projectId>.json`, mapping a project to a random telemetry
  project id and keeping its scaffold time and composed step names.
- **Envelope**: the fields every event carries (event id, install id, CLI version, OS, Node
  major, agent, time).
- **Debug mode**: `STACKS_TELEMETRY_DEBUG=1` prints each event as a note instead of queuing it.

## Where to start

Read `index.ts::Telemetry.layer` top to bottom; it wires every other file. Then `consent.ts` and
`notice.ts` for when events may be sent, and `client.ts::deliver` for how they leave the machine.
The user-facing field list is `packages/cli/docs/reference/telemetry.md`; AGENTS.md
("Architecture map", the `src/telemetry/` entry) has the same facts in brief.

Tests, all in `packages/cli/tests/`:

- `telemetry-consent.test.ts`: the consent order, the notice run, disable and reset.
- `telemetry-events.test.ts`, `telemetry-fixtures.test.ts`: event contents and privacy.
- `telemetry-spool.test.ts`: the spool's limits, concurrent claims, delivery and retention.
- `telemetry-gaps.test.ts`: deferred notice scaffolds. `telemetry-additional.test.ts`: registry
  overrides, hand-edited manifests and failure cases.
- `add-telemetry-dir.test.ts`, `dependency-telemetry-client.test.ts`,
  `dependency-telemetry-edge.test.ts`, `verify-defect-record.test.ts`: `add`, dependency facts and
  verify records.
