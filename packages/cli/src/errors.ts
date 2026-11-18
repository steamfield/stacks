/**
 * Defines CLI error tags and their public details. Fixed messages let callers
 * match failures, while closed details hold CLI-produced values or caller arguments.
 * A new tag needs its class, an entry in `errorClasses`, and a case in `failureGuide`.
 */
import { FailureKind, Kind } from "@steamfield/stacks-format";
import { Effect, Record as EffectRecord, Schema } from "effect";
import { defined } from "./core/object";
import { Origin } from "./schemas/origin";
import { VerifyChange, VerifyResult } from "./schemas/verify";

// ---------------------------------------------------------------------------------------------
// Error classes and their details
// ---------------------------------------------------------------------------------------------

/**
 * Why a command line was rejected, one shape per case:
 * - a parser-rejected value: the flag or argument, the value, what was expected, and optionally
 *   the command path and close known values;
 * - an unknown flag: the flag, its command, and close flags or labeled positional arguments;
 * - an unknown subcommand: what was typed and up to three close names (`closest`);
 * - two flags that can't be used together, as typed (`new --launch` with `--no-launch`).
 */
export const UsageDetails = Schema.Union([
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
export class Usage extends Schema.TaggedError<Usage>()("Usage", {
  details: Schema.optionalKey(UsageDetails),
}) {
  static readonly exit = 2;
  override readonly message = "Invalid command.";
}

/** One validation finding that blocks a `submit`: where it is, never its text. */
export const SubmissionBlocker = Schema.Struct({
  kind: Kind,
  id: Schema.String,
  check: Schema.String,
  severity: Schema.Literals(["error", "warning"]),
  file: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(Schema.Number),
});

/**
 * Input the parser accepted but the command can't use. `flag` says which input it was about.
 *
 * Shapes with their own fields:
 * - `request`: a search request, by its trimmed `length` only; `limit`: the rejected `value`.
 * - `offline`: `update` (or the `command` named) under `--offline` or `STACKS_OFFLINE=1`, refused
 *   before any request.
 * - `submit`'s cases: `repo`, a `--repo` that isn't `owner/name` or that GitHub doesn't have;
 *   `tool`, `gh` or `git` missing from PATH, or `gh` not logged in; `submission`, the entries that
 *   didn't meet the readiness bar; `collision`, an id the submission can't take (with
 *   `removed: true`, one the upstream registry removed, refused for everyone since ids are never
 *   reused; with `removed: false`, one the registry has that `authors.json` doesn't give to this
 *   login; `owner` when `authors.json` names one); `unchanged`, entries identical upstream;
 *   `git_identity`, a commit git refused because no author name or email is configured;
 *   `branch_taken`, a fork `branch` holding commits `submit` didn't make (found before the push
 *   or by the push's lease), so it isn't replaced.
 *
 * Every other `flag` comes with `id`, the argument the input was wrong about:
 * - `scope`: a `--scope` value that isn't an npm scope.
 * - `with_without`: a fragment id given to both `--with` and `--without`.
 * - `dir`: a project directory whose name has a control character.
 * - `brief`: a flag (`--with`, `--without` or `--sandbox`, in `id`) that `validate` takes only
 *   with `--brief`.
 * - `only`: a `verify --only` name that is no check or serve step; `known` lists those steps.
 * - `name`, `author`: a naming flag with a control character; `name` also rejects double quotes
 *   and backslashes.
 * - `fragment`: an add request for a stack or for fragments already applied (`alreadyApplied`).
 * - `agents`, `sandbox`: add flags that disagree with the manifest.
 * - `create_shadows`: an existing id, with its winning and shadowed origins in `origins`.
 * - `submit_entry`: an id both a stack and a fragment use in the user registry, or a directory
 *   that holds no single entry; `submit_id`: an id, given or a directory's name, that isn't
 *   kebab-case.
 */
export const BadInputDetails = Schema.Union([
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
      "payload",
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
export class BadInput extends Schema.TaggedError<BadInput>()("BadInput", {
  details: Schema.optionalKey(BadInputDetails),
}) {
  static readonly exit = 2;
  override readonly message = "Invalid input.";
}

/**
 * Something looked up wasn't there.
 * - `suggestions`: up to three known ids close to the one given (`closest`).
 * - `id` and `kind`: the stack or fragment id that wasn't found, so a caller can tell a wrong stack
 *   from a wrong `--with`/`--without` id.
 * - `kind: "project"` (no `id`): `verify` found no `.stacks/manifest.json` walking up from
 *   `looked`. `kind: "cwd"`: the working directory was removed after the shell entered it, so no
 *   command ran.
 * - `looked`: the path a lookup expected to find (validate's path argument).
 * - `root`: the registry root an id was looked up in when it isn't the usual set
 *   (`validate <root> --brief`).
 */
export const NotFoundDetails = Schema.Struct({
  suggestions: Schema.Array(Schema.String),
  id: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.Literals([...Kind.literals, "project", "cwd"])),
  looked: Schema.optionalKey(Schema.String),
  root: Schema.optionalKey(Schema.String),
  /** A missing bundled asset directory (skill install). */
  path: Schema.optionalKey(Schema.String),
  /**
   * `submit`: an id not in the user registry while the working directory has a folder by that
   * name, as the `./<name>` path that would submit it.
   */
  directory: Schema.optionalKey(Schema.String),
});
export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  details: Schema.optionalKey(NotFoundDetails),
}) {
  static readonly exit = 2;
  override readonly message = "Not found.";
}

export class NotConfigured extends Schema.TaggedError<NotConfigured>()("NotConfigured", {}) {
  static readonly exit = 3;
  override readonly message = "Configuration is required.";
}

/**
 * `path`: the file that didn't decode, such as `.stacks/manifest.json`.
 * `schemaVersion`: the version a newer stacks wrote, when that is why it didn't decode.
 */
export const InvalidConfigDetails = Schema.Struct({
  path: Schema.String,
  schemaVersion: Schema.optionalKey(Schema.Number),
});
export class InvalidConfig extends Schema.TaggedError<InvalidConfig>()("InvalidConfig", {
  details: Schema.optionalKey(InvalidConfigDetails),
}) {
  static readonly exit = 3;
  override readonly message = "Configuration is invalid.";
}

/** The service that failed; for GitHub, `step` says which of submit's requests it was. */
export const UpstreamUnavailableDetails = Schema.Struct({
  service: Schema.Literals(["npm-registry", "github"]),
  status: Schema.optionalKey(Schema.Number),
  step: Schema.optionalKey(Schema.Literals(["auth", "clone", "fork", "push", "pr"])),
});
/** The npm command `update` ran, and how it ended. */
export const UpdateFailedDetails = Schema.Struct({
  command: Schema.String,
  exitCode: Schema.optionalKey(Schema.Number),
  timedOut: Schema.optionalKey(Schema.Boolean),
});
export class UpdateFailed extends Schema.TaggedError<UpdateFailed>()("UpdateFailed", {
  details: Schema.optionalKey(UpdateFailedDetails),
}) {
  static readonly exit = 6;
  override readonly message = "Update failed.";
}
export class UpstreamUnavailable extends Schema.TaggedError<UpstreamUnavailable>()(
  "UpstreamUnavailable",
  { details: Schema.optionalKey(UpstreamUnavailableDetails) },
) {
  static readonly exit = 4;
  static readonly retryable = true;
  override readonly message = "Upstream service is unavailable.";
}

/** The failed steps, in run order: names, kinds and exit codes only, never their output. */
export const VerifyFailedDetails = Schema.Struct({
  failed: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      failureKind: FailureKind,
      exitCode: Schema.optionalKey(Schema.Number),
    }),
  ),
  /** The result's stage outcomes, so `next` points at the application section as the report does. */
  stages: VerifyResult.fields.stages,
});
export class VerifyFailed extends Schema.TaggedError<VerifyFailed>()("VerifyFailed", {
  details: Schema.optionalKey(VerifyFailedDetails),
}) {
  static readonly exit = 5;
  static readonly keepsResult = true;
  override readonly message = "Verify failed.";
}

