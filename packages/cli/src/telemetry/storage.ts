import { TelemetryNewEvent } from "@steamfield/stacks-format";
import { Clock, Effect, type FileSystem, type Path, Random, Schema, Struct } from "effect";

export type Storage = { fs: FileSystem.FileSystem; path: Path.Path; root: string };
export const DAY = 86_400_000;
export const uuid = Effect.gen(function* () {
  const bytes = yield* Effect.forEach(Array.from({ length: 16 }), () =>
    Random.nextIntBetween(0, 255),
  );
  bytes[6] = ((bytes[6] ?? 0) & 15) | 64;
  bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
});
export const timestamp = Clock.currentTimeMillis.pipe(
  Effect.map((now) => new Date(now).toISOString()),
);
export const directory = Effect.fn("telemetry.directory")(function* (store: Storage, at: string) {
  yield* store.fs.makeDirectory(at, { recursive: true, mode: 0o700 });
});
export const read = <S extends Schema.Codec<unknown, string>>(
  store: Storage,
  file: string,
  schema: S,
) =>
  store.fs
    .readFileString(store.path.join(store.root, file))
    .pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })));
export const write = Effect.fn("telemetry.write")(function* (
  store: Storage,
  file: string,
  value: unknown,
) {
  const at = store.path.join(store.root, file);
  yield* directory(store, store.path.dirname(at));
  yield* Effect.scoped(
    Effect.gen(function* () {
      const temp = yield* store.fs.makeTempDirectoryScoped({
        directory: store.path.dirname(at),
        prefix: ".write-",
      });
      const pending = store.path.join(temp, "value");
      yield* store.fs.writeFileString(pending, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      yield* store.fs.rename(pending, at);
    }),
  );
});
export const remove = (store: Storage, file: string) =>
  store.fs.remove(store.path.join(store.root, file), { recursive: true, force: true });
export const names = (store: Storage, dir: string) =>
  store.fs.readDirectory(store.path.join(store.root, dir)).pipe(
    Effect.catchIf(
      (error) => error.reason._tag === "NotFound",
      () => Effect.succeed([]),
    ),
  );
export const Install = Schema.fromJsonString(
  Schema.Struct({ installId: Schema.String.check(Schema.isUUID()) }),
);
export const Notice = Schema.fromJsonString(
  Schema.Struct({
    noticeShownAt: Schema.String,
    noticeVersion: Schema.optionalKey(Schema.Int),
    pending: Schema.optionalKey(Schema.Boolean),
    claimId: Schema.optionalKey(Schema.String),
  }),
);
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
export const installId = Effect.fn("telemetry.installId")(function* (store: Storage) {
  const file = store.path.join(store.root, "install.json");
  if (!(yield* store.fs.exists(file))) {
    yield* directory(store, store.root);
    yield* store.fs
      .writeFileString(file, JSON.stringify({ installId: yield* uuid }), {
        flag: "wx",
        mode: 0o600,
      })
      .pipe(
        Effect.catchIf(
          (error) => error.reason._tag === "AlreadyExists",
          () => Effect.void,
        ),
      );
  }
  return (yield* read(store, "install.json", Install)).installId;
});
