/**
 * The shapes of what `stacks verify --json` prints: the result on stdout and the live events on
 * stderr.
 *
 * Verify runs the steps in the project's manifest (`.stacks/manifest.json`), the project's
 * definition of done, and reports whether the project is green. Before any step runs, it checks
 * that the steps haven't changed since the project was made ("Trust model" point 5 in
 * `.claude/rules/architecture.md`); `VerifyChange` says what differs when they have.
 * `core/verify/run.ts` builds the result (`core/verify/tamper.ts` for a `changed` run) and
 * `core/verify/events.ts` writes the events.
 */
import {
  FailureKind,
  Outcome,
  Phase,
  RunRecord,
  StepLayer,
  TamperCheck,
} from "@steamfield/stacks-format";
import { Schema } from "effect";
import { NoticeFields } from "./notice";

/** One step's outcome. `reason` and `note` are fixed CLI text; only `outputTail` is step output. */
export const StepResult = Schema.Struct({
  name: Schema.String,
  phase: Phase,
  layer: Schema.optionalKey(StepLayer),
  /** The step's `run`, as the manifest has it. */
  command: Schema.String,
  status: Schema.Literals(["passed", "failed", "skipped"]),
  /** Only on a failed step. */
  failureKind: Schema.optionalKey(FailureKind),
  /** The command's exit status, when it ran and exited. */
  exitCode: Schema.optionalKey(Schema.Number),
  durationMs: Schema.Number,
  /** Why it failed or was skipped. */
  reason: Schema.optionalKey(Schema.String),
  /** On a passed step: something worth knowing that didn't fail it. */
  note: Schema.optionalKey(Schema.String),
  /** A failed step's own output, its last `TAIL_LINES` lines. */
  outputTail: Schema.optionalKey(Schema.String),
});
export type StepResult = typeof StepResult.Type;

/**
 * How the verify steps differ from the copy they were checked against. `against` is the copy
 * that disagreed: the manifest's own `verifyDigest`, or the state record outside the project.
 * `reason: "project-id"` is a record found by the manifest's real path under another id. The step
 * lists and `settings` (`env` or `preset`) come from the state record's per-step digests, so they
 * are empty when there is no record to compare with.
 */
export const VerifyChange = Schema.Struct({
  against: Schema.Literals(["manifest", "state-record"]),
  reason: Schema.Literals(["digest", "project-id"]),
  removed: Schema.Array(Schema.String),
  added: Schema.Array(Schema.String),
  edited: Schema.Array(Schema.String),
  settings: Schema.Boolean,
});
export type VerifyChange = typeof VerifyChange.Type;

/**
 * `verify --json`'s result. `green` is a full run with every step that ran passing and the tamper
 * check passed; `partial` is a `--only` or `--skip-tag` run that passed, which never counts as
 * green; `changed` is a run stopped before any step because the steps changed.
 */
export const VerifyResult = Schema.Struct({
  ...NoticeFields,
  outcome: Outcome,
  /** Only for manifests with app-tagged steps; null means the app stage did not run. */
  stages: RunRecord.fields.stages,
  scope: Schema.Literals(["full", "partial"]),
  steps: Schema.Array(StepResult),
  totals: Schema.Struct({
    passed: Schema.Number,
    failed: Schema.Number,
    skipped: Schema.Number,
  }),
  durationMs: Schema.Number,
  /** Seconds from the manifest's `createdAt` to the end of this run. */
  secondsSinceCreated: Schema.Number,
  tamperCheck: TamperCheck,
  /** What changed: on a `changed` run, and on an `--accept-changes` run that accepted a change. */
  changed: Schema.optionalKey(VerifyChange),
  /** This run wrote the project's `firstGreenAt`. */
  firstGreen: Schema.Boolean,
  /**
   * The project's state record is current after this run: it was found (or created by
   * `--accept-changes`) and any timing field this run set was written. False when the check was
   * manifest-only or the record couldn't be written.
   */
  stateRecord: Schema.Boolean,
});
export type VerifyResult = typeof VerifyResult.Type;

/**
 * One stderr line `verify --json` writes while it runs (`Output.event`): `step-started` before a
 * step's command starts, `step-finished` when it ends. Skipped steps get no events; the result on
 * stdout lists every step. The error envelope, when there is one, is still the last stderr line.
 */
export const VerifyEvent = Schema.Union([
  Schema.Struct({
    event: Schema.Literal("step-started"),
    name: Schema.String,
    phase: Phase,
  }),
  Schema.Struct({
    event: Schema.Literal("step-finished"),
    name: Schema.String,
    phase: Phase,
    status: StepResult.fields.status,
    failureKind: Schema.optionalKey(FailureKind),
    durationMs: Schema.Number,
  }),
]).annotate({
  title: "Verify event",
  description: "A live stderr line from verify --json: a step started or finished",
});
export type VerifyEvent = typeof VerifyEvent.Type;