/** What changed and against which copy: the same value as the verify result's `changed`. */
export const VerifyChangedDetails = VerifyChange;
export class VerifyChanged extends Schema.TaggedError<VerifyChanged>()("VerifyChanged", {
  details: Schema.optionalKey(VerifyChangedDetails),
}) {
  static readonly exit = 5;
  static readonly keepsResult = true;
  override readonly message = "Verify steps changed since they were recorded.";
}

/**
 * `reason` is a closed set; `path` is the file or directory involved.
 * - `escape`: a write would land outside the project (its real path isn't under the project's).
 * - `blocked`: a live file or directory blocks a planned add path; `path` is the blocker.
 * - `unwritable`: the project directory or a file in it couldn't be created or written.
 * - `agent`: an action reserved for a person was requested under a detected agent.
 * - `no-tty`: a confirmation was requested without a terminal on stdin (trust model, point 4).
 * - `state-unwritable`: the state record (`path`) couldn't be written, so nothing was confirmed.
 * - `launch`: the agent CLI `new` hands off to (`path`) was found but couldn't be executed.
 * - `github`: GitHub refused `submit`'s fork or push for the login `gh` uses.
 */
export const PermissionDeniedDetails = Schema.Struct({
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
export class PermissionDenied extends Schema.TaggedError<PermissionDenied>()("PermissionDenied", {
  details: Schema.optionalKey(PermissionDeniedDetails),
}) {
  static readonly exit = 6;
  override readonly message = "Permission denied.";
}

/** What is wrong with a `stacks:when` conditional marker in an entry file. */
export const ConditionalProblem = Schema.Literals([
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
export type ConditionalProblem = typeof ConditionalProblem.Type;

/**
 * An entry that can't be used: its frontmatter didn't decode, it contains a symlink, its `id`
 * differs from its directory name, a file is missing, a conditional block is malformed, a merged
 * file isn't JSON, a template sits on a merge path, or a template names an unknown variable
 * (`template`). `path` is the file or link involved, relative to the entry; `line` is a 1-based
 * line in that file; `problem` says what is wrong with a `conditional` marker.
 *
 * The `part_*` reasons are a workspace stack's parts list, refused at compose time; `part` names
 * the part and `step` the prefixed step involved:
 * - `part_stack`: a part names a stack the registry doesn't have.
 * - `part_role`: a part's role isn't one the CLI knows.
 * - `part_name_duplicate`: two parts share a name.
 * - `part_nested`: a part is the workspace itself or another workspace.
 * - `part_roles`: the parts' roles break the contract (no `api` part, or two of one role).
 * - `part_cwd`: a step's `cwd` escapes the part's directory.
 */
export const EntryInvalidDetails = Schema.Struct({
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
    "part_stack",
    "part_role",
    "part_name_duplicate",
    "part_nested",
    "part_roles",
    "part_cwd",
  ]),
  path: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(Schema.Number),
  problem: Schema.optionalKey(ConditionalProblem),
  part: Schema.optionalKey(Schema.String),
  step: Schema.optionalKey(Schema.String),
});
export class EntryInvalid extends Schema.TaggedError<EntryInvalid>()("EntryInvalid", {
  details: Schema.optionalKey(EntryInvalidDetails),
}) {
  static readonly exit = 2;
  override readonly message = "Entry is invalid.";
}

/**
 * The selected entries can't be composed.
 * - `stack` is present when the stack is one of the parties (it always reads first). A stack and a
 *   fragment may share an id, so the stack never appears in `ids`.
 * - `ids` names the fragments involved, in the order the reason reads (the requirer before what it
 *   requires; a cycle in order).
 * - `path`, `step` and `key` name the file, verify step or env key two entries disagree on.
 * - `needs_own_repo`: `path` is the enclosing repository's root and `fix` lists the `--without`
 *   flags that would leave every such fragment out (empty when no `--without` can).
 * - `file_owner` also covers two planned paths that differ only in letter case, and a file at a
 *   path another planned file needs as a directory.
 * - `reserved_path`: an entry file under `.git` or `.stacks` (any segment, any case), which the
 *   CLI owns.
 * - `parts` names the workspace parts of the mounted parties, in party order.
 */
export const ComposeConflictDetails = Schema.Struct({
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
  parts: Schema.optionalKey(Schema.Array(Schema.String)),
});
export class ComposeConflict extends Schema.TaggedError<ComposeConflict>()("ComposeConflict", {
  details: Schema.optionalKey(ComposeConflictDetails),
}) {
  static readonly exit = 2;
  override readonly message = "These entries can't be composed.";
}

/**
 * `new` refuses a directory holding anything besides `.git` and OS litter. `path` is the target;
 * `entries` names up to ten of what is in it, sorted, litter excluded. `scaffold` is set when the
 * target already holds `.stacks/manifest.json`: `green` once its state record has
 * `firstGreenAt`, else `unfinished`. `skill install` reuses this tag for its own target.
 */
export const TargetNotEmptyDetails = Schema.Struct({
  path: Schema.String,
  entries: Schema.Array(Schema.String),
  scaffold: Schema.optionalKey(Schema.Literals(["unfinished", "green"])),
  /** skill install cannot replace a directory or other non-regular SKILL.md, even with --force. */
  blocker: Schema.optionalKey(Schema.Literal("non-file")),
});
export class TargetNotEmpty extends Schema.TaggedError<TargetNotEmpty>()("TargetNotEmpty", {
  details: Schema.optionalKey(TargetNotEmptyDetails),
}) {
  static readonly exit = 2;
  override readonly message = "The target directory is not empty.";
}

/** `validate` found at least one error finding; the report stays on stdout. Counts, not text. */
export const ValidationFailedDetails = Schema.Struct({
  errors: Schema.Number,
  warnings: Schema.Number,
});
export class ValidationFailed extends Schema.TaggedError<ValidationFailed>()("ValidationFailed", {
  details: Schema.optionalKey(ValidationFailedDetails),
}) {
  static readonly exit = 2;
  static readonly keepsResult = true;
  override readonly message = "Validation failed.";
}

export class Interrupted extends Schema.TaggedError<Interrupted>()("Interrupted", {}) {
  static readonly exit = 130;
  override readonly message = "Command interrupted.";
}
export class Defect extends Schema.TaggedError<Defect>()("Defect", {}) {
  static readonly exit = 1;
  override readonly message = "An unexpected error occurred.";
}
export class BrokenPipe extends Schema.TaggedError<BrokenPipe>()("BrokenPipe", {}) {
  static readonly exit = 0;
  override readonly message = "Output pipe closed.";
}

/**
 * No process could start: the cwd is missing or not a directory (`cwd`), `/bin/sh` is missing
 * (`shell`), a binary run without a shell is missing or not executable (`command`), or the system
 * refused a new process (`resources`). `errno` is the system's code, such as `ENOENT`. A command
 * that isn't installed under `/bin/sh -c` is not this: the shell runs and exits 127. Internal and
 * outside `AppError`, so it reaches `main` as a `Defect` unless the caller handles it.
 */
export class SpawnFailed extends Schema.TaggedError<SpawnFailed>()("SpawnFailed", {
  kind: Schema.Literals(["cwd", "shell", "command", "resources"]),
  errno: Schema.String,
}) {
  override readonly message = "A process could not be started.";
}

// ---------------------------------------------------------------------------------------------
// The tag registry: exit codes, retryability, kept results
// ---------------------------------------------------------------------------------------------

export const errorClasses = {
  Usage,
  BadInput,
  NotFound,
  NotConfigured,
  InvalidConfig,
  UpstreamUnavailable,
  UpdateFailed,
  VerifyFailed,
  VerifyChanged,
  PermissionDenied,
  EntryInvalid,
  ComposeConflict,
  TargetNotEmpty,
  ValidationFailed,
  Interrupted,
  Defect,
  BrokenPipe,
} as const;
export type AppError = InstanceType<(typeof errorClasses)[keyof typeof errorClasses]>;

/**
 * Each tag's exit code, retryability, kept result and details schema, read from its class. Exit
 * codes are the branch an agent takes: 2 fix the input, 3 fix the config, 4 retry later, 5 read
 * the verify report, 6 ask a person, 130 the run was stopped, 1 a bug.
 */
export const errorTable = Object.freeze(
  EffectRecord.map(errorClasses, (Class) =>
    Object.freeze({
      exit: Class.exit,
      retryable: "retryable" in Class && Class.retryable,
      keepsResult: "keepsResult" in Class && Class.keepsResult,
      details: "details" in Class.fields ? Class.fields.details.schema : undefined,
    }),
  ),
);
export const ErrorTag = Schema.Literals(EffectRecord.keys(errorTable));
export const EXIT_INTERRUPTED = errorTable.Interrupted.exit;

export function exitCode(error: AppError): number {
  return errorTable[error._tag].exit;
}
export function retryable(error: AppError): boolean {
  return errorTable[error._tag].retryable;
}
export function keepsResult(error: AppError): boolean {
  return errorTable[error._tag].keepsResult;
}
/** `value` as an `AppError` when it is an instance of one of `errorClasses`, else undefined. */
export function knownError(value: unknown): AppError | undefined {
  for (const Class of Object.values(errorClasses)) {
    if (value instanceof Class) return value;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// The JSON error envelope
// ---------------------------------------------------------------------------------------------

// Published anyOf order breaks ties between overlapping details in decoders.
const detailsOrder: ReadonlyArray<typeof ErrorTag.Type> = [
  "UpstreamUnavailable",
  "UpdateFailed",
  "Usage",
  "BadInput",
  "NotFound",
  "InvalidConfig",
  "VerifyFailed",
  "VerifyChanged",
  "PermissionDenied",
  "EntryInvalid",
  "ComposeConflict",
  "TargetNotEmpty",
  "ValidationFailed",
];
const envelopeDetails = Schema.Union(
  Array.from(
    new Set([...detailsOrder, ...ErrorTag.literals]),
    (tag) => errorTable[tag].details,
  ).filter((schema) => schema !== undefined),
);

/**
 * The one stderr line a `--json` failure ends with (`Output.error`). `next` is the failure's one
 * next action (`failureGuide`), the same text the text modes print after `Next:`; `details` is the
 * tag's closed details struct. `rollback` names paths whose restoration or removal did not finish.
 */
export const ErrorEnvelope = Schema.Struct({
  error: Schema.Struct({
    tag: ErrorTag,
    message: Schema.String,
    retryable: Schema.Boolean,
    next: Schema.optionalKey(Schema.String),
    rollback: Schema.optionalKey(Schema.Struct({ incomplete: Schema.Array(Schema.String) })),
    details: Schema.optionalKey(envelopeDetails),
  }),
}).annotate({
  title: "Error envelope",
  description: "The last stderr line of a failed --json command",
});
export type ErrorEnvelope = typeof ErrorEnvelope.Type;

// ErrorEnvelope keeps the published schema order. On the wire, details precede rollback
// and have already been encoded by the tag's own schema in encodeDetails.
const encodeEnvelope = Schema.encodeSync(
  Schema.Struct({
    error: ErrorEnvelope.fields.error.mapFields(({ rollback, ...fields }) => ({
      ...fields,
      details: Schema.optionalKey(Schema.Unknown),
      rollback,
    })),
  }),
);

class PreparedFailure {
  readonly error: AppError;
  readonly #details: unknown;

  private constructor(error: AppError, details: unknown) {
    this.error = error;
    this.#details = details;
  }

  static prepare = Effect.fn("errors.prepareFailure")(function* (error: AppError) {
    const details = yield* encodeDetails(error);
    return new PreparedFailure(error, details);
  });

  renderEnvelope(next: string | undefined, rollback: ReadonlyArray<string>): string {
    const { error } = this;
    const details = this.#details;
    const envelope = encodeEnvelope({
      error: defined({
        tag: error._tag,
        message: error.message,
        retryable: retryable(error),
        next,
        details,
        ...(rollback.length === 0 ? {} : { rollback: { incomplete: rollback } }),
      }),
    });
    return `${JSON.stringify(envelope)}\n`;
  }
}

export type { PreparedFailure };
export const prepareFailure = PreparedFailure.prepare;

/**
 * A failure's details, encoded with the tag's details schema. Construction already drops keys
 * the schema doesn't name; this catches a details object mutated afterwards.
 */
function encodeDetails(error: AppError): Effect.Effect<unknown, Schema.SchemaError> {
  const schema = errorTable[error._tag].details;
  if (schema === undefined || !("details" in error) || error.details === undefined)
    return Effect.succeed(undefined);
  return Schema.encodeUnknownEffect(schema)(error.details, { onExcessProperty: "error" });
}
