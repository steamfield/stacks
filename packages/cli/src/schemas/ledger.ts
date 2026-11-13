import { DetectedAgent, RunRecord } from "@steamfield/stacks-format";
import { Schema } from "effect";

const LedgerResult = Schema.Literals(["pass", "partial", "fail", "infra"]);

/** A recorded build, wrapping the Run record contract unchanged. */
export const LedgerRecord = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  date: Schema.String,
  stack: Schema.String,
  with: Schema.Array(Schema.String),
  preset: Schema.String,
  agent: DetectedAgent,
  agentVersion: Schema.String,
  mode: Schema.Literals(["interactive", "headless"]),
  repoCommit: Schema.String,
  cli: Schema.String,
  fingerprint: Schema.String,
  briefWords: Schema.Number,
  result: LedgerResult,
  agentEnded: Schema.Literals(["exit", "error", "timeout"]),
  run: Schema.NullOr(RunRecord),
  verifyRuns: Schema.Number,
  minutesToGreen: Schema.NullOr(Schema.Number),
  minutesToFirstTest: Schema.NullOr(Schema.Number),
  agentMinutes: Schema.NullOr(Schema.Number),
  interventions: Schema.NullOr(Schema.Number),
  note: Schema.optionalKey(Schema.String),
  hooksFired: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
  continued: Schema.optionalKey(Schema.Boolean),
});
export type LedgerRecord = typeof LedgerRecord.Type;

/** What `list` (and `show`) report of a stack's latest record. */
export const LedgerLastRun = Schema.Struct({
  date: LedgerRecord.fields.date,
  result: LedgerRecord.fields.result,
  agent: LedgerRecord.fields.agent,
  preset: LedgerRecord.fields.preset,
  fingerprint: LedgerRecord.fields.fingerprint,
});
export type LedgerLastRun = typeof LedgerLastRun.Type;

/** Records are decoded separately so readers can skip newer or invalid records. */
export const Ledger = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  records: Schema.Array(Schema.Unknown),
});
export type Ledger = typeof Ledger.Type;
