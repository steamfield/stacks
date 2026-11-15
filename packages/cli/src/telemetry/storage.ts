/**
 * The telemetry directory on disk: where every other telemetry module reads and writes its files.
 *
 * Telemetry keeps its state under `Paths.state` in a `telemetry/` directory (the "store"), outside
 * any project. It holds `install.json` (this install's random id), `notice.json` (whether the
 * one-time notice was shown), `flush.json` (delivery backoff), `spool/` (events waiting to be
 * sent), `claims/` (events a flush has taken from the spool), `projects/` (one link per scaffolded
 * project) and `deferred/` (scaffolds recorded on the notice run, sent later).
 *
 * This module owns the plain file operations over that directory and the schemas of the files it
 * holds. Directories are created owner-only (`0o700`) and files are written owner-only (`0o600`)
 * through `core/replace-file.ts::replaceFile`, so a crash never leaves a half-written file. Every
 * read rejects properties a schema doesn't name. Paths passed to these helpers are relative to the
 * store's root unless a helper says otherwise.
 */
import { TelemetryNewEvent } from "@steamfield/stacks-format";
import { Clock, Effect, FileSystem, Path, Random, Schema, Struct } from "effect";
import { replaceFile } from "../core/replace-file";

/** The filesystem services and the absolute telemetry directory every helper works in. */
export type Storage = { fs: FileSystem.FileSystem; path: Path.Path; root: string };

/** One day in milliseconds, the unit of every retention window. */
export const DAY = 86_400_000;

/**
 * A random version 4 UUID drawn from Effect's `Random`, so tests can make it deterministic.
 *
 * Bytes 6 and 8 carry the version (`4`) and variant (`10xx`) bits the UUID format requires, which
 * the schemas' `isUUID` check expects.
 */
export const uuid = Effect.gen(function* () {
  const bytes = yield* Effect.forEach(Array.from({ length: 16 }), () =>
    Random.nextIntBetween(0, 255),
  );
  bytes[6] = ((bytes[6] ?? 0) & 15) | 64;
  bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
});

/** The current time from `Clock` as an ISO 8601 string. */
export const timestamp = Clock.currentTimeMillis.pipe(
  Effect.map((now) => new Date(now).toISOString()),
);

/** Creates a directory and its parents, owner-only. `at` is an absolute path. */
export const directory = Effect.fn("telemetry.directory")(function* (store: Storage, at: string) {
  yield* store.fs.makeDirectory(at, { recursive: true, mode: 0o700 });
});

/** Reads a store file and decodes it, rejecting properties the schema doesn't name. */
export const read = <S extends Schema.Codec<unknown, string>>(
  store: Storage,
  file: string,
  schema: S,
) =>
  store.fs
    .readFileString(store.path.join(store.root, file))
    .pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })));

/** Replaces a store file with `value` as JSON, creating its directory first. */
export const write = Effect.fn("telemetry.write")(function* (
  store: Storage,
  file: string,
  value: unknown,
) {
  const at = store.path.join(store.root, file);
  yield* directory(store, store.path.dirname(at));
  yield* replaceFile(at, JSON.stringify(value), { mode: 0o600 }).pipe(
    Effect.provideService(FileSystem.FileSystem, store.fs),
    Effect.provideService(Path.Path, store.path),
  );
});

/** Removes a store file or directory; one that is already gone is fine. */
export const remove = (store: Storage, file: string) =>
  store.fs.remove(store.path.join(store.root, file), { recursive: true, force: true });

/** Lists a store directory's entries; a directory that doesn't exist lists as empty. */
export const names = (store: Storage, dir: string) =>
  store.fs.readDirectory(store.path.join(store.root, dir)).pipe(
    Effect.catchIf(
      (error) => error.reason._tag === "NotFound",
      () => Effect.succeed([]),
    ),
  );

/** `install.json`: the random id that lets the server count distinct installs. */
export const Install = Schema.fromJsonString(
  Schema.Struct({ installId: Schema.String.check(Schema.isUUID()) }),
);

/**
 * `notice.json`: when the notice was shown and which version of it.
 *
 * While a run is showing the notice, the file also holds `pending: true` and that run's
 * `claimId`, so a concurrent run neither shows it again nor counts it as delivered too early
 * (`notice.ts`).
 */
export const Notice = Schema.fromJsonString(
  Schema.Struct({
    noticeShownAt: Schema.String,
    noticeVersion: Schema.optionalKey(Schema.Int),
    pending: Schema.optionalKey(Schema.Boolean),
    claimId: Schema.optionalKey(Schema.String),
  }),
);

/**
 * A project link under `projects/<manifest projectId>.json`.
 *
 * It ties a scaffolded project to a random `telemetryProjectId` (the manifest's own id never
 * leaves the machine) and keeps the facts later verify events need: when it was scaffolded, the
 * step names the CLI wrote (other names are reported as `custom`), the first passing test run and
 * when dependency names were last sent.
 */
export const Project = Schema.Struct({
  telemetryProjectId: Schema.String.check(Schema.isUUID()),
  scaffoldedAt: Schema.String,
  stack: Schema.String,
  fragments: Schema.Array(Schema.String),
  steps: Schema.Array(Schema.String),
  firstTestPassAt: Schema.optionalKey(Schema.String),
  depsSentAt: Schema.optionalKey(Schema.String),
});
export type Project = typeof Project.Type;

// A scaffold recorded on the notice run, queued on the first enabled run with its own event id.
const scaffoldFields = Struct.omit(TelemetryNewEvent.fields, [
  "schemaVersion",
  "eventId",
  "installId",
  "cliVersion",
  "os",
  "nodeMajor",
  "agent",
  "sentAt",
]);

/**
 * A `deferred/<projectId>.json` file: a `new` or `add` event saved on the notice run without its
 * envelope, plus the event id it will be sent under.
 */
export const DeferredScaffold = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({
      ...scaffoldFields,
      projectId: TelemetryNewEvent.fields.projectId.schema,
      eventId: TelemetryNewEvent.fields.eventId,
    }),
    Schema.Struct({
      ...scaffoldFields,
      type: Schema.Literal("add"),
      projectId: TelemetryNewEvent.fields.projectId.schema,
      eventId: TelemetryNewEvent.fields.eventId,
    }),
  ]),
);

/**
 * Returns this install's id, creating `install.json` the first time.
 *
 * The file is created exclusively, so when two runs race, both end up reading the one id that won.
 */
export const installId = Effect.fn("telemetry.installId")(function* (store: Storage) {
  const file = store.path.join(store.root, "install.json");
  if (!(yield* store.fs.exists(file))) yield* createInstallId(store, file);
  return (yield* read(store, "install.json", Install)).installId;
});

const createInstallId = Effect.fn("telemetry.createInstallId")(function* (
  store: Storage,
  file: string,
) {
  yield* directory(store, store.root);
  yield* store.fs
    .writeFileString(file, JSON.stringify({ installId: yield* uuid }), { flag: "wx", mode: 0o600 })
    .pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "AlreadyExists",
        () => Effect.void,
      ),
    );
});
