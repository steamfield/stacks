/**
 * Builds telemetry event bodies against the published wire contract. `official` and `publicId`
 * govern which entry ids may be included.
 */
import type {
  EntryRef,
  Manifest,
  RunRecord,
  RunStep,
  TelemetryErrorEvent,
  TelemetryEventV3,
  TelemetryNewEvent,
  TelemetryVerifyEventV3,
} from "@steamfield/stacks-format";
import { defined } from "../core/object";
import type { Entry } from "../core/registry/entry";
import type { Project } from "./storage";

export type TelemetrySource = TelemetryNewEvent["source"];

/**
 * What `new` or `add` hands to telemetry: the manifest it wrote, the default fragments left out,
 * the `--source` flag and the names of the verify steps the CLI composed.
 */
export type ScaffoldFacts = {
  type: "new" | "add";
  manifest: Manifest;
  without: readonly EntryRef[];
  source?: TelemetrySource;
  steps: readonly string[];
};
export type ShowFacts = Pick<Entry, "kind" | "id" | "origin" | "trusted">;
export type ErrorFacts = {
  command: "new" | "add";
  code: string;
  stack?: Pick<Entry, "id" | "origin" | "trusted">;
};
/** The fields every event carries whatever its type. */
export type Envelope = Pick<
  TelemetryEventV3,
  "schemaVersion" | "eventId" | "installId" | "cliVersion" | "os" | "nodeMajor" | "agent" | "sentAt"
>;

/** Whether an entry is official: from the bundled registry or the remote index, and not untrusted. */
export const official = (entry: { origin: string; trusted?: boolean }) =>
  entry.trusted !== false && (entry.origin === "bundled" || entry.origin === "index");

/** The id telemetry may report for an entry: its own when official, otherwise `custom`. */
export const publicId = (entry: { id: string; origin: string; trusted?: boolean }) =>
  official(entry) ? entry.id : "custom";

/** Which official origins a project's entries came from, or `undefined` when none is official. */
function officialOrigin(entries: ReadonlyArray<EntryRef>): TelemetryNewEvent["origin"] {
  const origins = new Set(entries.filter(official).map((entry) => entry.origin));
  if (origins.size > 1) return "mixed";
  if (origins.has("bundled")) return "bundled";
  if (origins.has("index")) return "index";
  return undefined;
}

/**
 * Counts of entries that aren't official: user and project entries by origin, and every other
 * non-official entry (an untrusted override of the bundled registry or index, an unknown id) as
 * `source`.
 */
function nonOfficialCounts(entries: ReadonlyArray<EntryRef>) {
  const count = (origin: string) => entries.filter((entry) => entry.origin === origin).length;
  const source = entries.filter(
    (entry) => !official(entry) && !["user", "project"].includes(entry.origin),
  ).length;
  return { user: count("user"), project: count("project"), source };
}

/** Every entry a manifest names: the stack, each part's stack and the fragments. */
export const manifestEntries = (manifest: Manifest): ReadonlyArray<EntryRef> => [
  ...(manifest.stack ? [manifest.stack] : []),
  ...(manifest.parts ?? []).map((part) => part.stack),
  ...manifest.fragments,
];

/**
 * The body of a `new` or `add` event. Official fragments are listed first, and the manifest's
 * fingerprint is reported only when every entry, part stacks included, is official.
 */
export function scaffoldEvent(input: ScaffoldFacts) {
  const { manifest } = input;
  const entries = manifestEntries(manifest);
  const origin = officialOrigin(entries);
  return defined({
    type: input.type,
    stack: manifest.stack ? publicId(manifest.stack) : "custom",
    fragments: [...manifest.fragments]
      .sort((a, b) => Number(official(b)) - Number(official(a)))
      .map(publicId),
    without: input.without.map(publicId),
    preset: manifest.preset,
    targetAgents: manifest.agents,
    handoff: manifest.handoff?.kind ?? "print",
    source: input.source,
    origin,
    nonOfficial: nonOfficialCounts(entries),
    ...(entries.every(official) && manifest.fingerprint
      ? { fingerprint: manifest.fingerprint }
      : {}),
  });
}

/** Error tags reported by name; any other tag is reported as `other`. */
const KNOWN_ERROR_CODES: readonly string[] = [
  "ComposeConflict",
  "EntryInvalid",
  "TargetNotEmpty",
  "NotFound",
  "BadInput",
  "PermissionDenied",
  "Interrupted",
  "Defect",
];

