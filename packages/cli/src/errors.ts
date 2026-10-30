import { FailureKind, Kind } from "@steamfield/stacks-format";
import { Effect, Schema } from "effect";
import { TEMPLATE_VARIABLES } from "./core/scaffold/template";
import { shellArg } from "./core/shell";
import { printable } from "./core/text";
import { verifyNext } from "./core/verify/next";
import { BRIEF_PATH, MANIFEST_PATH } from "./project-layout";
import { Origin } from "./schemas/origin";
import { VerifyChange, VerifyResult } from "./schemas/verify";
/**
 * An unknown subcommand: what was typed and up to three close known names (`core/suggest.ts`).
 * Or two flags that can't be used together, as typed (`new --launch` with `--no-launch`, 1.4).
 * Or a parser-rejected value, with its expected input and optional close known values.
 * Or an unknown flag, its command and close flags or labeled positional arguments.
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
  override readonly message = "Invalid command.";
}
/**
 * `id`: the argument the input was wrong about. `flag` says which input it is: `scope`, a
 * `--scope` value that isn't an npm scope; `with_without`, a fragment id given to both `--with`
 * and `--without`; `dir`, a project directory whose name has a control character; `brief`, a
 * flag (`--with`, `--without`, `--sandbox`, in `id`) that `validate` takes only with `--brief`;
 * `only`, a `verify --only` name that is no check or serve step, with those steps' names in
 * `known` (1.3a); `name` or `author`, a naming flag with an unsupported control character;
 * `name` also rejects double quotes and backslashes.
 * `fragment` is an add request for a stack or an applied fragment (listed in `alreadyApplied`);
 * `agents` and `sandbox` are add flags that disagree with the manifest.
 * `create_shadows` names an existing id, with its winning and shadowed origins in `origins`.
 * Search's `request` carries only its trimmed `length`; `limit` carries the rejected `value`.
 * `offline` is `update` (or the `command` named) under `--offline` or `STACKS_OFFLINE=1`, refused
 * before any request.
 * `submit`'s own cases: `repo`, a `--repo` that isn't `owner/name` or that GitHub doesn't have;
 * `tool`, `gh` or `git` missing from PATH, or `gh` not logged in; `submission`, the entries that
 * didn't meet the readiness bar, as the blocking findings' locations (never their text);
 * `collision`, an id the upstream registry already has or removed, which `authors.json` doesn't
 * give to this login (`owner` when it names another); `unchanged`, entries identical upstream;
 * `git_identity`, a commit git refused because no author name or email is configured.
 * `submit_entry` (with `id`) is an id both a stack and a fragment use in the user registry, or a
 * directory that holds no single entry; `submit_id` is an id, given or a directory's name, that
 * isn't kebab-case.
 * `branch_taken`: the fork's pull request `branch` has a commit `submit` didn't make, so it isn't
 * replaced.
 */
export const SubmissionBlocker = Schema.Struct({
  kind: Kind,
  id: Schema.String,
  check: Schema.String,
  severity: Schema.Literals(["error", "warning"]),
  file: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(Schema.Number),
});
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
  override readonly message = "Invalid input.";
}
/**
 * Up to three known ids close to the one given, from `core/suggest.ts::closest`; `looked` is the
 * path a lookup expected to find (validate's path argument, 1.5); `root` is the registry root an
 * id was looked up in when it isn't the usual set (`validate <root> --brief`).
 */
/**
 * `id` and `kind`: the stack or fragment id that wasn't found, so a caller can tell a wrong stack
 * from a wrong `--with`/`--without` id. `kind: "project"` (1.3a, with no `id`): `verify` found no
 * `.stacks/manifest.json` walking up from `looked`.
 */
export const NotFoundDetails = Schema.Struct({
  suggestions: Schema.Array(Schema.String),
  id: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.Literals([...Kind.literals, "project"])),
  looked: Schema.optionalKey(Schema.String),
  root: Schema.optionalKey(Schema.String),
  /** A missing bundled asset directory (skill install). */
  path: Schema.optionalKey(Schema.String),
});
export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  details: Schema.optionalKey(NotFoundDetails),
}) {
  override readonly message = "Not found.";
}
export class NotConfigured extends Schema.TaggedError<NotConfigured>()("NotConfigured", {}) {
  override readonly message = "Configuration is required.";
}
/**
 * `path`: the file that didn't decode, such as `.stacks/manifest.json` (1.2b).
 * `schemaVersion`: the version a newer stacks wrote, when that is why it didn't decode.
 */
