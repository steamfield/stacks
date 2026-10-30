import { TelemetryEvent, TelemetryEventV2, TelemetryEventV3 } from "@steamfield/stacks-format";
import { Clock, Effect, Option, Schema } from "effect";
import { DAY, directory, names, read, remove, type Storage, uuid, write } from "./storage";

const Event = Schema.Union([TelemetryEvent, TelemetryEventV2, TelemetryEventV3]);
const EventJson = Schema.fromJsonString(Event);
export type Pending = { file: string; event: typeof Event.Type };
export const pending = Effect.fn("telemetry.pending")(function* (store: Storage) {
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
export const trim = Effect.fn("telemetry.trim")(function* (store: Storage) {
  const now = yield* Clock.currentTimeMillis;
  const all = yield* pending(store);
  const fresh = all.filter(({ event }) => now - Date.parse(event.sentAt) <= 7 * DAY);
  const keep = fresh.slice(-500);
  const ids = new Set(keep.map(({ file }) => file));
  for (const item of all) if (!ids.has(item.file)) yield* remove(store, item.file);
  return keep;
});
export const enqueue = Effect.fn("telemetry.enqueue")(function* (
  store: Storage,
  event: typeof Event.Type,
) {
  yield* write(store, store.path.join("spool", `${event.eventId}.json`), event);
  yield* trim(store);
});
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
export const recover = Effect.fn("telemetry.recover")(function* (store: Storage) {
  const now = yield* Clock.currentTimeMillis;
  for (const name of (yield* names(store, "claims")).slice(0, 50)) {
    const claim = store.path.join("claims", name);
    const stat = yield* store.fs.stat(store.path.join(store.root, claim)).pipe(Effect.option);
    if (
      Option.isSome(stat) &&
      now - Option.getOrElse(stat.value.mtime, () => new Date(now)).getTime() > 600_000
    )
      yield* restore(store, claim);
  }
});
export const claim = Effect.fn("telemetry.claim")(function* (
  store: Storage,
  events: readonly Pending[],
) {
  const dir = store.path.join("claims", yield* uuid);
  yield* directory(store, store.path.join(store.root, dir));
  const claimed: Pending[] = [];
  for (const item of events) {
    if (claimed.length === 50) break;
    const file = store.path.join(dir, store.path.basename(item.file));
    const moved = yield* Effect.result(
      store.fs.rename(store.path.join(store.root, item.file), store.path.join(store.root, file)),
    );
    if (moved._tag === "Success") claimed.push({ ...item, file });
  }
  return { dir, events: claimed };
});
