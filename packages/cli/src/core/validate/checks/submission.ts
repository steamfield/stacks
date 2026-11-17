/**
 * Checks whether an entry is ready to publish. It scans author-only files too because
 * submissions include them.
 */
import { outputPath, shippedPath } from "@steamfield/stacks-format";
import { Effect, Result } from "effect";
import type { Finding } from "../../../schemas/validate";
import { type Entry, markdownFile } from "../../registry/entry";
import { Registry } from "../../registry/registry";
import { sidecarPath } from "../../search/sidecar";
import { ABSOLUTE_PATH, escapeRegExp, FILL_MARKER, isEnvFile, secretIn } from "../patterns";
import type { Check, View } from "../types";
import { finding } from "../view";
import { unreadable } from "./files";

/**
 * Where a scanned text sits: the entry's markdown file, a shipped file under `files/` or
 * `adapters/`, the search card, or anything else in the entry directory (author notes), which
 * ships nothing but still travels with a submission.
 */
type Area = "markdown" | "shipped" | "card" | "other";

/** Findings identify the file and any available line number without quoting the matched text. */
export const submissionChecks: Check = (view) =>
  Effect.gen(function* () {
    const findings: Finding[] = [];
    for (const entry of view.entries) findings.push(...(yield* entryFindings(view, entry)));
    return { findings };
  });

/** Whether `run` names `file` as a whole path, not as the tail of a longer one. */
function names(run: string, file: string): boolean {
  return new RegExp(`(?:^|[\\s'"\`=(]|\\./)${escapeRegExp(file)}(?![\\w./-])`).test(run);
}

/**
 * A shipped marker may remain when a verify step mentions `stacks:fill` and the file's project
 * path, as shipped or with `.tmpl` dropped. The expectation is that the project agent fills it
 * before verify passes. This check inspects the step as text.
 */
function fillChecked(entry: Entry, source: string): boolean {
  // The file's path in the project: without `files/` or `adapters/<agent>/`.
  const shipped = shippedPath(source)?.path;
  if (shipped === undefined) return false;
  const paths = new Set([shipped, outputPath(shipped)]);
  return entry.meta.verify.some(
    (step) => step.run.includes(FILL_MARKER) && [...paths].some((file) => names(step.run, file)),
  );
}

/** Every file in the entry directory, then the entry's search card. */
const entryFindings = (view: View, entry: Entry) =>
  Effect.gen(function* () {
    const registry = yield* Registry;
    const tree = yield* Effect.result(registry.tree(entry));
    if (Result.isFailure(tree)) return [unreadable(view, entry, tree.failure)];
    const files = yield* Effect.forEach(tree.success.files, ({ source }) =>
      fileFindings({ view, entry, source, registry }),
    );
    return [...files.flat(), ...(yield* cardFindings(entry))];
  });

/** The findings for one file of the entry, given by its path inside the entry directory. */
const fileFindings = (options: {
  view: View;
  entry: Entry;
  source: string;
  registry: Registry["Service"];
}) =>
  Effect.gen(function* () {
    const { view, entry, source, registry } = options;
    const file = view.file(entry, source);
    const findings: Finding[] = [];
    if (isEnvFile(source.slice(source.lastIndexOf("/") + 1)))
      findings.push(
        finding(entry, {
          check: "env-file",
          severity: "error",
          file,
          message: "Environment files don't ship; keep only .env.example, with placeholders.",
        }),
      );
    const text = yield* Effect.result(registry.read(entry, source));
    if (Result.isFailure(text)) return [...findings, unreadable(view, entry, text.failure)];
    // Binary files hold no text to scan.
    if (text.success.includes("\0")) return findings;
    const area = areaOf(entry, source);
    const fillsChecked = fillChecked(entry, source);
    return [...findings, ...scan({ entry, file, text: text.success, area, fillsChecked })];
  });

/** A warning when the entry has no search card; otherwise the card's text, scanned. */
const cardFindings = (entry: Entry) =>
  Effect.gen(function* () {
    const loaded = yield* Effect.result((yield* Registry).search(entry));
    // An unreadable card is the search checks' `search-invalid` error already.
    if (Result.isFailure(loaded)) return [];
    const file = sidecarPath(entry);
    if (loaded.success === undefined)
      return [
        finding(entry, {
          check: "missing-card",
          severity: "warning",
          file,
          message:
            "No search card; draft one so search can find this entry (stacks guide author search-card).",
        }),
      ];
    const text = new TextDecoder().decode(loaded.success);
    return scan({ entry, file, text, area: "card", fillsChecked: false });
  });

function areaOf(entry: Entry, source: string): Area {
  if (source === markdownFile(entry.kind)) return "markdown";
  return shippedPath(source) ? "shipped" : "other";
}

/** A markdown file's frontmatter, between its `---` lines, as 1-based `first` to before `end`. */
function frontmatterLines(lines: ReadonlyArray<string>): { first: number; end: number } {
  const plain = (line: string | undefined) => line?.replace(/\r$/, "");
  const close = lines.findIndex((line, index) => index > 0 && plain(line) === "---");
  if (plain(lines[0]) !== "---" || close === -1) return { first: 0, end: 0 };
  // The closing `---` is at 0-based `close`, so 1-based line `close + 1`.
  return { first: 2, end: close + 1 };
}

/**
 * Whether a line holds a fill marker the author left. A verify `run:` command that looks for
 * markers isn't one, and neither is a body line that names the marker in inline code.
 */
function leftMarker(line: string, area: Area, frontmatter: boolean, fillsChecked: boolean) {
  switch (area) {
    case "markdown": {
      if (frontmatter) {
        const at = line.indexOf(FILL_MARKER);
        return at !== -1 && !/\brun:/.test(line.slice(0, at));
      }
      return line.replace(/`[^`]*`/g, "").includes(FILL_MARKER);
    }
    case "shipped":
      return !fillsChecked && line.includes(FILL_MARKER);
    case "card":
      return line.includes(FILL_MARKER);
    case "other":
      return false;
  }
}

function fillMessage(area: Area): string {
  return area === "shipped"
    ? "stacks:fill marker in a shipped file, and no verify step checks the project for one; fill it in, or add a verify step that fails while a marker is left."
    : "stacks:fill marker left; replace it with the real text.";
}

function scan(options: {
  entry: Entry;
  file: string;
  text: string;
  area: Area;
  fillsChecked: boolean;
}): Finding[] {
  const { entry, file, text, area, fillsChecked } = options;
  const findings: Finding[] = [];
  const issue = (check: string, severity: Finding["severity"], line: number, message: string) =>
    findings.push(finding(entry, { check, severity, file, line, message }));
  const lines = text.split("\n");
  const frontmatter = area === "markdown" ? frontmatterLines(lines) : { first: 0, end: 0 };
  for (const [index, line] of lines.entries()) {
    const number = index + 1;
    const inFrontmatter = number >= frontmatter.first && number < frontmatter.end;
    if (leftMarker(line, area, inFrontmatter, fillsChecked))
      issue("fill-marker", "error", number, fillMessage(area));
    const secret = secretIn(line);
    if (secret !== undefined)
      issue(
        "secret",
        "error",
        number,
        `This line looks like ${secret}; remove it and have the project read it from the environment.`,
      );
    if (area !== "other" && ABSOLUTE_PATH.test(line))
      issue(
        "absolute-path",
        "warning",
        number,
        "Absolute path from one machine; use a path relative to the project, or {{project_name}}.",
      );
  }
  return findings;
}
