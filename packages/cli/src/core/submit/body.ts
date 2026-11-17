/**
 * Renders the submission commit subject and pull request text. Fold author descriptions and
 * queries onto one line and use `printable` to keep control characters out of Markdown.
 */
import type { Finding } from "../../schemas/validate";
import { printable } from "../text/text";

/**
 * The maintainer checklist every entry pull request carries; CONTRIBUTING.md and the entry pull
 * request template list the same steps.
 */
const MAINTAINER_CHECKLIST: ReadonlyArray<string> = [
  "`authors.json` names the PR author's login for every submitted entry",
  "Security review of `files/`, `adapters/` and `stacks/` overlays (hooks and settings run in users' projects)",
  "Search card reviewed and restamped",
  "Dependency allowlist and dependency cards updated",
  "Golden queries added, and existing golden rankings checked for shifts",
  "Bench run",
  "CI green before undraft",
];

type BodyEntry = { kind: string; id: string; update: boolean; description: string };

const oneLine = (text: string) => printable(text.replace(/\s+/g, " ").trim());

/** The pull request title, and the commit subject: `feat(registry): add <id> <kind>`. */
export function title(entries: ReadonlyArray<Pick<BodyEntry, "kind" | "id" | "update">>): string {
  return `feat(registry): ${entries
    .map((entry) => `${entry.update ? "update" : "add"} ${entry.id} ${entry.kind}`)
    .join(", ")}`;
}

const entryLine = (entry: BodyEntry) =>
  `- ${entry.kind} \`${entry.id}\` (${entry.update ? "update" : "new"}): ${oneLine(entry.description)}`;

const warningLine = (finding: Finding) =>
  `- \`${finding.entry ?? ""}\`: ${finding.check}${finding.file === undefined ? "" : ` (${finding.file})`}`;

function validationLines(findings: ReadonlyArray<Finding>): string[] {
  const count = (severity: Finding["severity"]) =>
    findings.filter((finding) => finding.severity === severity).length;
  const warnings = findings.filter((finding) => finding.severity === "warning");
  const summary = `\`stacks validate --submission\` against this branch's registry: ${count("error")} errors, ${count("warning")} warnings, ${count("note")} notes.`;
  if (!warnings.length) return [summary];
  return [summary, "", "Warnings left for maintainers:", "", ...warnings.map(warningLine)];
}

function queryLines(queries: ReadonlyArray<string>): string[] {
  if (!queries.length) return ["None proposed. Maintainers write the golden queries."];
  return queries.map((query) => `- ${oneLine(query)}`);
}

export function pullRequestBody(options: {
  entries: ReadonlyArray<BodyEntry>;
  findings: ReadonlyArray<Finding>;
  queries: ReadonlyArray<string>;
  author: string;
  version: string;
}): string {
  return [
    "## Entries",
    "",
    ...options.entries.map(entryLine),
    "",
    "## Validation",
    "",
    ...validationLines(options.findings),
    "",
    "## Proposed search queries",
    "",
    ...queryLines(options.queries),
    "",
    "## Maintainer checklist",
    "",
    ...MAINTAINER_CHECKLIST.map((item) => `- [ ] ${item}`),
    "",
    `Submitted by @${options.author} with \`stacks submit\` (stacks ${options.version}).`,
    "",
  ].join("\n");
}
