/**
 * The shapes of what `stacks validate --json` prints, and of one finding.
 *
 * `validate` checks a registry (or one entry) for problems before anyone uses it
 * (`core/validate/`). A finding is one problem, tied to an entry, file and line where it can be,
 * and `SizeRow`s are the word counts checked against the budgets. `validate --brief <stack>`
 * prints a `BriefPreview` instead: the brief `new` would write, without writing a project.
 * `submit` reuses `Finding` for the entries it checks.
 */
import { Kind } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { ConditionalProblem } from "../errors";
import { NoticeFields } from "./notice";

/** `error` exits 2; `warning` fails only the bundled registry's zero-warning gate; `note` never fails. */
export const Severity = Schema.Literals(["error", "warning", "note"]);
export type Severity = typeof Severity.Type;

/** One problem `validate` found. */
export const Finding = Schema.Struct({
  /** Stable kebab-case check id, such as `budget-composed`. */
  check: Schema.String,
  severity: Severity,
  /** The entry the finding is about; absent for a finding about the registry as a whole. */
  kind: Schema.optionalKey(Kind),
  entry: Schema.optionalKey(Schema.String),
  /** Relative to the registry root, `/`-separated. */
  file: Schema.optionalKey(Schema.String),
  /** 1-based, in `file`; never a line of the rendered brief. */
  line: Schema.optionalKey(Schema.Number),
  /** For `conditional-syntax`: what is wrong with the marker. */
  problem: Schema.optionalKey(ConditionalProblem),
  message: Schema.String,
});
export type Finding = typeof Finding.Type;

/** One word count `validate` measured, and the budget it was checked against. */
export const SizeRow = Schema.Struct({
  /** `body`: an entry's own prose; `composed`: a rendered brief; `shipped`: Markdown under `files/` and `adapters/`. */
  kind: Schema.Literals(["body", "composed", "shipped"]),
  /** For `composed`, the stack; otherwise the entry. */
  entryKind: Kind,
  entry: Schema.String,
  /** Composed rows only. */
  preset: Schema.optionalKey(Schema.Literals(["default", "sandbox"])),
  /** Composed rows only: the one fragment added with `--with`, if any. */
  with: Schema.optionalKey(Schema.String),
  words: Schema.Number,
  /** Composed rows only: the words of the CLI's own text in the brief. */
  fixedWords: Schema.optionalKey(Schema.Number),
  /** Absent on shipped rows, which have no limit. */
  limit: Schema.optionalKey(Schema.Number),
});
export type SizeRow = typeof SizeRow.Type;

/** `validate --json`'s result for one registry root. */
export const ValidateReport = Schema.Struct({
  ...NoticeFields,
  /** The registry root, absolute. */
  root: Schema.String,
  /** True when the root is the bundled registry: every reference must resolve inside it. */
  bundled: Schema.Boolean,
  entries: Schema.Struct({ stacks: Schema.Number, fragments: Schema.Number }),
  /** Registry-wide findings first, then by entry (stacks, then fragments, by id), file and line. */
  findings: Schema.Array(Finding),
  sizes: Schema.Array(SizeRow),
}).annotate({
  title: "Validate report",
  description: "Findings and word counts for the entries under one registry root",
});
export type ValidateReport = typeof ValidateReport.Type;

/** `validate --brief`: the brief `new` would render, with the canonical context, and its counts. */
export const BriefPreview = Schema.Struct({
  ...NoticeFields,
  stack: Schema.String,
  preset: Schema.Literals(["default", "sandbox"]),
  /** Fragments in composition order, the app included. */
  fragments: Schema.Array(Schema.String),
  app: Schema.NullOr(Schema.String),
  briefWords: Schema.Number,
  fixedWords: Schema.Number,
  limit: Schema.Number,
  /** Composition warnings, such as a `--with` fragment that doesn't fit the stack. */
  warnings: Schema.Array(Schema.Struct({ code: Schema.String, id: Schema.String })),
  brief: Schema.String,
  fingerprint: Schema.String,
  findings: Schema.Array(Finding),
}).annotate({
  title: "Brief preview",
  description: "A composed brief and its word counts, rendered without writing a project",
});
export type BriefPreview = typeof BriefPreview.Type;
