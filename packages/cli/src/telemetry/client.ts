/**
 * Sends queued telemetry events to the server: one flush, posting at most one batch to
 * `<url>/v1/events`.
 *
 * `telemetry/index.ts` calls `deliver` when a command flushes (after its output is written, or
 * from `stacks telemetry flush`), only once consent says `enabled`. A flush runs under a deadline
 * (800 ms after a command, 5 s for an explicit flush) and never fails the command; a slow or
 * failing server just leaves the events in the spool (`spool.ts`) for a later run.
 *
 * Backoff lives in `flush.json` (the "flush state"): `until` is the time before which no run tries
 * again, set after a failed post, a timeout or a `Retry-After` header. The same file holds
 * `projectCursor`, which spreads the cleanup of expired project links (`projects/`) across runs,
 * 50 files at a time. The server answers 202 with the ids it rejected; a rejected event is dropped
 * like a sent one, since sending it again would be rejected again.
 */
import { TelemetryAccepted, type TelemetryBatch } from "@steamfield/stacks-format";
import { Clock, Effect, Option, Schema } from "effect";
import { type HttpClient, HttpClientRequest } from "effect/http";
import type { TelemetryFlush } from "../schemas/telemetry";
import { claim, type Pending, recover, restore, trim } from "./spool";
import { DAY, installId, names, Project, read, remove, type Storage, write } from "./storage";

/** How long to wait after a failure that gave no usable `Retry-After`. */
const DEFAULT_BACKOFF_MS = 600_000;
/** A project link older than this is deleted. */
const PROJECT_RETENTION = 365 * DAY;
/** How many project links one flush checks for expiry. */
const PROJECTS_PER_PRUNE = 50;

const State = Schema.fromJsonString(
  Schema.Struct({
    until: Schema.Number,
    projectCursor: Schema.optionalKey(Schema.String),
  }),
);
type State = typeof State.Type;
type Delivery = { store: Storage; client: HttpClient.HttpClient; url: string; deadline: number };

/** The flush counts reported while telemetry is enabled. */
const enabledFlush = (counts: {
  sent: number;
  kept: number;
  rejected: number;
}): TelemetryFlush => ({
  sent: counts.sent,
  kept: counts.kept,
  rejected: counts.rejected,
  reason: "enabled",
});

/** Project link names in the order to check them: those after `cursor` first, then wrapping. */
const rotateAfter = (all: ReadonlyArray<string>, cursor: string | undefined) =>
  cursor === undefined
    ? all
    : [...all.filter((name) => name > cursor), ...all.filter((name) => name <= cursor)];

/**
 * Deletes unreadable or expired project links among the next batch after `cursor`, and returns
 * the last name checked, the cursor for the next flush.
 */
const pruneProjects = Effect.fn("telemetry.pruneProjects")(function* (
  store: Storage,
  cursor?: string,
) {
  const now = yield* Clock.currentTimeMillis;
  const all = (yield* names(store, "projects")).filter((name) => name.endsWith(".json")).sort();
  const batch = rotateAfter(all, cursor).slice(0, PROJECTS_PER_PRUNE);
  for (const name of batch) {
    const file = store.path.join("projects", name);
    const project = yield* Effect.result(read(store, file, Schema.fromJsonString(Project)));
    if (
      project._tag === "Failure" ||
      now - Date.parse(project.success.scaffoldedAt) > PROJECT_RETENTION
    )
      yield* remove(store, file);
  }
  return batch.at(-1);
});

/** Milliseconds to wait from a `Retry-After` value, given in seconds or as an HTTP date. */
function retryDelay(value: string | undefined, now: number) {
  if (value === undefined) return DEFAULT_BACKOFF_MS;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : DEFAULT_BACKOFF_MS;
}

/**
 * Posts one batch. Anything but a 202 is not accepted, as is a 202 that claims to reject an id
 * this batch didn't contain.
 */
