/**
 * The shape of the run ledger, `registry/runs.json`, which ships inside the bundled registry.
 *
 * The ledger is the bundled stacks' evidence: each record is one maintainer run that took a stack
 * from scaffold to verify, with an agent or without one (`mode: "scaffold"`), and how it went.
 * `list` and `show` print a stack's latest record as its `lastRun`, and `validate` compares the
 * recorded fingerprints with the current content to note stacks whose proof is stale.
 * `core/ledger.ts` reads and appends records; the maintainer scripts write them.
 */
import { DetectedAgent, RunRecord } from "@steamfield/stacks-format";
import { Schema } from "effect";

/** `infra` is a run lost to the bench itself, such as an agent that errored before changing anything. */
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
  /** `scaffold` is a zero-edit run with no agent: scaffold, the brief's install, then verify. */
  mode: Schema.Literals(["interactive", "headless", "scaffold"]),
  repoCommit: Schema.String,
  cli: Schema.String,
  /** `proofFingerprint`: the stack's own content and verify steps. */
  fingerprint: Schema.String,
  /** The whole composition's `fingerprint`, shared fragments included, when it was recorded. */
  compositionFingerprint: Schema.optionalKey(Schema.String),
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

/**
 * The ledger file's envelope. Records stay unknown here and are decoded one by one as
 * `LedgerRecord`, so a reader can skip a record from a newer CLI or a broken one and keep the rest.
 */
export const Ledger = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  records: Schema.Array(Schema.Unknown),
});
export type Ledger = typeof Ledger.Type;