function errorCode(code: string): TelemetryErrorEvent["code"] {
  return (
    KNOWN_ERROR_CODES.find((known): known is TelemetryErrorEvent["code"] => known === code) ??
    "other"
  );
}

/** The body of an `error` event; the stack is named only when it is official. */
export const errorEvent = (input: ErrorFacts) => ({
  type: "error" as const,
  command: input.command,
  code: errorCode(input.code),
  ...(input.stack && official(input.stack) ? { stack: input.stack.id } : {}),
});

/** A step's duration as the smallest bucket that holds it; events never carry exact timings. */
function durationBucket(ms: number): TelemetryVerifyEventV3["steps"][number]["duration"] {
  if (ms <= 5000) return "5s";
  if (ms <= 30000) return "30s";
  if (ms <= 120000) return "2m";
  if (ms <= 600000) return "10m";
  return "longer";
}

/** One verify step as reported: names the CLI didn't compose become `custom`. */
function stepFacts(step: RunStep, known: ReadonlySet<string>) {
  return defined({
    name: known.has(step.name) ? step.name : "custom",
    phase: step.phase,
    layer: step.layer,
    status: step.status,
    failureKind: step.failureKind,
    duration: durationBucket(step.durationMs),
  });
}

/** Seconds from an ISO time to a millisecond clock reading, never negative. */
const secondsSince = (from: string, to: number) => Math.max(0, (to - Date.parse(from)) / 1000);

/**
 * The body of a `verify` event. `project` is the project's telemetry link when it has one: it
 * supplies the known step names, the telemetry project id and the scaffold time. Without it every
 * step counts as changed and the run record's `secondsSinceCreated` stands in for the time since
 * scaffold.
 * `asked` is the number of questions listed in the project's NOTES file.
 */
export function verifyEvent(
  record: RunRecord,
  project: Project | undefined,
  now: number,
  asked?: number,
) {
  const known = new Set(project?.steps ?? []);
  return defined({
    type: "verify" as const,
    scope: record.scope,
    outcome: record.outcome,
    tamperCheck: record.tamperCheck,
    steps: record.steps.map((step) => stepFacts(step, known)),
    stepsChanged: project
      ? record.steps.filter((step) => !known.has(step.name)).length
      : record.steps.length,
    asked,
    secondsSinceScaffold: project
      ? secondsSince(project.scaffoldedAt, now)
      : record.secondsSinceCreated,
    ...(project ? { projectId: project.telemetryProjectId } : {}),
    ...(project?.firstTestPassAt
      ? {
          secondsToFirstTestPass: secondsSince(
            project.scaffoldedAt,
            Date.parse(project.firstTestPassAt),
          ),
        }
      : {}),
  });
}

/** Each field's downstream use; docs/reference/telemetry.md carries the same table. */
export const TELEMETRY_FIELD_CONSUMERS = {
  schemaVersion: "Selects the ingest schema",
  eventId: "makes delivery idempotent",
  type: "routes the event",
  installId: "counts distinct installs and applies per-install caps",
  projectId: "counts distinct projects",
  cliVersion: "Checks for a released version and counts use per release",
  os: "failure counts per platform",
  nodeMajor: "Failure counts per Node line",
  agent: "green rate per agent",
  sentAt: "retention windows",
  stack: "Projects and green rate per stack",
  fragments: "How often each fragment is attached",
  without: "How often default fragments are left out",
  preset: "Green rate per preset",
  targetAgents: "Share of projects per adapter target",
  handoff: "How the project was handed to an agent",
  source: "The `--source` attribution",
  origin: "how far the index reaches",
  nonOfficial: "Counts of user, project and other non-official entries",
  fingerprint: "Green rate per composition",
  kind: "Which entries people review",
  id: "Which entries people review",
  command: "Which of `new` or `add` failed",
  code: "failure spikes per release",
  scope: "Full or partial verify scope",
  outcome: "green rate",
  tamperCheck: "How much of verify's tamper check ran",
  steps: "step failures and environment blockage",
  stepsChanged: "changed-step share",
  secondsSinceScaffold: "Time to green",
  secondsToFirstTestPass: "Time to the first successful test command",
  asked: "Counts agent questions before verify",
  deps: "dependency trends",
} as const;
