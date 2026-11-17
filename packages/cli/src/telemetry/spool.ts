/**
 * Owns the bounded on-disk telemetry queue. Moving events into a claim before sending gives each
 * batch one owner.
 */
import { TelemetryEvent, TelemetryEventV2, TelemetryEventV3 } from "@steamfield/stacks-format";
import { Clock, Effect, Option, Schema } from "effect";
import { DAY, directory, names, read, remove, type Storage, uuid, write } from "./storage";

/** Events older than this are dropped from the spool. */
const MAX_EVENT_AGE = 7 * DAY;
/** The spool keeps at most this many events, the newest ones. */
const MAX_SPOOLED = 500;
/** The most events one flush claims, and the most stale claims one flush recovers. */
const BATCH_SIZE = 50;
/** A claim directory older than this belongs to a run that never finished its flush. */
const STALE_CLAIM_MS = 600_000;

// Older event versions stay decodable so events queued by an earlier CLI release still send.
const Event = Schema.Union([TelemetryEvent, TelemetryEventV2, TelemetryEventV3]);
const EventJson = Schema.fromJsonString(Event);
/** A spooled event and its file, relative to the telemetry directory. */
export type Pending = { file: string; event: typeof Event.Type };

/**
 * Every spooled event, oldest first. A file that doesn't decode, or whose name doesn't match its
 * event id, is deleted. Files still being written (`.write-` temporaries) are left alone.
 */
const pending = Effect.fn("telemetry.pending")(function* (store: Storage) {
  const events: Pending[] = [];
  for (const name of yield* names(store, "spool")) {
    if (name.startsWith(".write-")) continue;
    const file = store.path.join("spool", name);
    const decoded = yield* Effect.result(read(store, file, EventJson));
    if (decoded._tag === "Failure" || name !== `${decoded.success.eventId}.json`) {
      yield* remove(store, file);
    } else events.push({ file, event: decoded.success });
  }
  return events.sort(
    (a, b) => a.event.sentAt.localeCompare(b.event.sentAt) || a.file.localeCompare(b.file),
  );
});

/** Drops expired and excess events from the spool and returns the ones kept, oldest first. */
export const trim = Effect.fn("telemetry.trim")(function* (store: Storage) {
  const now = yield* Clock.currentTimeMillis;
  const all = yield* pending(store);
  const fresh = all.filter(({ event }) => now - Date.parse(event.sentAt) <= MAX_EVENT_AGE);
  const keep = fresh.slice(-MAX_SPOOLED);
  const kept = new Set(keep.map(({ file }) => file));
  for (const item of all) if (!kept.has(item.file)) yield* remove(store, item.file);
  return keep;
});

/** Adds an event to the spool, then trims it. */
export const enqueue = Effect.fn("telemetry.enqueue")(function* (
  store: Storage,
  event: typeof Event.Type,
) {
  yield* write(store, store.path.join("spool", `${event.eventId}.json`), event);
  yield* trim(store);
});

/**
 * Moves every file in a claim directory back into the spool and deletes the claim. A file that
 * vanished meanwhile was already handled and is skipped.
 */
export const restore = Effect.fn("telemetry.restore")(function* (store: Storage, claim: string) {
  yield* directory(store, store.path.join(store.root, "spool"));
  for (const name of yield* names(store, claim)) {
    yield* store.fs
      .rename(store.path.join(store.root, claim, name), store.path.join(store.root, "spool", name))
      .pipe(
        Effect.catchIf(
          (error) => error.reason._tag === "NotFound",
          () => Effect.void,
        ),
      );
  }
  yield* remove(store, claim);
});

/** Restores claims left behind by runs that stopped mid-flush, up to one batch per call. */
export const recover = Effect.fn("telemetry.recover")(function* (store: Storage) {
  const now = yield* Clock.currentTimeMillis;
  for (const name of (yield* names(store, "claims")).slice(0, BATCH_SIZE)) {
    const claim = store.path.join("claims", name);
    const stat = yield* store.fs.stat(store.path.join(store.root, claim)).pipe(Effect.option);
    if (Option.isNone(stat)) continue;
    // A file system without modification times reads as just modified, so the claim is kept.
    const modified = Option.getOrElse(stat.value.mtime, () => new Date(now)).getTime();
    if (now - modified > STALE_CLAIM_MS) yield* restore(store, claim);
  }
});

/**
 * Moves up to one batch of events from the spool into a new claim directory. An event another run
 * moved first fails to rename and is left out of this batch.
 */
export const claim = Effect.fn("telemetry.claim")(function* (
  store: Storage,
  events: readonly Pending[],
) {
  const dir = store.path.join("claims", yield* uuid);
  yield* directory(store, store.path.join(store.root, dir));
  const claimed: Pending[] = [];
  for (const item of events) {
    if (claimed.length === BATCH_SIZE) break;
    const file = store.path.join(dir, store.path.basename(item.file));
    const moved = yield* Effect.result(
      store.fs.rename(store.path.join(store.root, item.file), store.path.join(store.root, file)),
    );
    if (moved._tag === "Success") claimed.push({ ...item, file });
  }
  return { dir, events: claimed };
});
