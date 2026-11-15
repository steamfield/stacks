/**
 * The shape of what `stacks runs --json` prints: a summary of one project's own verify history.
 *
 * Verify appends a run record to `.stacks/state/runs.jsonl` each time it runs, and the state
 * record (kept outside the project) holds the first-green times. `core/runs.ts::projectRuns`
 * reads both, plus the `## Asked` list in `.stacks/NOTES.md` (`interventions`), into this summary.
 * `skippedLines` counts history lines it couldn't decode.
 */
import { Schema } from "effect";
import { NoticeFields } from "./notice";

export const ProjectRuns = Schema.Struct({
  ...NoticeFields,
  /** Null for a project `add` created without a stack. */
  stack: Schema.NullOr(Schema.String),
  fingerprint: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  handoff: Schema.optionalKey(Schema.String),
  briefWords: Schema.Number,
  verifyRuns: Schema.Number,
  lastOutcome: Schema.NullOr(Schema.String),
  minutesToGreen: Schema.NullOr(Schema.Number),
  /** Run-completion proxy for the first successful test-layer command; no runner counts observed. */
  minutesToFirstTest: Schema.NullOr(Schema.Number),
  interventions: Schema.NullOr(Schema.Number),
  stateRecord: Schema.Boolean,
  skippedLines: Schema.Number,
});
export type ProjectRuns = typeof ProjectRuns.Type;
