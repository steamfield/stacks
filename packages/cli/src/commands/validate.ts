import { Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { shownPath } from "../core/shown-path";
import { validate } from "../core/validate/index";
import { previewBrief } from "../core/validate/preview";
import {
  renderPreview,
  renderPreviewBrief,
  renderPreviewErrors,
  renderReport,
} from "../core/validate/report";
import { resolveTarget, type Target } from "../core/validate/target";
import { BadInput, Usage, ValidationFailed } from "../errors";
import { BriefPreview, type Severity, ValidateReport } from "../schemas/validate";
import { Host } from "../services/host";
import { Output } from "../services/output";

/** Repeated flags, each value also split on commas: `--with a --with b,c`. */
const ids = (values: ReadonlyArray<string>) =>
  values.flatMap((value) => value.split(",")).filter((value) => value !== "");

function compositionFlag(flags: {
  with: ReadonlyArray<string>;
  without: ReadonlyArray<string>;
  sandbox: boolean;
}) {
  if (flags.with.length) return "--with";
  if (flags.without.length) return "--without";
  if (flags.sandbox) return "--sandbox";
  return undefined;
}

const printPreview = (target: Target, options: Parameters<typeof previewBrief>[1]) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const preview = yield* previewBrief(target, options);
    yield* output.result(Schema.encodeSync(BriefPreview)(preview), renderPreviewBrief(preview));
    if (output.audience === "human") yield* output.progress(renderPreview(preview));
    const count = (severity: Severity) =>
      preview.findings.filter((finding) => finding.severity === severity).length;
    if (count("error")) {
      // A closed diagnostic stream must not replace the kept-result validation failure.
      if (output.audience !== "json")
        yield* output.note(renderPreviewErrors(preview)).pipe(Effect.ignore);
      return yield* new ValidationFailed({
        details: { errors: count("error"), warnings: count("warning") },
      });
    }
  });

/** The flags checked against each other, then the target they apply to. */
const checkedTarget = (
  flags: Parameters<typeof compositionFlag>[0] & { submission: boolean },
  given: { path: string | undefined; stack: string | undefined },
) =>
  Effect.gen(function* () {
    // The composition flags shape a --brief preview; alone they would be silently ignored.
    const stray = compositionFlag(flags);
    if (given.stack === undefined && stray !== undefined)
      return yield* new BadInput({ details: { id: stray, flag: "brief" } });
    if (flags.submission && given.stack !== undefined)
      return yield* new Usage({ details: { flags: ["--submission", "--brief"] } });
    const target: Target = yield* resolveTarget(given.path);
    // Readiness is per entry: a submission is one entry directory.
    if (flags.submission && target.only === undefined)
      return yield* new Usage({
        details: {
          flag: "--submission",
          value: given.path ?? "",
          expected: "one entry directory, such as <root>/stacks/<id>",
        },
      });
    return target;
  });

export const validateCommand = Command.make(
  "validate",
  {
    path: Argument.String("path").pipe(
      Argument.withDescription(
        "A registry root (holding stacks/ or fragments/) or one entry directory inside one. Omit it to check the bundled registry.",
      ),
      Argument.optional,
    ),
    brief: Flag.String("brief").pipe(
      Flag.withDescription(
        "Print the brief this stack composes to, with its word counts, with findings. Rendered on the same fixed context the budget uses, so counts match on every machine. Writes nothing.",
      ),
      Flag.optional,
    ),
    with: Flag.String("with").pipe(
      Flag.withDescription(
        "With --brief: add an optional fragment or app. Repeatable or comma-separated.",
      ),
      Flag.atLeast(0),
    ),
    without: Flag.String("without").pipe(
      Flag.withDescription(
        "With --brief: leave out a default fragment. Repeatable or comma-separated.",
      ),
      Flag.atLeast(0),
    ),
    sandbox: Flag.Boolean("sandbox").pipe(
      Flag.withDescription("With --brief: render the sandbox preset."),
      Flag.withDefault(false),
    ),
    submission: Flag.Boolean("submission").pipe(
      Flag.withDescription(
        "Also check one entry directory is ready for the public registry: no stacks:fill markers left (fill-marker), no credential-shaped strings (secret) and no .env files besides .env.example (env-file) are errors; absolute home paths (absolute-path) and no search card (missing-card) are warnings. Not with --brief.",
      ),
      Flag.withDefault(false),
    ),
  },
  (flags) =>
    Effect.gen(function* () {
      const host = yield* Host;
      const output = yield* Output;
      const path = Option.getOrUndefined(flags.path);
      const stack = Option.getOrUndefined(flags.brief);
      const target = yield* checkedTarget(flags, { path, stack });
      if (stack !== undefined) {
        yield* printPreview(target, {
          stack,
          with: ids(flags.with),
          without: ids(flags.without),
          preset: flags.sandbox ? "sandbox" : "default",
        });
        return;
      }
      const report = yield* validate(target, { submission: flags.submission });
      const firstStack = report.findings.some((finding) => finding.severity === "error")
        ? undefined
        : report.sizes.find((row) => row.kind === "composed")?.entry;
      yield* output.result(
        Schema.encodeSync(ValidateReport)(report),
        renderReport(report, {
          invocation: host.invocation,
          path,
          firstStack,
          audience: output.audience,
          submission: flags.submission,
          root: output.audience === "agent" ? yield* shownPath(host.cwd, report.root) : report.root,
        }),
      );
      const count = (severity: Severity) =>
        report.findings.filter((finding) => finding.severity === severity).length;
      if (count("error"))
        return yield* new ValidationFailed({
          details: { errors: count("error"), warnings: count("warning") },
        });
    }),
).pipe(
  Command.withDescription(
    "Check stacks and fragments before an agent builds from them: frontmatter, references, conditional prose, compositions, verify layers (install, lint, typecheck, test) and word budgets. Reads files only. Exits 0 when there are no errors (warnings and notes don't fail), 2 on errors (ValidationFailed, with the report still on stdout), a path that is neither a registry nor an entry, --with, --without or --sandbox without --brief, --submission with --brief or without one entry directory, or a --brief composition that is unknown or conflicts, 3 on a broken config.json with --brief, 6 when the root can't be read, 130 when interrupted.",
  ),
  Command.withShortDescription("Check stacks and fragments, or preview a composed brief."),
  Command.withExamples(({ commandPath }) => [
    { command: commandPath.join(" "), description: "Check the bundled registry" },
    {
      command: `${commandPath.join(" ")} ~/.config/stacks/stacks/my-api --json`,
      description: "Check one entry and get the ValidateReport",
    },
    {
      command: `${commandPath.join(" ")} ~/.config/stacks/stacks/my-api --submission`,
      description: "Check one entry is ready to submit to the public registry",
    },
    {
      command: `${commandPath.join(" ")} --brief typescript-cli --sandbox`,
      description: "Print the brief a composition renders to, with its word count",
    },
  ]),
);
