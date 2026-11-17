/**
 * Renders the text summary for `stacks new`. Shared warnings and tool lines let `renderAdd`
 * describe the same conditions consistently.
 */
import type { NewResult } from "../../schemas/new";
import { type Audience, plainStyle, type Style } from "../../services/output";
import { collapsePaths } from "../brief/paths";
import { printable } from "../text";

/** Warnings the Git line already reports, so the Warnings list leaves them out. */
const GIT_WARNINGS: ReadonlyArray<string> = ["git_init_failed", "git_unusable"];

/** The text after `Git:`; a git failure is reported here rather than among the warnings. */
const gitLine = (result: Pick<NewResult, "warnings" | "git" | "dryRun">) => {
  if (result.dryRun && result.git === "fresh") return "would create a new repository";
  const failed = result.warnings.find((warning) => warning.code === "git_init_failed");
  if (failed) return `git init failed (exit ${failed.exitCode ?? "unknown"}); no repository`;
  const unusable = result.warnings.find((warning) => warning.code === "git_unusable");
  if (unusable)
    return `git couldn't tell whether this is inside a repository${unusable.exitCode === undefined ? "" : ` (exit ${unusable.exitCode})`}; none used. Run git status in the project to see git's error`;
  if (result.git === "fresh") return "new repository, nothing committed";
  if (result.git === "parent") return "part of an existing repository; nothing committed";
  return "git not found; no repository";
};

/** Render unknown warning codes as data. */
export const warningLine = (warning: { code: string; id: string }) => {
  const id = printable(warning.id);
  switch (warning.code) {
    case "always_not_applicable":
      return `${id} (from your always setting) doesn't apply to this stack; left out`;
    case "always_unknown":
      return `${id} (from your always setting) names no fragment; ignored`;
    case "with_not_applicable":
      return `--with ${id}: the fragment doesn't list this stack; added anyway`;
    case "without_not_selected":
      return `--without ${id}: it wasn't selected anyway`;
    case "git_init_failed":
    case "git_unusable":
      return `${warning.code}: see the Git line`;
    case "stack_unknown":
      return `the manifest's stack ${id} is in no registry; composed without it`;
    case "name_unreadable":
      return `couldn't read the project name from ${id}`;
    default:
      return `${printable(warning.code)}: ${id}`;
  }
};

export const missingLine = (item: NewResult["missingTools"][number]) => {
  const owners = item.owners.map((owner) => printable(owner.id)).join(", ");
  const skip = item.drop
    .map(({ id, flag }) =>
      flag === "with" ? `dropping --with ${printable(id)}` : `--without ${printable(id)}`,
    )
    .join(" and ");
  return `${printable(item.tool)} not found (needed by ${owners}${skip ? `; skip with ${skip}` : ""})`;
};

/**
 * Humans get the absolute project path and collapsed file listing. Agents can inspect the brief and
 * disk, but previews list planned files in both audiences because nothing was written.
 * Use `printable` on entry ids and file listings to escape terminal controls.
 */
export function renderNew(
  result: Omit<NewResult, "handoff">,
  context: { shown: string; audience: Audience; style?: Style },
): string {
  const human = context.audience === "human";
  const { style = plainStyle } = context;
  const lines = [
    `${result.dryRun ? "Planned" : "Created"} ${printable(context.shown)} from ${printable(result.stack)}${result.preset === "default" ? "" : ` (${result.preset})`}.`,
    // `shown` is the absolute path when the project isn't under the current directory.
    ...(human && context.shown !== result.project ? [`Project: ${printable(result.project)}`] : []),
    `Fragments: ${result.fragments.length ? result.fragments.map(printable).join(", ") : "none"}`,
    `Agents: ${result.agents.join(", ")}`,
    `Git: ${gitLine(result)}`,
    ...(human || result.dryRun
      ? [
          `${result.dryRun ? "Would write" : "Wrote"} ${result.written.length} files:`,
          ...collapsePaths(result.written).map((line) => `  ${printable(line)}`),
        ]
      : []),
    `Brief: ${result.brief} (${result.briefWords} words)`,
    ...(result.stateRecord || result.dryRun
      ? []
      : [
          "State record: not written (the state directory isn't writable), so verify's tamper check will use the manifest only.",
        ]),
  ];
  if (result.missingTools.length)
    lines.push(
      "Missing tools (the brief tells the agent):",
      ...result.missingTools.map((item) => `  ${missingLine(item)}`),
    );
  const warnings = result.warnings.filter((warning) => !GIT_WARNINGS.includes(warning.code));
  if (warnings.length)
    lines.push(
      style("warn", "Warnings:"),
      ...warnings.map((warning) => `  ${style("warn", warningLine(warning))}`),
    );
  if (result.untrusted.length)
    lines.push(
      "Untrusted entries (the brief makes the agent ask you before using them):",
      ...result.untrusted.map(
        (entry) =>
          `  ${entry.kind} ${printable(entry.id)} (${entry.origin}): ${printable(entry.dir)}`,
      ),
    );
  if (result.dryRun) lines.push("Dry run: nothing was written.");
  return lines.join("\n");
}
