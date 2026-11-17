import type {
  AppError,
  BadInputDetails,
  ComposeConflict,
  ComposeConflictDetails,
  EntryInvalid,
  InvalidConfig,
  NotFound,
  NotFoundDetails,
  PermissionDenied,
  PermissionDeniedDetails,
  SubmissionBlocker,
  TargetNotEmpty,
  TargetNotEmptyDetails,
  UpdateFailed,
  UpstreamUnavailableDetails,
  Usage,
  UsageDetails,
  VerifyFailed,
} from "../errors";
import { BRIEF_PATH, MANIFEST_PATH } from "../project-layout";
import type { VerifyChange } from "../schemas/verify";
import { shellArg } from "./shell";
import { TEMPLATE_VARIABLES } from "./template";
import { printable } from "./text";
import { verifyNext } from "./verify/next";

// ---------------------------------------------------------------------------------------------
// Failure guides: the lines and `Next:` action printed under the message
// ---------------------------------------------------------------------------------------------

/** Details worth displaying and the next action, without the display label. See `Output.error`. */
export type FailureGuide = { lines: string[]; next?: string };

const guide = (lines: string[], next?: string): FailureGuide =>
  next === undefined ? { lines } : { lines, next };

/** The `Did you mean:` line for close known names, or no line when there are none. */
const didYouMean = (suggestions: ReadonlyArray<string> | undefined): string[] =>
  suggestions?.length ? [`Did you mean: ${suggestions.map(printable).join(", ")}?`] : [];

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
      return updateFailedGuide(error);
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

function changeBaseline(change: typeof VerifyChange.Type): string {
  if (change.reason === "project-id")
    return "Against: the state record for this project directory, which is kept under another projectId";
  if (change.against === "manifest") return "Against: the manifest's own verifyDigest";
  return "Against: the state record kept outside the project";
}

function upstreamLines(details: typeof UpstreamUnavailableDetails.Type): string[] {
  return [
    `Service: ${details.service === "github" ? "GitHub" : "npm registry"}`,
    ...(details.step === undefined ? [] : [`Step: ${details.step}`]),
    ...(details.status === undefined ? [] : [`Status: ${details.status}`]),
  ];
}

function updateFailedGuide(error: UpdateFailed): FailureGuide {
  const details = error.details;
  return guide(
    [
      ...(details?.exitCode === undefined ? [] : [`npm exit: ${details.exitCode}`]),
      ...(details?.timedOut ? ["npm timed out."] : []),
    ],
    `run ${details?.command ?? "the npm install"} yourself to see npm's output.`,
  );
}

/** No detail lines: the verify report on stdout already lists each failed step. */
function verifyFailedGuide(error: VerifyFailed, invocation: string): FailureGuide {
  const failed = error.details?.failed ?? [];
  return guide(
    [],
    verifyNext(
      "failed",
      invocation,
      failed.map((step) => step.failureKind),
      error.details?.stages,
    ),
  );
}

// Usage

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
      ...didYouMean(details?.suggestions),
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
      ...didYouMean(details.suggestions),
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
      ...didYouMean(details.suggestions),
    ],
    `run ${printable(command)} --help to list the flags and arguments.`,
  );
}

// PermissionDenied

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

// TargetNotEmpty

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

/** The `new` and `skill install` cases of a non-empty target, told apart by the target path. */
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

// NotFound

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
  if (details.kind === "cwd")
    return guide(
      ["The working directory no longer exists."],
      "cd to a directory that exists, then run the command again.",
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
      ...didYouMean(details.suggestions),
    ],
    notFoundNext(details, invocation),
  );
}

function entryKindLabel(kind: (typeof NotFoundDetails.Type)["kind"]): string {
  if (kind === "fragment") return "Fragment";
  if (kind === "stack") return "Stack";
  return "Id";
}

function notFoundNext(details: typeof NotFoundDetails.Type, invocation: string): string {
  if (details.directory)
    return `pass ${printable(details.directory)} to submit that directory, or run ${invocation} list to see every stack and fragment id.`;
  if (details.looked)
    return "pass a registry root (a directory holding stacks/ or fragments/) or an entry directory inside one.";
  if (details.root)
    return `${invocation} validate ${shellArg(printable(details.root))} lists the ids under that root.`;
  return `run ${invocation} list to see every stack and fragment id.`;
}

// EntryInvalid, ComposeConflict, InvalidConfig

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

function composeNext(
  details: typeof ComposeConflictDetails.Type,
  invocation: string,
): FailureGuide {
  if (details.reason === "needs_own_repo")
    return guide(
      [],
      details.fix?.length
        ? `run again with --own-repo to give the project its own git repository inside that one, or with ${details.fix.map(printable).join(" ")} to leave those fragments out, or pick a directory outside that repository.`
        : "run again with --own-repo to give the project its own git repository inside that one, or pick a directory outside that repository.",
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

// BadInput

/** BadInput's three own-field shapes first, then submit's, then the `id`-carrying flags. */
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
  if (details.flag === "offline") return offlineGuide(details.command, invocation);
  if (isSubmitDetails(details)) return submitGuide(details, invocation);
  return idInputGuide(details, invocation);
}

function offlineGuide(command: "submit" | undefined, invocation: string): FailureGuide {
  return command === "submit"
    ? guide(
        ["submit needs GitHub, and offline mode makes no network requests."],
        `run ${invocation} submit without --offline and with STACKS_OFFLINE unset.`,
      )
    : guide(
        ["update needs the npm registry, and offline mode makes no network requests."],
        `run ${invocation} update without --offline and with STACKS_OFFLINE unset.`,
      );
}

/** The BadInput shapes that carry an `id`, apart from submit's `collision`. */
type IdInputDetails = Exclude<
  typeof BadInputDetails.Type,
  SubmitDetails | { flag: "request" | "limit" | "offline" }
>;

function idInputGuide(details: IdInputDetails, invocation: string): FailureGuide {
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
      return guide(
        [`Origin: ${id}`],
        "copy from bundled, index or project; user is the destination.",
      );
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
    case "payload":
      return guide(
        [`Flag: --payload ${id}`, "This stack ships no such payload variant."],
        "drop --payload to start from the stack's example; only stacks with a payloads/none/ directory offer --payload none.",
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

// BadInput from submit

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

/** `Blocked: <kind> <id>: <check> (<severity>)`, then ` at <file>[:<line>]` when known. */
function blockerLine(blocker: typeof SubmissionBlocker.Type): string {
  const line = blocker.line === undefined ? "" : `:${blocker.line}`;
  const where = blocker.file === undefined ? "" : ` at ${printable(blocker.file)}${line}`;
  return `Blocked: ${blocker.kind} ${printable(blocker.id)}: ${blocker.check} (${blocker.severity})${where}`;
}

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
          ...details.blockers.slice(0, SHOWN_BLOCKERS).map(blockerLine),
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
          `The pull request branch on your fork has commits ${invocation} submit didn't make.`,
        ],
        `update that pull request by hand, ask a registry maintainer to, or delete the branch on your fork to start over; ${invocation} submit only replaces a branch it pushed itself.`,
      );
  }
}
