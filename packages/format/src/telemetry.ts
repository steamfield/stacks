import { Schema } from "effect";
import { AgentId, DetectedAgent } from "./agent.js";
import { Ecosystem, sortedUnique } from "./allowlist.js";
import { Kebab, Kind } from "./entry.js";
import { Digest } from "./index-schema.js";
import { Manifest } from "./manifest.js";
import { Outcome, RunRecord, RunStep, TamperCheck } from "./run-record.js";

export const TELEMETRY_SCHEMA_VERSION = 1;

const Uuid = Schema.String.check(Schema.isUUID());
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Seconds = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
// Effect omits the shared schemas' non-Unicode regexes from JSON Schema; retain them for v1.
const EntryId = Kebab.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u));
const Fingerprint = Digest.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/u));
const CliVersion = Schema.String.check(
  Schema.isPattern(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u),
);
const SentAt = Schema.String.check(
  Schema.isPattern(
    /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/u,
  ),
  Schema.makeFilter(
    (at) => {
      const instant = new Date(at);
      return (
        (Number.isFinite(instant.getTime()) &&
          instant.toISOString().replace(".000Z", "Z") === at.replace(".000Z", "Z")) ||
        "invalid UTC timestamp"
      );
    },
    { toJsonSchema: () => ({ format: "date-time" }) },
  ),
);

const envelope = {
  schemaVersion: Schema.Literal(TELEMETRY_SCHEMA_VERSION),
  eventId: Uuid,
  installId: Uuid,
  cliVersion: CliVersion,
  os: Schema.Literals(["darwin", "linux", "other"]),
  nodeMajor: Schema.Int.check(Schema.isGreaterThan(0)),
  agent: DetectedAgent,
  sentAt: SentAt,
};

/** Official-name lookup and replacement with `custom` belong to the sender and ingest. */
const composition = {
  projectId: Schema.optionalKey(Uuid),
  stack: EntryId,
  fragments: Schema.Array(EntryId),
  without: Schema.Array(EntryId),
  preset: Manifest.fields.preset,
  targetAgents: Schema.Array(AgentId),
  handoff: Manifest.fields.handoff.schema.fields.kind,
  source: Schema.optionalKey(Schema.Literals(["web", "docs", "skill", "cli", "other"])),
  // Absent when no entry is official.
  origin: Schema.optionalKey(Schema.Literals(["bundled", "index", "mixed"])),
  nonOfficial: Schema.Struct({ user: Count, project: Count, source: Count }),
  fingerprint: Schema.optionalKey(Fingerprint),
};

export const TelemetryNewEvent = Schema.Struct({
  ...envelope,
  type: Schema.Literal("new"),
  ...composition,
});
export type TelemetryNewEvent = typeof TelemetryNewEvent.Type;

export const TelemetryAddEvent = Schema.Struct({
  ...envelope,
  type: Schema.Literal("add"),
  ...composition,
});
export type TelemetryAddEvent = typeof TelemetryAddEvent.Type;

const step = Schema.Struct({
  name: EntryId,
  phase: RunStep.fields.phase,
  layer: RunStep.fields.layer,
  status: RunStep.fields.status,
  failureKind: RunStep.fields.failureKind,
  duration: Schema.Literals(["5s", "30s", "2m", "10m", "longer"]),
});

export const TelemetryVerifyEvent = Schema.Struct({
  ...envelope,
  type: Schema.Literal("verify"),
  projectId: Schema.optionalKey(Uuid),
  scope: RunRecord.fields.scope,
  outcome: Outcome,
  tamperCheck: TamperCheck,
  steps: Schema.Array(step),
  stepsChanged: Count,
  secondsSinceScaffold: Seconds,
  secondsToFirstTestPass: Schema.optionalKey(Seconds),
});
export type TelemetryVerifyEvent = typeof TelemetryVerifyEvent.Type;

export const TelemetryShowEvent = Schema.Struct({
  ...envelope,
  type: Schema.Literal("show"),
  kind: Kind,
  id: EntryId,
});
export type TelemetryShowEvent = typeof TelemetryShowEvent.Type;

export const TelemetryErrorEvent = Schema.Struct({
  ...envelope,
  type: Schema.Literal("error"),
  command: Schema.Literals(["new", "add"]),
  code: Schema.Literals([
    "ComposeConflict",
    "EntryInvalid",
    "TargetNotEmpty",
    "NotFound",
    "BadInput",
    "PermissionDenied",
    "Interrupted",
    "Defect",
    "other",
  ]),
  stack: Schema.optionalKey(EntryId),
});
export type TelemetryErrorEvent = typeof TelemetryErrorEvent.Type;

