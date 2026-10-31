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

const UsageDetails = Schema.Union([
  Schema.Struct({
    flag: Schema.String,
    value: Schema.String,
    expected: Schema.String,
    command: Schema.optionalKey(Schema.String),
    suggestions: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  Schema.Struct({
    flag: Schema.String,
    command: Schema.String,
    suggestions: Schema.Array(Schema.String),
  }),
  Schema.Struct({ command: Schema.String, suggestions: Schema.Array(Schema.String) }),
  Schema.Struct({ flags: Schema.Tuple([Schema.String, Schema.String]) }),
]);

const SubmissionBlocker = Schema.Struct({
  kind: Kind,
  id: Schema.String,
  check: Schema.String,
  severity: Schema.Literals(["error", "warning"]),
  file: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(Schema.Number),
});

const BadInputDetails = Schema.Union([
  Schema.Struct({ flag: Schema.Literal("request"), length: Schema.Int }),
  Schema.Struct({ flag: Schema.Literal("limit"), value: Schema.String }),
  Schema.Struct({
    flag: Schema.Literal("offline"),
    command: Schema.optionalKey(Schema.Literals(["submit"])),
  }),
  Schema.Struct({ flag: Schema.Literal("repo"), value: Schema.String }),
  Schema.Struct({
    flag: Schema.Literal("tool"),
    tool: Schema.Literals(["gh", "git"]),
    reason: Schema.Literals(["missing", "unauthenticated"]),
  }),
  Schema.Struct({ flag: Schema.Literal("submission"), blockers: Schema.Array(SubmissionBlocker) }),
  Schema.Struct({
    flag: Schema.Literal("collision"),
    kind: Kind,
    id: Schema.String,
    removed: Schema.Boolean,
    owner: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ flag: Schema.Literals(["unchanged", "git_identity"]) }),
  Schema.Struct({ flag: Schema.Literal("branch_taken"), branch: Schema.String }),
  Schema.Struct({
    id: Schema.String,
    flag: Schema.Literals([
      "scope",
      "source",
      "with_without",
      "dir",
      "brief",
      "brief_stack",
      "kind",
      "only",
      "name",
      "author",
      "fragment",
      "agents",
      "sandbox",
      "create_id",
      "create_target",
      "create_shadows",
      "from",
      "confirmation",
      "submit_entry",
      "submit_id",
    ]),
    known: Schema.optionalKey(Schema.Array(Schema.String)),
    alreadyApplied: Schema.optionalKey(Schema.Array(Schema.String)),
    origins: Schema.optionalKey(Schema.Array(Origin)),
  }),
]);

const NotFoundDetails = Schema.Struct({
  suggestions: Schema.Array(Schema.String),
  id: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.Literals([...Kind.literals, "project"])),
  looked: Schema.optionalKey(Schema.String),
  root: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
  directory: Schema.optionalKey(Schema.String),
});

const InvalidConfigDetails = Schema.Struct({
  path: Schema.String,
  schemaVersion: Schema.optionalKey(Schema.Number),
});

const UpstreamUnavailableDetails = Schema.Struct({
  service: Schema.Literals(["npm-registry", "github"]),
  status: Schema.optionalKey(Schema.Number),
  step: Schema.optionalKey(Schema.Literals(["auth", "clone", "fork", "push", "pr"])),
});

const UpdateFailedDetails = Schema.Struct({
  command: Schema.String,
  exitCode: Schema.optionalKey(Schema.Number),
  timedOut: Schema.optionalKey(Schema.Boolean),
});

const VerifyFailedDetails = Schema.Struct({
  failed: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      failureKind: FailureKind,
      exitCode: Schema.optionalKey(Schema.Number),
    }),
  ),
  stages: VerifyResult.fields.stages,
});

const VerifyChangedDetails = VerifyChange;

const PermissionDeniedDetails = Schema.Struct({
  reason: Schema.Literals([
    "write",
    "read",
    "escape",
    "unwritable",
    "blocked",
    "agent",
    "no-tty",
    "state-unwritable",
    "launch",
    "github",
  ]),
  path: Schema.optionalKey(Schema.String),
});

const ConditionalProblem = Schema.Literals([
  "unclosed",
  "nested",
  "stray_end",
  "unknown_key",
  "bad_value",
  "empty",
  "repeated",
  "unknown_marker",
  "not_alone",
]);

const EntryInvalidDetails = Schema.Struct({
  id: Schema.String,
  origin: Origin,
  reason: Schema.Literals([
    "decode",
    "symlink",
    "id_mismatch",
    "missing",
    "conditional",
    "merge_json",
    "merge_template",
    "template",
  ]),
  path: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(Schema.Number),
  problem: Schema.optionalKey(ConditionalProblem),
});

const ComposeConflictDetails = Schema.Struct({
  reason: Schema.Literals([
    "required",
    "requires",
    "cycle",
    "conflicts",
    "applies_to",
    "app_required",
    "app_count",
    "step_name",
    "file_owner",
    "env",
    "needs_own_repo",
    "reserved_path",
  ]),
  stack: Schema.optionalKey(Schema.String),
  ids: Schema.Array(Schema.String),
  path: Schema.optionalKey(Schema.String),
  step: Schema.optionalKey(Schema.String),
  key: Schema.optionalKey(Schema.String),
  fix: Schema.optionalKey(Schema.Array(Schema.String)),
});

const TargetNotEmptyDetails = Schema.Struct({
  path: Schema.String,
  entries: Schema.Array(Schema.String),
  scaffold: Schema.optionalKey(Schema.Literals(["unfinished", "green"])),
  blocker: Schema.optionalKey(Schema.Literal("non-file")),
});

const ValidationFailedDetails = Schema.Struct({
  errors: Schema.Number,
  warnings: Schema.Number,
});

const ErrorTag = Schema.Literals([
  "Usage",
  "BadInput",
  "NotFound",
  "NotConfigured",
  "InvalidConfig",
  "UpstreamUnavailable",
  "UpdateFailed",
  "VerifyFailed",
  "VerifyChanged",
  "PermissionDenied",
  "EntryInvalid",
  "ComposeConflict",
  "TargetNotEmpty",
  "ValidationFailed",
  "Interrupted",
  "Defect",
  "BrokenPipe",
]);

export const CliErrorEnvelope = Schema.Struct({
  error: Schema.Struct({
    tag: ErrorTag,
    message: Schema.String,
    retryable: Schema.Boolean,
    next: Schema.optionalKey(Schema.String),
    details: Schema.optionalKey(
      Schema.Union([
        UpstreamUnavailableDetails,
        UpdateFailedDetails,
        UsageDetails,
        BadInputDetails,
        NotFoundDetails,
        InvalidConfigDetails,
        VerifyFailedDetails,
        VerifyChangedDetails,
        PermissionDeniedDetails,
        EntryInvalidDetails,
        ComposeConflictDetails,
        TargetNotEmptyDetails,
        ValidationFailedDetails,
      ]),
    ),
  }),
});
export type CliErrorEnvelope = typeof CliErrorEnvelope.Type;
