/**
 * Renders the text summary for `stacks new`. Shared warnings and tool lines let `renderAdd`
 * describe the same conditions consistently.
 */
import type { NewResult } from "../../schemas/new";
import { type Audience, plainStyle, type Style } from "../../services/output";
import { VERSION } from "../../version";
import { collapsePaths } from "../brief/paths";
import type { Composition } from "../compose/types";
import { partsLine } from "../text/parts-line";
import { printable } from "../text/text";

/**
 * The workspace's parts as `new --json` lists them, in `parts` order; `undefined` for a
 * composition without parts, so `defined` leaves the key out.
 */
export const resultParts = (composition: Pick<Composition, "parts">): NewResult["parts"] =>
  composition.parts?.map(({ mount }) => ({
    name: mount.name,
    role: mount.role,
    stack: mount.stack,
  }));

/** The `Parts:` summary line for a workspace; no line for a single stack. */
const partLines = (parts: NewResult["parts"]): string[] => (parts ? [partsLine(parts)] : []);

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

type ReportWarning = Omit<NewResult["warnings"][number], "code"> & { code: string };

const indexWarningMessages = {
  timeout: "Index unreachable (timeout)",
  network: "Index unreachable (network)",
  not_found: "Index unreachable (not_found)",
  invalid: "Index invalid",
  signature: "Index signature failed",
  unsupported: "Index needs a newer stacks (run stacks update)",
  offline: "Offline",
} satisfies Record<NonNullable<ReportWarning["reason"]>, string>;

function indexAge(elapsedMs: number): string {
  const minutes = Math.floor(Math.max(0, elapsedMs) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function indexWarningLine(
  reason: NonNullable<ReportWarning["reason"]>,
  cachedAt?: string,
  now?: number,
) {
  const message = indexWarningMessages[reason];
  if (cachedAt === undefined)
    return `${message}; used the registry bundled with stacks ${VERSION}.`;
  const millis = Date.parse(cachedAt);
  if (!Number.isFinite(millis)) return `${message}; used the cached index.`;
  const date = new Date(millis).toISOString().slice(0, 16).replace("T", " ");
  const age = now === undefined ? "" : ` (${indexAge(now - millis)} old)`;
  return `${message}; used the cached index from ${date} UTC${age}.`;
}

/** Render unknown warning codes as data. */
export const warningLine = (warning: ReportWarning, now?: number) => {
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
    case "part_unknown":
      return `the manifest's part stack ${id} is in no registry; fragments are placed by its id`;
    case "name_unreadable":
      return `couldn't read the project name from ${id}`;
    case "index_fallback":
      if (warning.reason !== undefined)
        return indexWarningLine(warning.reason, warning.cachedAt, now);
      return `${warning.code}: ${id}`;
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
  context: { shown: string; audience: Audience; style?: Style; now?: number },
): string {
  const human = context.audience === "human";
  const { style = plainStyle } = context;
  const lines = [
    `${result.dryRun ? "Planned" : "Created"} ${printable(context.shown)} from ${printable(result.stack)}${result.preset === "default" ? "" : ` (${result.preset})`}.`,
    // `shown` is the absolute path when the project isn't under the current directory.
    ...(human && context.shown !== result.project ? [`Project: ${printable(result.project)}`] : []),
    ...partLines(result.parts),
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
      ...warnings.map((warning) => `  ${style("warn", warningLine(warning, context.now))}`),
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