const post = Effect.fn("telemetry.post")(function* (input: {
  client: HttpClient.HttpClient;
  url: string;
  events: readonly TelemetryBatch["events"][number][];
}) {
  const response = yield* input.client.execute(
    HttpClientRequest.post(`${input.url.replace(/\/$/, "")}/v1/events`).pipe(
      HttpClientRequest.bodyJsonUnsafe({ events: input.events }),
    ),
  );
  if (response.status !== 202)
    return { accepted: false as const, retryAfter: response.headers["retry-after"] };
  const value = yield* response.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(TelemetryAccepted, { onExcessProperty: "error" })),
  );
  const sent = new Set(input.events.map((event) => event.eventId));
  if (value.rejected.some((id) => !sent.has(id)))
    return { accepted: false as const, retryAfter: undefined };
  return { accepted: true as const, rejected: new Set(value.rejected) };
});

const countPending = (store: Storage) =>
  names(store, "spool").pipe(
    Effect.map((files) => files.filter((file) => file.endsWith(".json")).length),
  );

/** The flush state; a missing or unreadable `flush.json` means no backoff. */
const readState = (store: Storage) =>
  read(store, "flush.json", State).pipe(Effect.orElseSucceed((): State => ({ until: 0 })));

const saveState = (store: Storage, state: State) => write(store, "flush.json", state);

/** Housekeeping, then one batch: recover stale claims, prune project links, trim and post. */
const send = Effect.fn("telemetry.send")(function* (input: Delivery, state: State) {
  const { store } = input;
  yield* recover(store);
  const cursor = yield* pruneProjects(store, state.projectCursor);
  const cleared = { until: 0, ...(cursor === undefined ? {} : { projectCursor: cursor }) };
  if (cursor !== undefined) yield* saveState(store, cleared);
  const events = yield* trim(store);
  if (!events.length) return enabledFlush({ sent: 0, kept: 0, rejected: 0 });
  // An existing spool never permits delivery under an identity that could not be persisted.
  yield* installId(store);
  return yield* Effect.scoped(postClaimed({ delivery: input, events, cleared }));
});

/**
 * Claims a batch, posts it and records the outcome. The claim goes back to the spool when the
 * scope closes, which after a successful post holds nothing, since sent files are deleted first.
 */
const postClaimed = Effect.fn("telemetry.postClaimed")(function* (input: {
  delivery: Delivery;
  events: ReadonlyArray<Pending>;
  cleared: State;
}) {
  const { delivery, events, cleared } = input;
  const { store } = delivery;
  const batch = yield* Effect.acquireRelease(claim(store, events), (batch) =>
    restore(store, batch.dir).pipe(Effect.ignore),
  );
  if (!batch.events.length)
    return enabledFlush({ sent: 0, kept: yield* countPending(store), rejected: 0 });
  const attempt = yield* post({
    ...delivery,
    events: batch.events.map(({ event }) => event),
  }).pipe(Effect.result);
  if (attempt._tag === "Success" && attempt.success.accepted) {
    const rejected = attempt.success.rejected.size;
    for (const item of batch.events) yield* remove(store, item.file);
    yield* saveState(store, cleared);
    return enabledFlush({
      sent: batch.events.length - rejected,
      kept: yield* countPending(store),
      rejected,
    });
  }
  const retryAfter = attempt._tag === "Success" ? attempt.success.retryAfter : undefined;
  const now = yield* Clock.currentTimeMillis;
  yield* saveState(store, { ...cleared, until: now + retryDelay(retryAfter, now) });
  return enabledFlush({ sent: 0, kept: events.length, rejected: 0 });
});

/** Sends unless a backoff is still running. */
const attempt = Effect.fn("telemetry.attempt")(function* (input: Delivery) {
  const state = yield* readState(input.store);
  if (state.until > (yield* Clock.currentTimeMillis))
    return enabledFlush({ sent: 0, kept: yield* countPending(input.store), rejected: 0 });
  return yield* send(input, state);
});

/**
 * One flush within `deadline` milliseconds. Running out of time backs off for the default delay
 * and reports every event as kept.
 */
export const deliver = Effect.fn("telemetry.deliver")(function* (
  input: Delivery,
): Effect.fn.Return<TelemetryFlush, unknown> {
  const { store } = input;
  const result = yield* attempt(input).pipe(Effect.timeoutOption(input.deadline));
  if (Option.isSome(result)) return result.value;
  const previous = yield* readState(store);
  yield* saveState(store, {
    ...previous,
    until: (yield* Clock.currentTimeMillis) + DEFAULT_BACKOFF_MS,
  });
  return enabledFlush({ sent: 0, kept: yield* countPending(store), rejected: 0 });
});
