import type { Finding } from "../../schemas/validate";
import { printable } from "../text";

/**
 * The maintainer checklist every entry pull request carries; CONTRIBUTING.md and the entry pull
 * request template list the same steps.
 */
export const MAINTAINER_CHECKLIST: ReadonlyArray<string> = [
  "`authors.json` names the PR author's login for every submitted entry",
  "Security review of `files/` and `adapters/` (hooks and settings run in users' projects)",
  "Search card reviewed and restamped",
  "Dependency allowlist and dependency cards updated",
  "Golden queries added, and existing golden rankings checked for shifts",
  "Bench run",
  "CI green before undraft",
];

export type BodyEntry = { kind: string; id: string; update: boolean; description: string };

/** One line of text for Markdown: control characters escaped, newlines folded. */
const oneLine = (text: string) => printable(text.replace(/\s+/g, " ").trim());

/** The pull request title, and the commit subject: `feat(registry): add <id> <kind>`. */
export function title(entries: ReadonlyArray<Pick<BodyEntry, "kind" | "id" | "update">>): string {
  return `feat(registry): ${entries
    .map((entry) => `${entry.update ? "update" : "add"} ${entry.id} ${entry.kind}`)
    .join(", ")}`;
}

/**
 * The pull request body: what is submitted, how it validated, the warnings left for maintainers,
 * the author's proposed search queries, the CLI version and the maintainer checklist.
 */
export function pullRequestBody(options: {
  entries: ReadonlyArray<BodyEntry>;
  findings: ReadonlyArray<Finding>;
  queries: ReadonlyArray<string>;
  author: string;
  version: string;
}): string {
  const { entries, findings, queries } = options;
  const count = (severity: Finding["severity"]) =>
    findings.filter((finding) => finding.severity === severity).length;
  const warnings = findings.filter((finding) => finding.severity === "warning");
  return [
    "## Entries",
    "",
    ...entries.map(
      (entry) =>
        `- ${entry.kind} \`${entry.id}\` (${entry.update ? "update" : "new"}): ${oneLine(entry.description)}`,
    ),
    "",
    "## Validation",
    "",
    `\`stacks validate --submission\` against this branch's registry: ${count("error")} errors, ${count("warning")} warnings, ${count("note")} notes.`,
    ...(warnings.length
      ? [
          "",
          "Warnings left for maintainers:",
          "",
          ...warnings.map(
            (finding) =>
              `- \`${finding.entry ?? ""}\`: ${finding.check}${finding.file === undefined ? "" : ` (${finding.file})`}`,
          ),
        ]
      : []),
    "",
    "## Proposed search queries",
    "",
    ...(queries.length
      ? queries.map((query) => `- ${oneLine(query)}`)
      : ["None proposed. Maintainers write the golden queries."]),
    "",
    "## Maintainer checklist",
    "",
    ...MAINTAINER_CHECKLIST.map((item) => `- [ ] ${item}`),
    "",
    `Submitted by @${options.author} with \`stacks submit\` (stacks ${options.version}).`,
    "",
  ].join("\n");
}
