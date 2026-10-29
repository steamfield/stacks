import type {
  EntryRef,
  Manifest,
  RunRecord,
  TelemetryErrorEvent,
  TelemetryEventV2,
  TelemetryNewEvent,
  TelemetryVerifyEvent,
} from "@steamfield/stacks-format";
import type { Entry } from "../core/registry/entry";
import type { Project } from "./storage";

export type ScaffoldFacts = {
  type: "new" | "add";
  manifest: Manifest;
  without: readonly EntryRef[];
  source?: TelemetryNewEvent["source"];
  steps: readonly string[];
};
export type ShowFacts = Pick<Entry, "kind" | "id" | "origin" | "trusted">;
export type ErrorFacts = {
  command: "new" | "add";
  code: string;
  stack?: Pick<Entry, "id" | "origin" | "trusted">;
};
export type Envelope = Pick<
  TelemetryEventV2,
  "schemaVersion" | "eventId" | "installId" | "cliVersion" | "os" | "nodeMajor" | "agent" | "sentAt"
>;
export const official = (entry: { origin: string; trusted?: boolean }) =>
  entry.trusted !== false && (entry.origin === "bundled" || entry.origin === "index");
export const publicId = (entry: { id: string; origin: string; trusted?: boolean }) =>
  official(entry) ? entry.id : "custom";

export function scaffoldEvent(input: ScaffoldFacts) {
  const { manifest } = input;
  const entries = [...(manifest.stack ? [manifest.stack] : []), ...manifest.fragments];
  const origins = new Set(entries.filter(official).map((entry) => entry.origin));
  const origin: TelemetryNewEvent["origin"] = origins.size > 1 ? "mixed" : undefined;
  const single: TelemetryNewEvent["origin"] = origins.has("bundled") ? "bundled" : undefined;
  const resolved = origin ?? single ?? (origins.has("index") ? "index" : undefined);
  const count = (origin: string) => entries.filter((entry) => entry.origin === origin).length;
  const sourceCount = entries.filter(
    (entry) => !official(entry) && !["user", "project"].includes(entry.origin),
  ).length;
  return {
    type: input.type,
    stack: manifest.stack ? publicId(manifest.stack) : "custom",
    fragments: [...manifest.fragments]
      .sort((a, b) => Number(official(b)) - Number(official(a)))
      .map(publicId),
    without: input.without.map(publicId),
    preset: manifest.preset,
    targetAgents: manifest.agents,
    handoff: manifest.handoff?.kind ?? "print",
    ...(input.source === undefined ? {} : { source: input.source }),
    ...(resolved === undefined ? {} : { origin: resolved }),
    nonOfficial: { user: count("user"), project: count("project"), source: sourceCount },
    ...(entries.every(official) && manifest.fingerprint
      ? { fingerprint: manifest.fingerprint }
      : {}),
  };
}
const codes: readonly string[] = [
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
  return codes.find((known): known is TelemetryErrorEvent["code"] => known === code) ?? "other";
}
export const errorEvent = (input: ErrorFacts) => ({
  type: "error" as const,
  command: input.command,
  code: errorCode(input.code),
  ...(input.stack && official(input.stack) ? { stack: input.stack.id } : {}),
});
function duration(ms: number): TelemetryVerifyEvent["steps"][number]["duration"] {
  if (ms <= 5000) return "5s";
  if (ms <= 30000) return "30s";
  if (ms <= 120000) return "2m";
  if (ms <= 600000) return "10m";
  return "longer";
}
export function verifyEvent(record: RunRecord, project: Project | undefined, now: number) {
  const known = new Set(project?.steps ?? []);
  return {
    type: "verify" as const,
    scope: record.scope,
    outcome: record.outcome,
    tamperCheck: record.tamperCheck,
    steps: record.steps.map((step) => ({
      name: known.has(step.name) ? step.name : "custom",
      phase: step.phase,
      ...(step.layer === undefined ? {} : { layer: step.layer }),
      status: step.status,
      ...(step.failureKind === undefined ? {} : { failureKind: step.failureKind }),
      duration: duration(step.durationMs),
    })),
    stepsChanged: project
      ? record.steps.filter((step) => !known.has(step.name)).length
      : record.steps.length,
    secondsSinceScaffold: project
      ? Math.max(0, (now - Date.parse(project.scaffoldedAt)) / 1000)
      : record.secondsSinceCreated,
    ...(project ? { projectId: project.telemetryProjectId } : {}),
    ...(project?.firstTestPassAt
      ? {
          secondsToFirstTestPass: Math.max(
            0,
            (Date.parse(project.firstTestPassAt) - Date.parse(project.scaffoldedAt)) / 1000,
          ),
        }
      : {}),
  };
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
  deps: "dependency trends",
} as const;