export const InvalidConfigDetails = Schema.Struct({
  path: Schema.String,
  schemaVersion: Schema.optionalKey(Schema.Number),
});
export class InvalidConfig extends Schema.TaggedError<InvalidConfig>()("InvalidConfig", {
  details: Schema.optionalKey(InvalidConfigDetails),
}) {
  override readonly message = "Configuration is invalid.";
}
/** `step`: for GitHub, which of submit's requests failed. */
export const UpstreamUnavailableDetails = Schema.Struct({
  service: Schema.Literals(["npm-registry", "github"]),
  status: Schema.optionalKey(Schema.Number),
  step: Schema.optionalKey(Schema.Literals(["auth", "clone", "fork", "push", "pr"])),
});
export const UpdateFailedDetails = Schema.Struct({
  command: Schema.String,
  exitCode: Schema.optionalKey(Schema.Number),
  timedOut: Schema.optionalKey(Schema.Boolean),
});
export class UpdateFailed extends Schema.TaggedError<UpdateFailed>()("UpdateFailed", {
  details: Schema.optionalKey(UpdateFailedDetails),
}) {
  override readonly message = "Update failed.";
}
export class UpstreamUnavailable extends Schema.TaggedError<UpstreamUnavailable>()(
  "UpstreamUnavailable",
  { details: Schema.optionalKey(UpstreamUnavailableDetails) },
) {
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
  override readonly message = "Verify failed.";
}
/** What changed and against which copy: the same value as the verify result's `changed`. */
export const VerifyChangedDetails = VerifyChange;
export class VerifyChanged extends Schema.TaggedError<VerifyChanged>()("VerifyChanged", {
  details: Schema.optionalKey(VerifyChangedDetails),
}) {
  override readonly message = "Verify steps changed since they were recorded.";
}
/**
 * `reason` is a closed set; `path` is the file or directory involved.
 * `escape`: a write would land outside the project (its real path isn't under the project's).
 * `blocked`: a live file or directory blocks a planned add path; `path` is the blocker.
 * `unwritable`: the project directory or a file in it couldn't be created or written.
 * `agent`: an action reserved for a person was requested under a detected agent.
 * `no-tty`: a confirmation was requested without a terminal on stdin (Trust model, point 4).
 * `state-unwritable`: the state record (`path`) couldn't be written, so nothing was confirmed.
 * `launch`: the agent CLI `new` hands off to (`path`) was found but couldn't be executed (1.4).
 * `github`: GitHub refused `submit`'s fork or push for the login `gh` uses.
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
  override readonly message = "Permission denied.";
}
/**
 * An entry that can't be used: its frontmatter didn't decode, it contains a symlink, its `id`
 * differs from its directory name, a file is missing, a conditional block is malformed, a merged
 * file isn't JSON, a template sits on a merge path, or a template names an unknown variable
 * (`template`). `path` is the file or link involved,
 * relative to the entry; `line` is a 1-based line in that file; `problem` says what is wrong with a
 * `conditional` marker.
 */
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
  ]),
  path: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(Schema.Number),
  problem: Schema.optionalKey(ConditionalProblem),
});
export class EntryInvalid extends Schema.TaggedError<EntryInvalid>()("EntryInvalid", {
  details: Schema.optionalKey(EntryInvalidDetails),
}) {
  override readonly message = "Entry is invalid.";
}
/**
 * The selected entries can't be composed. `stack` is present when the stack is one of the parties
 * (it always reads first); `ids` names the fragments involved, in the order the reason reads (the
 * requirer before what it requires; a cycle in order). A stack and a fragment may share an id, so
 * the stack never appears in `ids`. `path`, `step` and `key` name the file, verify step or env key
 * two entries disagree on. For `needs_own_repo`, `path` is the enclosing repository's root and
 * `fix` lists the `--without` flags that would leave every such fragment out (empty when no
 * `--without` can). `file_owner` is also two planned paths that differ only in letter case, or a
 * file at a path another planned file needs as a directory. `reserved_path` is an entry file under
 * `.git` or `.stacks` (any segment, any case), which the CLI owns.
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
});
export class ComposeConflict extends Schema.TaggedError<ComposeConflict>()("ComposeConflict", {
  details: Schema.optionalKey(ComposeConflictDetails),
}) {
  override readonly message = "These entries can't be composed.";
}
/**
 * `new` refuses a directory holding anything besides `.git` and OS litter. `path` is the target;
 * `entries` names up to ten of what is in it, sorted, litter excluded. `scaffold` is set when the
 * target already holds `.stacks/manifest.json`: `green` once its state record has
 * `firstGreenAt`, else `unfinished`.
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
  override readonly message = "Validation failed.";
}
export class Interrupted extends Schema.TaggedError<Interrupted>()("Interrupted", {}) {
  override readonly message = "Command interrupted.";
}
export class Defect extends Schema.TaggedError<Defect>()("Defect", {}) {
  override readonly message = "An unexpected error occurred.";
}
export class BrokenPipe extends Schema.TaggedError<BrokenPipe>()("BrokenPipe", {}) {
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
/** Every error class main reports; a unit test keeps it equal to `errorTable`'s keys. */
export const errorClasses = [
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
] as const;
export type AppError = InstanceType<(typeof errorClasses)[number]>;
/** Every tag, for the envelope's schema. A unit test keeps it equal to `errorTable`'s keys. */
export const ErrorTag = Schema.Literals([
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
type ErrorSpec = { exit: number; retryable: boolean; keepsResult: boolean };
/** Exit code, retryability and whether a failure keeps the command's result on stdout. */
export const errorTable = {
  Usage: { exit: 2, retryable: false, keepsResult: false },
  BadInput: { exit: 2, retryable: false, keepsResult: false },
  NotFound: { exit: 2, retryable: false, keepsResult: false },
  NotConfigured: { exit: 3, retryable: false, keepsResult: false },
  InvalidConfig: { exit: 3, retryable: false, keepsResult: false },
  UpstreamUnavailable: { exit: 4, retryable: true, keepsResult: false },
  UpdateFailed: { exit: 6, retryable: false, keepsResult: false },
  VerifyFailed: { exit: 5, retryable: false, keepsResult: true },
  VerifyChanged: { exit: 5, retryable: false, keepsResult: true },
  PermissionDenied: { exit: 6, retryable: false, keepsResult: false },
  EntryInvalid: { exit: 2, retryable: false, keepsResult: false },
  ComposeConflict: { exit: 2, retryable: false, keepsResult: false },
  TargetNotEmpty: { exit: 2, retryable: false, keepsResult: false },
  ValidationFailed: { exit: 2, retryable: false, keepsResult: true },
  Interrupted: { exit: 130, retryable: false, keepsResult: false },
  Defect: { exit: 1, retryable: false, keepsResult: false },
  BrokenPipe: { exit: 0, retryable: false, keepsResult: false },
} as const satisfies Record<AppError["_tag"], ErrorSpec> & Record<typeof ErrorTag.Type, ErrorSpec>;
export function exitCode(error: AppError): number {
  return errorTable[error._tag].exit;
}
export function retryable(error: AppError): boolean {
  return errorTable[error._tag].retryable;
}
export function keepsResult(error: AppError): boolean {
  return errorTable[error._tag].keepsResult;
}
export function knownError(value: unknown): AppError | undefined {
  return errorClasses.some((Class) => value instanceof Class) ? (value as AppError) : undefined;
}
/**
 * What a failure tells its reader beyond the fixed message: `lines`, one per detail field worth
 * showing, and `next`, the one action to take, without a `Next:` prefix. Text modes print the lines
 * and then `Next: <next>`; the JSON envelope carries `next`. A keeps-result failure's report ends
 * with its own `Next:` line, so text modes don't print `next` for it (`Output.error`).
 */
export type FailureGuide = { lines: string[]; next?: string };
const guide = (lines: string[], next?: string): FailureGuide =>
  next === undefined ? { lines } : { lines, next };

/** The guide for `error`. `invocation` is `Host.invocation`, for commands quoted in it. */
export function failureGuide(error: AppError, invocation: string): FailureGuide {
  switch (error._tag) {
    case "Usage":
      return usageGuide(error, invocation);
    case "PermissionDenied":
      return permissionGuide(error);
    case "TargetNotEmpty":
      return targetGuide(error, invocation);
    case "BadInput":
      return error.details
        ? badInputGuide(error.details, invocation)
        : guide([], `run ${invocation} --help for the command's flags.`);
    case "NotFound":
      return notFoundGuide(error, invocation);
    // The report on stdout ends with these counts already; `--json` keeps them in details.
    case "ValidationFailed":
      return guide(
        [],
        `fix the error findings in the report on stdout, then run ${invocation} validate again.`,
      );
    case "EntryInvalid":
      return entryGuide(error, invocation);
    case "ComposeConflict":
      return composeGuide(error, invocation);
    case "InvalidConfig":
      return configGuide(error, invocation);
    case "VerifyFailed":
      return verifyFailedGuide(error, invocation);
    case "VerifyChanged":
      return guide(
        error.details ? changeLines(error.details) : [],
        verifyNext("changed", invocation),
      );
    case "NotConfigured":
      return guide([], `run ${invocation} doctor to see the configuration it reads.`);
    case "UpstreamUnavailable":
      return guide(
        error.details ? upstreamLines(error.details) : [],
        "wait a moment, then run the same command again.",
      );
    case "UpdateFailed":
      return guide(
        [
          ...(error.details?.exitCode === undefined ? [] : [`npm exit: ${error.details.exitCode}`]),
          ...(error.details?.timedOut ? ["npm timed out."] : []),
        ],
        `run ${error.details?.command ?? "the npm install"} yourself to see npm's output.`,
      );
    case "Interrupted":
      return guide([], "run the same command again when you're ready.");
    case "Defect":
      return guide(
        [],
        "set STACKS_LOG_FILE to a file path and run the command again; the file records where it failed. Report it if it repeats.",
      );
    case "BrokenPipe":
      return guide([]);
  }
}
function upstreamLines(details: typeof UpstreamUnavailableDetails.Type): string[] {
  return [
    `Service: ${details.service === "github" ? "GitHub" : "npm registry"}`,
    ...(details.step === undefined ? [] : [`Step: ${details.step}`]),
    ...(details.status === undefined ? [] : [`Status: ${details.status}`]),
  ];
}
function usageGuide(error: Usage, invocation: string): FailureGuide {
  const details = error.details;
  if (details && "flags" in details)
    return guide(
      [`${details.flags[0]} and ${details.flags[1]} can't be used together.`],
      "drop one of them.",
    );
  if (details && "value" in details) return invalidValueGuide(details, invocation);
  if (details && "flag" in details) return unknownFlagGuide(details, invocation);
  return guide(
    [
      ...(details?.command === undefined ? [] : [`Command: ${printable(details.command)}`]),
      ...(details?.suggestions.length
        ? [`Did you mean: ${details.suggestions.map(printable).join(", ")}?`]
        : []),
    ],
    `run ${invocation} --help to list the commands, or ${invocation} <command> --help for one.`,
  );
}

function invalidValueGuide(
  details: Extract<typeof UsageDetails.Type, { value: string }>,
  invocation: string,
): FailureGuide {
  // A flag arrives with its dashes (`--agents`); a positional argument by its bare name.
  const positional = !details.flag.startsWith("-");
  const command =
    details.command && details.command !== "stacks"
      ? `${invocation} ${details.command}`
      : invocation;
  return guide(
    [
      `${positional ? "Argument" : "Flag"}: ${printable(details.flag)}`,
      `Value: ${printable(details.value)}`,
      `Expected: ${printable(details.expected)}`,
      ...(details.suggestions?.length
        ? [`Did you mean: ${details.suggestions.map(printable).join(", ")}?`]
        : []),
    ],
    `pass a value from Expected; ${printable(command)} --help lists every ${positional ? "argument" : "flag"}.`,
  );
}

function unknownFlagGuide(
  details: Extract<typeof UsageDetails.Type, { flag: string; command: string }>,
  invocation: string,
): FailureGuide {
  const command = details.command === "stacks" ? invocation : `${invocation} ${details.command}`;
  return guide(
    [
      `Flag: ${printable(details.flag)}`,
      `Command: ${printable(details.command)}`,
      ...(details.suggestions.length
        ? [`Did you mean: ${details.suggestions.map(printable).join(", ")}?`]
        : []),
    ],
    `run ${printable(command)} --help to list the flags and arguments.`,
  );
}

function permissionGuide(error: PermissionDenied): FailureGuide {
  const details = error.details;
  if (!details)
    return guide(
      [],
      "check the permissions on the files this command reads and writes, then run it again.",
    );
  const why = permissionReason(details.reason);
  return guide(
    [...(details.path ? [`Path: ${printable(details.path)}`] : []), ...why.lines],
    why.next,
  );
}

function targetGuide(error: TargetNotEmpty, invocation: string): FailureGuide {
  const details = error.details;
  if (!details) return guide([], "pick a directory that doesn't exist yet or is empty.");
  const next = targetNext(details, invocation);
  return guide(
    [
      `Path: ${printable(details.path)}`,
      ...(details.entries.length ? [`Contains: ${details.entries.map(printable).join(", ")}`] : []),
      ...next.lines,
    ],
    next.next,
  );
}

function notFoundGuide(error: NotFound, invocation: string): FailureGuide {
  // `looked` means a path was missing (validate); `root`, an id missing from a registry root
  // `list` doesn't read; otherwise an id missing from the registries `list` shows.
  const details = error.details;
  if (!details) return guide([], `run ${invocation} list to see what exists.`);
  if (details.path)
    return guide(
      [`Path: ${printable(details.path)}`],
      `restore the bundled skill directory or reinstall @steamfield/stacks, then run ${invocation} doctor.`,
    );
  if (details.kind === "project")
    return guide(
      [
        `Looked for: ${MANIFEST_PATH} in ${printable(details.looked ?? ".")} and every directory above it`,
      ],
      `run this command again from inside a project ${invocation} new created, or create one with ${invocation} new <stack> <dir>.`,
    );
  return guide(
    [
      ...(details.looked ? [`Looked for: ${printable(details.looked)}`] : []),
      ...(details.id !== undefined
        ? [`${entryKindLabel(details.kind)}: ${printable(details.id)}`]
        : []),
      ...(details.suggestions.length
        ? [`Did you mean: ${details.suggestions.map(printable).join(", ")}?`]
        : []),
    ],
    notFoundNext(details, invocation),
  );
}

function entryGuide(error: EntryInvalid, invocation: string): FailureGuide {
  const details = error.details;
  if (!details) return guide([], `run ${invocation} validate to list every problem.`);
  const line = details.line === undefined ? "" : `:${details.line}`;
  return guide(
    [
      `Entry: ${printable(details.id)} (${details.origin}, ${details.reason})`,
      ...(details.path ? [`Path: ${printable(details.path)}${line}`] : []),
      ...(details.problem ? [`Problem: ${details.problem}`] : []),
    ],
    details.reason === "template"
      ? `use only ${TEMPLATE_VARIABLES.join(", ")} in that file's {{ }} tokens, or drop its .tmpl suffix to copy it as is.`
      : `fix that entry or leave it out; ${invocation} validate lists every problem in a registry.`,
  );
}

function composeGuide(error: ComposeConflict, invocation: string): FailureGuide {
  const details = error.details;
  if (!details) return guide([], `run ${invocation} show <id> to see what each entry requires.`);
  const next = composeNext(details, invocation);
  return guide(
    [
      `Reason: ${details.reason}`,
      ...(details.stack ? [`Stack: ${printable(details.stack)}`] : []),
      ...(details.ids.length ? [`Fragments: ${details.ids.map(printable).join(", ")}`] : []),
      ...(details.path
        ? [
            `${details.reason === "needs_own_repo" ? "Repository" : "Path"}: ${printable(details.path)}`,
          ]
        : []),
      ...(details.step ? [`Step: ${printable(details.step)}`] : []),
      ...(details.key ? [`Key: ${printable(details.key)}`] : []),
      ...next.lines,
    ],
    next.next,
  );
}

function configGuide(error: InvalidConfig, invocation: string): FailureGuide {
  const details = error.details;
  if (!details) return guide([], `run ${invocation} doctor to see which file is invalid.`);
  if (details.schemaVersion !== undefined)
    return guide(
      [
        `Path: ${printable(details.path)}`,
        `Schema version: ${details.schemaVersion}, from a newer stacks.`,
      ],
      "upgrade @steamfield/stacks, then run this command again.",
    );
  return guide(
    [`Path: ${printable(details.path)}`],
    details.path.endsWith(MANIFEST_PATH)
      ? "restore that file from version control (it isn't edited by hand), then run this command again."
      : `fix that file so it matches the documented keys (${invocation} doctor shows the error), then run this command again.`,
  );
}

function verifyFailedGuide(error: VerifyFailed, invocation: string): FailureGuide {
  const failed = error.details?.failed ?? [];
  return guide(
    failed.length
      ? [
          `Failed: ${failed
            .map(
              (step) =>
                `${printable(step.name)} (${step.failureKind}${step.exitCode === undefined ? "" : `, exit ${step.exitCode}`})`,
            )
            .join(", ")}`,
        ]
      : [],
    verifyNext(
      "failed",
      invocation,
      failed.map((step) => step.failureKind),
      error.details?.stages,
    ),
  );
}

/** The human lines naming what changed; `--accept-changes` prints the same lines. */
export function changeLines(change: typeof VerifyChange.Type): string[] {
  const names = (label: string, list: ReadonlyArray<string>) =>
    list.length ? [`${label}: ${list.map(printable).join(", ")}`] : [];
  const items = [
    ...names("Edited", change.edited),
    ...names("Added", change.added),
    ...names("Removed", change.removed),
    ...(change.settings ? ["Settings: the manifest's env or preset changed"] : []),
  ];
  return [
    changeBaseline(change),
    ...(items.length
      ? items
      : ["Which steps changed is not itemized: there are no per-step digests to compare with."]),
  ];
}
function badInputGuide(details: typeof BadInputDetails.Type, invocation: string): FailureGuide {
  if (details.flag === "request")
    return guide(
      [`Request length: ${details.length}`],
      `run ${invocation} search with a request of 1 to 500 characters after trimming.`,
    );
  if (details.flag === "limit")
    return guide(
      [`Flag: --limit ${printable(details.value)}`],
      `run ${invocation} search with --limit from 1 to 20.`,
    );
  if (details.flag === "offline")
    return details.command === "submit"
      ? guide(
          ["submit needs GitHub, and offline mode makes no network requests."],
          `run ${invocation} submit without --offline and with STACKS_OFFLINE unset.`,
        )
      : guide(
          ["update needs the npm registry, and offline mode makes no network requests."],
          `run ${invocation} update without --offline and with STACKS_OFFLINE unset.`,
        );
  if (isSubmitDetails(details)) return submitGuide(details, invocation);
  const id = printable(details.id);
  switch (details.flag) {
    case "create_id":
      return guide(
        [`Id: ${id}`],
        "use a lowercase kebab-case id, with only letters and digits between hyphens.",
      );
    case "create_shadows":
      return guide(
        [`Id: ${id}`, `Origins: ${details.origins?.join(", ") ?? ""}`],
        `use --from ${details.origins?.[0] ?? "<origin>"} to start from a copy, or pick another id.`,
      );
    case "create_target":
      return guide([`Path: ${id}`], "edit the existing entry, or choose an unused id.");
    case "from":
      return guide([`Origin: ${id}`], "copy from bundled or project; user is the destination.");
    case "confirmation":
      return guide(
        ["The copy was declined. Nothing was changed."],
        "review the entry before copying it.",
      );
    case "fragment":
      return details.alreadyApplied?.length
        ? guide(
            [`Already applied: ${details.alreadyApplied.map(printable).join(", ")}`],
            `choose unapplied fragments with ${invocation} list.`,
          )
        : guide([`Id: ${id}`], `add takes fragments; use ${invocation} new for a stack.`);
    case "agents":
    case "sandbox":
      return guide(
        [`Flag: --${details.flag}`],
        "use the preset and agents recorded in the manifest.",
      );
    case "scope":
      return guide(
        [`Flag: --scope ${id}`],
        "pass an npm scope such as acme or @acme: lowercase, URL-safe, no /.",
      );
    case "source":
      return guide(["Flag: --source"], "pass web, docs, skill, cli or other.");
    case "with_without":
      return guide(
        [`Id: ${id}`, "Flags: --with and --without"],
        `name ${id} in only one of --with and --without.`,
      );
    case "name":
      return guide(
        [`Flag: --name ${id}`],
        "pass --name with a project name that has no control characters, double quotes or backslashes.",
      );
    case "author":
      return guide(
        [`Flag: --${details.flag} ${id}`],
        `pass --${details.flag} without control characters.`,
      );
    case "dir":
      return guide(
        [`Directory name: ${id}`],
        "pick a project directory whose name has no control characters.",
      );
    case "kind":
      return guide(
        [`Id: ${id}`, "Kinds: stack, fragment"],
        "select --kind stack or --kind fragment.",
      );
    case "brief_stack":
      return guide(
        [`Id: ${id}`],
        `--brief takes a stack; choose one with ${invocation} list stacks.`,
      );
    case "brief":
      return guide(
        [`Flag: ${id}`],
        "--with, --without and --sandbox need --brief <stack>; add it, or drop the flag.",
      );
    case "only":
      return guide(
        [
          `Flag: --only ${id}`,
          ...(details.known?.length
            ? [`Check and serve steps: ${details.known.map(printable).join(", ")}`]
            : ["This project has no check or serve steps."]),
        ],
        "pass --only names from that list; setup and teardown steps always run.",
      );
    case "submit_entry":
      return guide(
        [`Entry: ${id}`],
        "pass one entry directory (<root>/stacks/<id> or <root>/fragments/<id>) instead.",
      );
    case "submit_id":
      return guide(
        [`Id: ${id}`],
        "pass a lowercase kebab-case entry id from your user registry, or an entry directory as a path containing a / (./<id> in the current directory).",
      );
  }
}
const SUBMIT_FLAGS = [
  "repo",
  "tool",
  "submission",
  "collision",
  "unchanged",
  "git_identity",
  "branch_taken",
] as const;
type SubmitDetails = Extract<typeof BadInputDetails.Type, { flag: (typeof SUBMIT_FLAGS)[number] }>;
function isSubmitDetails(details: typeof BadInputDetails.Type): details is SubmitDetails {
  return (SUBMIT_FLAGS as ReadonlyArray<string>).includes(details.flag);
}
/** Blocking findings shown in text modes; the envelope's details keep every one. */
const SHOWN_BLOCKERS = 10;

function submitGuide(details: SubmitDetails, invocation: string): FailureGuide {
  switch (details.flag) {
    case "repo":
      return guide(
        [`Flag: --repo ${printable(details.value)}`],
        "pass --repo as owner/name of a GitHub repository you can read, or leave it out for steamfield/stacks.",
      );
    case "tool":
      return details.reason === "missing"
        ? guide(
            [`${details.tool} is not on PATH; submit opens the pull request with gh and git.`],
            `install ${details.tool === "gh" ? "the GitHub CLI (https://cli.github.com) and run gh auth login" : "git"}, then run ${invocation} submit again.`,
          )
        : guide(
            ["gh is not logged in to GitHub."],
            `run gh auth login, then run ${invocation} submit again.`,
          );
    case "submission":
      return guide(
        [
          ...details.blockers
            .slice(0, SHOWN_BLOCKERS)
            .map(
              (blocker) =>
                `Blocked: ${blocker.kind} ${printable(blocker.id)}: ${blocker.check} (${blocker.severity})${blocker.file === undefined ? "" : ` at ${printable(blocker.file)}${blocker.line === undefined ? "" : `:${blocker.line}`}`}`,
            ),
          ...(details.blockers.length > SHOWN_BLOCKERS
            ? [`And ${details.blockers.length - SHOWN_BLOCKERS} more.`]
            : []),
        ],
        `run ${invocation} validate <entry dir> --submission for each finding's message, fix them, then run ${invocation} submit again.`,
      );
    case "collision":
      return guide(
        [
          `${details.kind === "stack" ? "Stack" : "Fragment"}: ${printable(details.id)}`,
          details.removed
            ? "The registry removed this id, and ids are never reused."
            : "The registry already has this id.",
          ...(details.owner === undefined
            ? []
            : [`authors.json gives it to @${printable(details.owner)}.`]),
        ],
        "pick another id for your entry (ids are permanent), or ask its author to submit the change.",
      );
    case "unchanged":
      return guide(
        ["The upstream registry already holds these entries exactly as submitted."],
        "change the entry first, or leave it out of the submission.",
      );
    case "git_identity":
      return guide(
        ["git refused the commit because no author name or email is set."],
        `run git config --global user.name and git config --global user.email, then run ${invocation} submit again.`,
      );
    case "branch_taken":
      return guide(
        [
          `Branch: ${printable(details.branch)}`,
          "The pull request branch on your fork has commits from someone else.",
        ],
        `update that pull request by hand, or ask a registry maintainer to; ${invocation} submit only replaces a branch it pushed itself.`,
      );
  }
}
/**
 * The one stderr line a `--json` failure ends with (`Output.error`). `next` is the failure's one
 * next action (`failureGuide`), the same text the text modes print after `Next:`; `details` is the
 * tag's closed details struct.
 */
export const ErrorEnvelope = Schema.Struct({
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
}).annotate({
  title: "Error envelope",
  description: "The last stderr line of a failed --json command",
});
export type ErrorEnvelope = typeof ErrorEnvelope.Type;
const encodeClosed = <S extends Schema.Top>(schema: S, value: S["Type"] | undefined) =>
  value === undefined
    ? Effect.succeed(undefined)
    : Schema.encodeUnknownEffect(schema)(value, { onExcessProperty: "error" });
/**
 * A failure's details, encoded with the tag's details schema. Construction already drops keys
 * the schema doesn't name; this catches a details object mutated afterwards.
 */
export function encodeDetails(error: AppError): Effect.Effect<unknown, Schema.SchemaError> {
  switch (error._tag) {
    case "Usage":
      return encodeClosed(UsageDetails, error.details);
    case "PermissionDenied":
      return encodeClosed(PermissionDeniedDetails, error.details);
    case "EntryInvalid":
      return encodeClosed(EntryInvalidDetails, error.details);
    case "BadInput":
      return encodeClosed(BadInputDetails, error.details);
    case "NotFound":
      return encodeClosed(NotFoundDetails, error.details);
    case "ComposeConflict":
      return encodeClosed(ComposeConflictDetails, error.details);
    case "TargetNotEmpty":
      return encodeClosed(TargetNotEmptyDetails, error.details);
    case "ValidationFailed":
      return encodeClosed(ValidationFailedDetails, error.details);
    case "InvalidConfig":
      return encodeClosed(InvalidConfigDetails, error.details);
    case "VerifyFailed":
      return encodeClosed(VerifyFailedDetails, error.details);
    case "VerifyChanged":
      return encodeClosed(VerifyChangedDetails, error.details);
    case "UpstreamUnavailable":
      return encodeClosed(UpstreamUnavailableDetails, error.details);
    case "UpdateFailed":
      return encodeClosed(UpdateFailedDetails, error.details);
    case "NotConfigured":
    case "Interrupted":
    case "Defect":
    case "BrokenPipe":
      return Effect.succeed(undefined);
  }
}

function permissionReason(reason: (typeof PermissionDeniedDetails.Type)["reason"]): FailureGuide {
  switch (reason) {
    case "read":
      return guide([], "check the path's read permissions, then run this command again.");
    case "escape":
      return guide(
        ["The path resolves outside the project directory, through a symlink or `..`."],
        "remove that symlink from the project directory, or pick another directory.",
      );
    case "blocked":
      return guide(
        [
          "A file or directory in the project is in the way of a planned path. Nothing was changed.",
        ],
        "move or rename the blocking item, then run add again.",
      );
    case "unwritable":
      return guide(
        ["The project directory or a file in it can't be written. Nothing was left behind."],
        "pick a directory you can write to, or fix this one's permissions.",
      );
    case "agent":
      return guide(
        ["This needs a person's confirmation, and an agent was detected. Nothing was changed."],
        "ask the user to run this command from their own terminal.",
      );
    case "no-tty":
      return guide(
        ["This needs a person's confirmation, and stdin is not a terminal. Nothing was changed."],
        "run this command from a terminal.",
      );
    case "state-unwritable":
      return guide(
        [
          "The state record outside the project can't be written, so nothing was confirmed or changed.",
        ],
        "make that directory writable (or set STACKS_STATE_DIR to one that is), then run this command again.",
      );
    case "launch":
      return guide(
        ["The agent CLI was found on PATH but can't be run by you. The project was written."],
        "fix the binary's permissions, or start your agent in the project yourself.",
      );
    case "github":
      return guide(
        ["GitHub refused to fork the repository or push the branch for the account gh uses."],
        "run gh auth status to see that account, log in with one that can fork the repository (gh auth login), then run submit again.",
      );
    // A write to stdout or stderr failed, so nothing can be shown anyway.
    case "write":
      return guide([]);
  }
}

function targetNext(details: typeof TargetNotEmptyDetails.Type, invocation: string): FailureGuide {
  // `skill install`'s target is `.claude/skills/<name>`; the default skill needs no name.
  const skill = /[/\\]\.claude[/\\]skills[/\\](stacks(?:-author)?)$/.exec(details.path)?.[1];
  const install = `${invocation} skill install${skill === "stacks-author" ? " stacks-author" : ""}`;
  if (details.blocker === "non-file")
    return guide(
      [],
      `move the item named ${details.entries[0] ?? "SKILL.md"} out of the target directory, or run ${install} --print to copy the skill elsewhere.`,
    );
  // `skill install`'s differing files; its details are only path and entries.
  if (skill !== undefined && details.entries.length > 0)
    return guide(
      [],
      `rerun ${install} with --force to replace ${details.entries.length > 1 ? "them" : "it"}, or --print to copy it elsewhere.`,
    );
  if (details.scaffold === "unfinished")
    return guide(
      ["Scaffold: unfinished. An earlier `new` wrote this."],
      `continue with ${BRIEF_PATH}, or remove the directory to start again.`,
    );
  if (details.scaffold === "green")
    return guide(
      ["Scaffold: green. This is a finished project."],
      `pick another directory for a new project, or extend this one with ${invocation} add.`,
    );
  return guide([], "pick a directory that doesn't exist yet or is empty.");
}

function entryKindLabel(kind: (typeof NotFoundDetails.Type)["kind"]): string {
  if (kind === "fragment") return "Fragment";
  if (kind === "stack") return "Stack";
  return "Id";
}
function notFoundNext(details: typeof NotFoundDetails.Type, invocation: string): string {
  if (details.looked)
    return "pass a registry root (a directory holding stacks/ or fragments/) or an entry directory inside one.";
  if (details.root)
    return `${invocation} validate ${shellArg(printable(details.root))} lists the ids under that root.`;
  return `run ${invocation} list to see every stack and fragment id.`;
}

function composeNext(
  details: typeof ComposeConflictDetails.Type,
  invocation: string,
): FailureGuide {
  if (details.reason === "needs_own_repo")
    return guide(
      [],
      details.fix?.length
        ? `run again with ${details.fix.map(printable).join(" ")}, or pick a directory outside that repository.`
        : "pick a directory outside that repository.",
    );
  if (details.reason === "reserved_path")
    return guide(
      [
        "The CLI owns .git/ and .stacks/ in a project; no entry may write under them, in any letter case.",
      ],
      "remove or rename that file in the entry.",
    );
  return guide(
    [],
    `change --with or --without so these entries fit, or pick another stack; ${invocation} show <id> lists what each entry requires and conflicts with.`,
  );
}

function changeBaseline(change: typeof VerifyChange.Type): string {
  if (change.reason === "project-id")
    return "Against: the state record for this project directory, which is kept under another projectId";
  if (change.against === "manifest") return "Against: the manifest's own verifyDigest";
  return "Against: the state record kept outside the project";
}
