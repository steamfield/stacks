import {
  AgentId,
  Category,
  FailureKind,
  GitHubLogin,
  Harness,
  Kind,
  Outcome,
  Phase,
  StatsDay,
  StatsWindow,
  StepLayer,
  TamperCheck,
} from "@steamfield/stacks-format";
import { Schema } from "effect";

// CLI-only wire shapes; e2e/schema-drift.test.ts compares them with stacks schema.
const Origin = Schema.Literals(["project", "user", "index", "bundled"]);
const NoticeFields = { notice: Schema.optionalKey(Schema.String) };
const LastRun = Schema.Struct({
  date: Schema.String,
  result: Schema.Literals(["pass", "partial", "fail", "infra"]),
  agent: Schema.Literals([...AgentId.literals, "other", "none"]),
  preset: Schema.String,
  fingerprint: Schema.String,
});

export const ListRow = Schema.Struct({
  id: Schema.String,
  kind: Kind,
  name: Schema.String,
  description: Schema.String,
  tags: Schema.Array(Schema.String),
  category: Schema.optionalKey(Category),
  appliesTo: Schema.optionalKey(Schema.Array(Schema.String)),
  origin: Origin,
  trusted: Schema.Boolean,
  shadows: Schema.Array(Origin),
  author: Schema.optionalKey(GitHubLogin),
  lastRun: Schema.NullOr(LastRun),
  stats: Schema.optionalKey(
    Schema.Struct({
      window: StatsWindow,
      through: StatsDay,
      population: Schema.Literals(["stacks projects", "seeded development data"]),
      projects: Schema.NullOr(Schema.Number),
      greenRate: Schema.NullOr(Schema.Number),
      greenRateLower: Schema.NullOr(Schema.Number),
      greenRateUpper: Schema.NullOr(Schema.Number),
      sample: Schema.NullOr(Schema.Number),
      noVerifyShare: Schema.NullOr(Schema.Number),
      medianMinutesToGreen: Schema.NullOr(Schema.Number),
    }),
  ),
});
export type ListRow = typeof ListRow.Type;

export const ListResult = Schema.Struct({
  ...NoticeFields,
  project: Schema.optionalKey(
    Schema.Struct({
      stack: Schema.NullOr(Schema.String),
      applied: Schema.Array(Schema.String),
      addable: Schema.Array(Schema.String),
    }),
  ),
  entries: Schema.Array(ListRow),
  rejected: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Kind,
      origin: Origin,
      dir: Schema.String,
      error: Schema.String,
    }),
  ),
}).annotate({
  title: "List result",
  description: "Stacks and fragments an agent can choose from, and entries that failed to load",
});
export type ListResult = typeof ListResult.Type;

const EntryRef = Schema.Struct({ kind: Kind, id: Schema.String });

export const NewResult = Schema.Struct({
  ...NoticeFields,
  project: Schema.String,
  dryRun: Schema.Boolean,
  fingerprint: Schema.String,
  stack: Schema.String,
  fragments: Schema.Array(Schema.String),
  preset: Schema.Literals(["default", "sandbox"]),
  agents: Schema.Array(AgentId),
  written: Schema.Array(Schema.String),
  brief: Schema.Literal(".stacks/BRIEF.md"),
  briefWords: Schema.Number,
  fixedWords: Schema.Number,
  missingTools: Schema.Array(
    Schema.Struct({
      tool: Schema.String,
      owners: Schema.Array(EntryRef),
      drop: Schema.Array(
        Schema.Struct({ id: Schema.String, flag: Schema.Literals(["without", "with"]) }),
      ),
    }),
  ),
  untrusted: Schema.Array(
    Schema.Struct({ id: Schema.String, kind: Kind, origin: Origin, dir: Schema.String }),
  ),
  warnings: Schema.Array(
    Schema.Struct({
      code: Schema.Literals([
        "always_not_applicable",
        "always_unknown",
        "with_not_applicable",
        "without_not_selected",
        "git_init_failed",
        "git_unusable",
      ]),
      id: Schema.String,
      exitCode: Schema.optionalKey(Schema.Number),
    }),
  ),
  git: Schema.Literals(["fresh", "parent", "none"]),
  stateRecord: Schema.Boolean,
  handoff: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("inside-agent"),
      agent: Schema.Union([AgentId, Schema.Literal("other")]),
      untrusted: Schema.Array(Schema.String),
      prompt: Schema.String,
    }),
    Schema.Struct({
      kind: Schema.Literal("print"),
      reason: Schema.Literals([
        "json",
        "no-launch",
        "not-a-terminal",
        "untrusted",
        "no-agent-found",
        "agent-not-found",
        "not-chosen",
      ]),
      agent: Schema.optionalKey(Harness),
      untrusted: Schema.Array(Schema.String),
      prompt: Schema.String,
    }),
  ]),
}).annotate({
  title: "New result",
  description: "A project stacks wrote or planned, with its brief and the next step",
});
export type NewResult = typeof NewResult.Type;

export const StepResult = Schema.Struct({
  name: Schema.String,
  phase: Phase,
  layer: Schema.optionalKey(StepLayer),
  command: Schema.String,
  status: Schema.Literals(["passed", "failed", "skipped"]),
  failureKind: Schema.optionalKey(FailureKind),
  exitCode: Schema.optionalKey(Schema.Number),
  durationMs: Schema.Number,
  reason: Schema.optionalKey(Schema.String),
  note: Schema.optionalKey(Schema.String),
  outputTail: Schema.optionalKey(Schema.String),
});
export type StepResult = typeof StepResult.Type;

export const VerifyChange = Schema.Struct({
  against: Schema.Literals(["manifest", "state-record"]),
  reason: Schema.Literals(["digest", "project-id"]),
  removed: Schema.Array(Schema.String),
  added: Schema.Array(Schema.String),
  edited: Schema.Array(Schema.String),
  settings: Schema.Boolean,
});
export type VerifyChange = typeof VerifyChange.Type;

export const VerifyResult = Schema.Struct({
  ...NoticeFields,
  outcome: Outcome,
  stages: Schema.optionalKey(Schema.Struct({ base: Outcome, app: Schema.NullOr(Outcome) })),
  scope: Schema.Literals(["full", "partial"]),
  steps: Schema.Array(StepResult),
  totals: Schema.Struct({
    passed: Schema.Number,
    failed: Schema.Number,
    skipped: Schema.Number,
  }),
  durationMs: Schema.Number,
  secondsSinceCreated: Schema.Number,
  tamperCheck: TamperCheck,
  changed: Schema.optionalKey(VerifyChange),
  firstGreen: Schema.Boolean,
  stateRecord: Schema.Boolean,
});
export type VerifyResult = typeof VerifyResult.Type;

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

export const CliErrorEnvelope = Schema.Struct({
  error: Schema.Struct({
    tag: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
    next: Schema.optionalKey(Schema.String),
    details: Schema.optionalKey(Schema.Unknown),
  }),
});
export type CliErrorEnvelope = typeof CliErrorEnvelope.Type;
