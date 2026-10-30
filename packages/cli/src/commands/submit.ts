import { Effect, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { shellArg } from "../core/shell";
import { DEFAULT_REPO, type SubmitOptions, submit } from "../core/submit/submit";
import { printable } from "../core/text";
import { SubmitResult } from "../schemas/submit";
import { Host } from "../services/host";
import { Output } from "../services/output";

/** The same submission without `--dry-run`, for the dry run's `Next:` line. */
function rerun(invocation: string, options: SubmitOptions): string {
  return [
    `${invocation} submit`,
    ...options.entries.map(shellArg),
    ...options.queries.map((query) => `--query ${shellArg(query)}`),
    ...(options.repo === DEFAULT_REPO ? [] : [`--repo ${shellArg(options.repo)}`]),
  ].join(" ");
}

export function renderSubmit(
  result: SubmitResult,
  options: { invocation: string; given: SubmitOptions },
): string {
  const entries = result.entries
    .map((entry) => `${entry.kind} ${printable(entry.id)} (${entry.update ? "update" : "new"})`)
    .join(", ");
  const lines = [
    ...(result.dryRun ? ["Dry run: nothing was forked, pushed or opened."] : []),
    `${result.dryRun ? "Would submit" : "Submitted"} to ${printable(result.repo)} as @${printable(result.author)}: ${entries}`,
    `Branch: ${printable(result.branch)}`,
  ];
  if (result.prUrl !== null)
    lines.push(
      `Pull request: ${printable(result.prUrl)} (draft${result.reused ? "; the open one was updated" : ""})`,
    );
  lines.push("", "Files:", ...result.files.map((file) => `  ${printable(file)}`));
  const width = Math.max(0, ...result.findings.map((finding) => finding.check.length));
  if (result.findings.length)
    lines.push(
      "",
      "Findings:",
      ...result.findings.map(
        (finding) =>
          `  ${finding.severity.padEnd(7)}  ${printable(finding.check).padEnd(width)}  ${finding.file === undefined ? "" : `${printable(finding.file)}: `}${printable(finding.message)}`,
      ),
    );
  if (result.body !== undefined) lines.push("", "Pull request body:", "", result.body.trimEnd());
  lines.push(
    "",
    result.dryRun
      ? `Next: show the user this dry run; once they agree, run ${rerun(options.invocation, options.given)}`
      : `Next: a maintainer reviews the draft pull request; run the same command again to update it.`,
  );
  return lines.join("\n");
}

export const submitCommand = Command.make(
  "submit",
  {
    entries: Argument.String("entry").pipe(
      Argument.withDescription(
        "An entry directory (<root>/stacks/<id> or <root>/fragments/<id>; any argument with a / or starting with . or ~ is a path), or the kebab-case id of an entry in your user registry. Give several to submit a stack and the fragments it needs in one pull request.",
      ),
      Argument.atLeast(1),
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription(
        "Clone and check as usual, then print the checks, the files and the pull request body. Forks, pushes and opens nothing.",
      ),
      Flag.withDefault(false),
    ),
    query: Flag.String("query").pipe(
      Flag.withDescription(
        "A search request this entry should rank first for, proposed to maintainers in the pull request. Repeatable.",
      ),
      Flag.atLeast(0),
    ),
    repo: Flag.String("repo").pipe(
      Flag.withDescription(`The upstream repository, owner/name. Defaults to ${DEFAULT_REPO}.`),
      Flag.withDefault(DEFAULT_REPO),
    ),
  },
  (flags) =>
    Effect.gen(function* () {
      const given: SubmitOptions = {
        entries: flags.entries,
        dryRun: flags.dryRun,
        queries: flags.query,
        repo: flags.repo,
      };
      const result = yield* submit(given);
      const host = yield* Host;
      yield* (yield* Output).result(
        Schema.encodeSync(SubmitResult)(result),
        renderSubmit(result, { invocation: host.invocation, given }),
      );
    }),
).pipe(
  Command.withDescription(
    "Open a draft pull request adding your entries to the public registry, using the GitHub CLI (gh) and git; the CLI holds no credentials. Checks a partial clone of the upstream main branch first: references must resolve there, validate --submission must find no errors and no warnings beyond those maintainers clear (search-unreviewed, search-missing, missing-card, deps-missing, deps-unreviewed), and an existing or removed id is refused unless authors.json gives it to your login, which makes the pull request an update. Pushes branch entry/<kind>-<id> to your fork; a rerun updates the same branch and the pull request's title and body, and refuses a branch holding commits submit didn't make. The temporary clone is always removed. Show the user the --dry-run output before submitting. Exits 0 when submitted or dry-run; 2 for offline mode, gh or git missing, gh not logged in, a bad --repo, an entry that isn't found or fails the checks (BadInput, with the blocking findings in details), an id collision, a pull request branch with someone else's commits, or nothing changed; 4 when GitHub or git can't be reached (UpstreamUnavailable); 6 when GitHub refuses the fork or push for your login, or an entry can't be read (PermissionDenied); 130 when interrupted.",
  ),
  Command.withShortDescription("Open a draft pull request adding entries to the public registry."),
  Command.withExamples(({ commandPath }) => [
    {
      command: `${commandPath.join(" ")} ~/.config/stacks/stacks/my-api --dry-run`,
      description: "Check a stack against the upstream registry and print the pull request",
    },
    {
      command: `${commandPath.join(" ")} my-api my-lint --query "a REST API in Go"`,
      description: "Submit a stack and a fragment from your user registry in one pull request",
    },
  ]),
);