/** Decode at a boundary with `onExcessProperty: "error"` to reject unknown keys. */
export const TelemetryEvent = Schema.Union([
  TelemetryNewEvent,
  TelemetryAddEvent,
  TelemetryVerifyEvent,
  TelemetryShowEvent,
  TelemetryErrorEvent,
]);
export type TelemetryEvent = typeof TelemetryEvent.Type;

export const Dependency = Schema.Struct({
  ecosystem: Ecosystem,
  name: Schema.String,
  major: Schema.NullOr(Schema.String.check(Schema.isPattern(/^(0\.\d+|[1-9]\d*)$/u))),
});
export type Dependency = typeof Dependency.Type;

// NUL sorts below every name character, so the joined key orders by ecosystem, then name.
const Dependencies = Schema.Array(Dependency)
  .check(Schema.isMaxLength(100))
  .check(
    Schema.makeFilter(
      (deps) =>
        sortedUnique(deps.map((dep) => `${dep.ecosystem}\u0000${dep.name}`)) ||
        "dependencies must be sorted and unique",
    ),
  );

export const TelemetryVerifyEventV2 = Schema.Struct({
  ...TelemetryVerifyEvent.fields,
  schemaVersion: Schema.Literal(2),
  deps: Schema.optionalKey(Dependencies),
});
export type TelemetryVerifyEventV2 = typeof TelemetryVerifyEventV2.Type;

/** Version 2 preserves every v1 field and adds allowlisted dependencies to verify. */
export const TelemetryEventV2 = Schema.Union([
  Schema.Struct({ ...TelemetryNewEvent.fields, schemaVersion: Schema.Literal(2) }),
  Schema.Struct({ ...TelemetryAddEvent.fields, schemaVersion: Schema.Literal(2) }),
  TelemetryVerifyEventV2,
  Schema.Struct({ ...TelemetryShowEvent.fields, schemaVersion: Schema.Literal(2) }),
  Schema.Struct({ ...TelemetryErrorEvent.fields, schemaVersion: Schema.Literal(2) }),
]);
export type TelemetryEventV2 = typeof TelemetryEventV2.Type;

export const TelemetryVerifyEventV3 = Schema.Struct({
  ...TelemetryVerifyEventV2.fields,
  schemaVersion: Schema.Literal(3),
  // Nonempty items under `## Asked` in the project's NOTES.md: questions the agent asked.
  asked: Schema.optionalKey(Count),
});
export type TelemetryVerifyEventV3 = typeof TelemetryVerifyEventV3.Type;

/** Version 3 preserves every v2 field and adds the agent's question count to verify. */
export const TelemetryEventV3 = Schema.Union([
  Schema.Struct({ ...TelemetryNewEvent.fields, schemaVersion: Schema.Literal(3) }),
  Schema.Struct({ ...TelemetryAddEvent.fields, schemaVersion: Schema.Literal(3) }),
  TelemetryVerifyEventV3,
  Schema.Struct({ ...TelemetryShowEvent.fields, schemaVersion: Schema.Literal(3) }),
  Schema.Struct({ ...TelemetryErrorEvent.fields, schemaVersion: Schema.Literal(3) }),
]);
export type TelemetryEventV3 = typeof TelemetryEventV3.Type;

/** POST /v1/events request body. */
export const TelemetryBatch = Schema.Struct({
  events: Schema.Array(Schema.Union([TelemetryEvent, TelemetryEventV2, TelemetryEventV3])).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
});
export type TelemetryBatch = typeof TelemetryBatch.Type;

/** The 202 response lists only rejected event ids; an empty list accepts every event. */
export const TelemetryAccepted = Schema.Struct({ rejected: Schema.Array(Uuid) });
export type TelemetryAccepted = typeof TelemetryAccepted.Type;

function standaloneJsonSchema(schema: Schema.Top): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" });
  const definitions = document.definitions ?? {};
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...document.schema,
    ...(Object.keys(definitions).length ? { $defs: definitions } : {}),
  };
}

/** Standalone draft 2020-12 document; released v1 is frozen in schemas/telemetry-event.v1.json. */
export function telemetryEventJsonSchema(): Record<string, unknown> {
  return standaloneJsonSchema(TelemetryEvent);
}

/** Standalone draft 2020-12 document; released v2 is frozen in schemas/telemetry-event.v2.json. */
export function telemetryEventV2JsonSchema(): Record<string, unknown> {
  return standaloneJsonSchema(TelemetryEventV2);
}

/** Standalone draft 2020-12 document; released v3 is frozen in schemas/telemetry-event.v3.json. */
export function telemetryEventV3JsonSchema(): Record<string, unknown> {
  return standaloneJsonSchema(TelemetryEventV3);
}
