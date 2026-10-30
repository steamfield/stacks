import { Effect, Result } from "effect";
import { AppConfig } from "../../config";
import type { Finding } from "../../schemas/validate";
import { type Entry, markdownFile, outputPath } from "../registry/entry";
import { Registry } from "../registry/registry";
import { sidecarPath } from "../search/sidecar";
import { unreadable } from "./files";
import { absolutePathPattern, escapeRegExp, FILL_MARKER, isEnvFile, secretIn } from "./patterns";
import { type Check, finding, type View } from "./view";

/**
 * Where a scanned text sits: the entry's markdown file, a shipped file under `files/` or
 * `adapters/`, the search card, or anything else in the entry directory (author notes), which
 * ships nothing but still travels with a submission.
 */
type Area = "markdown" | "shipped" | "card" | "other";

/**
 * `validate --submission`: what keeps an entry out of the public registry beyond the normal
 * checks. Left `stacks:fill` markers, credential-shaped strings and `.env` files are errors;
 * absolute home paths and a missing search card are warnings. Every finding names the file, and
 * the line where there is one. A finding never quotes the text it matched.
 */
export const submissionChecks: Check = (view) =>
  Effect.gen(function* () {
    const findings: Finding[] = [];
    const homePath = absolutePathPattern((yield* (yield* AppConfig).paths).home);
    for (const entry of view.entries)
      findings.push(...(yield* entryFindings(view, entry, homePath)));
    return { findings };
  });

/** A shipped file's path in the project: without `files/` or `adapters/<agent>/`. */
function projectPath(source: string): string | undefined {
  return /^(?:files|adapters\/[^/]+)\/(.+)$/.exec(source)?.[1];
}

/** Whether `run` names `file` as a whole path, not as the tail of a longer one. */
function names(run: string, file: string): boolean {
  return new RegExp(`(?:^|[\\s'"\`=(]|\\./)${escapeRegExp(file)}(?![\\w./-])`).test(run);
}

/**
 * A shipped marker is the project's agent's to fill when a verify step checks the project for
 * markers in that file: the step's `run` mentions `stacks:fill` and the file's project path, as
 * shipped or with `.tmpl` dropped.
 */
function fillChecked(entry: Entry, source: string): boolean {
  const shipped = projectPath(source);
  if (shipped === undefined) return false;
  const paths = new Set([shipped, outputPath({ path: shipped })]);
  return entry.meta.verify.some(
    (step) => step.run.includes(FILL_MARKER) && [...paths].some((file) => names(step.run, file)),
  );
}

const entryFindings = (view: View, entry: Entry, homePath: RegExp) =>
  Effect.gen(function* () {
    const registry = yield* Registry;
    const findings: Finding[] = [];
    const tree = yield* Effect.result(registry.tree(entry));
    if (Result.isFailure(tree)) return [unreadable(view, entry, tree.failure)];
    for (const { source } of tree.success.files) {
      const file = view.file(entry, source);
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
      if (Result.isFailure(text)) {
        findings.push(unreadable(view, entry, text.failure));
        continue;
      }
      // Binary files hold no text to scan.
      if (text.success.includes("\0")) continue;
      findings.push(
        ...scan({
          entry,
          file,
          text: text.success,
          area: areaOf(entry, source),
          fillsChecked: fillChecked(entry, source),
          homePath,
        }),
      );
    }
    findings.push(...(yield* cardFindings(entry, homePath)));
    return findings;
  });

const cardFindings = (entry: Entry, homePath: RegExp) =>
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
    return scan({ entry, file, text, area: "card", fillsChecked: false, homePath });
  });

function areaOf(entry: Entry, source: string): Area {
  if (source === markdownFile(entry.kind)) return "markdown";
  return /^(?:files|adapters)\//.test(source) ? "shipped" : "other";
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
  homePath: RegExp;
}): Finding[] {
  const { entry, file, text, area, fillsChecked, homePath } = options;
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
    if (area !== "other" && homePath.test(line))
      issue(
        "absolute-path",
        "warning",
        number,
        "Absolute path from one machine; use a path relative to the project, or {{project_name}}.",
      );
  }
  return findings;
}
