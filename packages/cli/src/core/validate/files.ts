/**
 * Checks shipped files per entry so fragments absent from all compositions still get checked.
 * Shipped Markdown gets a size row without a limit so guidance moved out of the body stays
 * visible. `unreadable` reports a bad file without hiding the rest.
 */
import { outputPath, shippedPath } from "@steamfield/stacks-format";
import { Effect, Result } from "effect";
import type { Finding, SizeRow } from "../../schemas/validate";
import { countWords } from "../brief/words";
import { isConditionalMarker, scanConditionals } from "../compose/conditionals";
import { fitsStack } from "../compose/selection";
import { type Entry, type EntryFile, isStack, PAYLOADS } from "../registry/entry";
import { Registry } from "../registry/registry";
import type { Check, View } from "./types";
import { entryFile, finding } from "./view";

export const fileChecks: Check = (view) =>
  Effect.gen(function* () {
    const findings: Finding[] = [];
    const sizes: SizeRow[] = [];
    for (const entry of view.entries) {
      const checked = yield* checkEntryFiles(view, entry);
      findings.push(...checked.findings);
      sizes.push(...checked.sizes);
    }
    return { findings, sizes };
  });

export function unreadable(
  view: Parameters<Check>[0],
  entry: Entry,
  error: { _tag: string; details?: { path?: string } | undefined },
): Finding {
  const at = error.details?.path;
  return finding(entry, {
    check: "schema",
    severity: "error",
    file: entryFile(view, entry),
    message:
      error._tag === "PermissionDenied"
        ? `a file in the entry is unreadable${at ? `: ${at}` : ""}`
        : `a file in the entry can't be used${at ? `: ${at}` : ""}`,
  });
}

const checkEntryFiles = (view: View, entry: Entry) =>
  Effect.gen(function* () {
    const listed = yield* Effect.result((yield* Registry).files(entry));
    if (Result.isFailure(listed))
      return { findings: [unreadable(view, entry, listed.failure)], sizes: [] };
    const files = listed.success;
    const findings = [
      ...overlayFindings(view, entry, files),
      ...(yield* misplacedDirectories(view, entry)),
      ...(yield* mergeFindings(view, entry, files)),
    ];
    const shipped = yield* checkShippedText(view, entry, files);
    findings.push(...shipped.findings);
    const sizes: SizeRow[] = shipped.words
      ? [{ kind: "shipped", entryKind: entry.kind, entry: entry.id, words: shipped.words }]
      : [];
    return { findings, sizes };
  });

/**
 * `payloads/` in a fragment, `stacks/` in a stack, or a payload variant other than the known ones.
 * An entry whose tree can't be listed gets no finding here; listing its files already failed.
 */
const misplacedDirectories = Effect.fn("validate.misplacedDirectories")(function* (
  view: View,
  entry: Entry,
) {
  const tree = yield* Effect.result((yield* Registry).tree(entry));
  if (Result.isFailure(tree)) return [];
  const { directories, files } = tree.success;
  const misplaced = (check: string, message: string) =>
    finding(entry, { check, severity: "error", file: entryFile(view, entry), message });
  if (entry.kind !== "stack")
    return directories.includes("payloads")
      ? [
          misplaced(
            "payload-stack-only",
            "payloads/ belong only to stacks; move these files into files/.",
          ),
        ]
      : [];
  const findings: Finding[] = [];
  if (directories.includes("stacks"))
    findings.push(
      misplaced(
        "overlay-fragment-only",
        "stacks/ overlays belong only to fragments; move these files into files/.",
      ),
    );
  const unknown = unknownPayloads(files.map(({ source }) => source));
  if (unknown.length)
    findings.push(
      misplaced(
        "payload-unknown",
        `payloads/ holds only ${PAYLOADS.join(" and ")}; rename or remove ${unknown.map((name) => `payloads/${name}/`).join(", ")}.`,
      ),
    );
  return findings;
});

/** Variant names under `payloads/` that aren't in `PAYLOADS`, in first-seen order. */
function unknownPayloads(sources: ReadonlyArray<string>): string[] {
  const variants = new Set(
    sources.flatMap((source) => /^payloads\/([^/]+)\//.exec(source)?.[1] ?? []),
  );
  return [...variants].filter((variant) => !(PAYLOADS as ReadonlyArray<string>).includes(variant));
}

/** Each `merge` path must be shipped, and each shipped copy of it must parse as JSON. */
const mergeFindings = (view: View, entry: Entry, files: ReadonlyArray<EntryFile>) =>
  Effect.gen(function* () {
    const findings: Finding[] = [];
    for (const target of entry.meta.merge) {
      const copies = files.filter((file) => outputPath(file.path) === target);
      if (!copies.length)
        findings.push(
          finding(entry, {
            check: "merge-path-missing",
            severity: "error",
            file: entryFile(view, entry),
            message: `merge lists ${target}, which this entry doesn't ship under files/, adapters/<agent>/ or stacks/<stack>/`,
          }),
        );
      for (const copy of copies) findings.push(...(yield* checkMergeCopy(view, entry, copy)));
    }
    return findings;
  });

const checkMergeCopy = (view: View, entry: Entry, copy: EntryFile) =>
  Effect.gen(function* () {
    // A template on a merge path is the `merge_template` problem, which composition reports.
    if (outputPath(copy.path) !== copy.path) return [];
    const text = yield* Effect.result((yield* Registry).read(entry, copy.source));
    if (Result.isFailure(text)) return [unreadable(view, entry, text.failure)];
    if (Result.isSuccess(Result.try(() => JSON.parse(text.success) as unknown))) return [];
    return [
      finding(entry, {
        check: "merge-json",
        severity: "error",
        file: view.file(entry, copy.source),
        message: `${copy.source} is listed under merge but isn't valid JSON`,
      }),
    ];
  });

const checkShippedText = Effect.fn("validate.shippedText")(function* (
  view: View,
  entry: Entry,
  files: ReadonlyArray<EntryFile>,
) {
  const registry = yield* Registry;
  const findings: Finding[] = [];
  let words = 0;
  for (const file of files) {
    const text = yield* Effect.result(registry.read(entry, file.source));
    if (Result.isFailure(text)) {
      findings.push(unreadable(view, entry, text.failure));
      continue;
    }
    if (/\.md$/i.test(outputPath(file.path))) words += countWords(text.success);
    findings.push(...shippedConditionals(view, entry, file, text.success));
  }
  return { words, findings };
});

/**
 * Conditional markers resolve only in entry bodies, so a marker in a shipped file would
 * reach the project unresolved. Flag even shared-line markers in text files.
 */
function shippedConditionals(view: View, entry: Entry, file: EntryFile, text: string): Finding[] {
  if (text.includes("\0")) return [];
  const scanned = scanConditionals(text);
  const crowdedLine =
    !("blocks" in scanned) && scanned.problem === "not_alone" ? scanned.line : undefined;
  return text.split("\n").flatMap((line, index) =>
    isConditionalMarker(line) || crowdedLine === index + 1
      ? [
          finding(entry, {
            check: "shipped-conditional",
            severity: "error",
            file: view.file(entry, file.source),
            line: index + 1,
            message:
              "stacks:when and stacks:end resolve only in entry bodies; use plain labelled prose or a stack overlay in shipped files.",
          }),
        ]
      : [],
  );
}

/**
 * A fragment's stack overlays: each overlay stack must exist and be admitted by `applies_to`
 * (reported once per stack), and no overlay may ship a path its `files/` already ships.
 */
function overlayFindings(view: View, entry: Entry, files: ReadonlyArray<EntryFile>): Finding[] {
  if (entry.meta.kind !== "fragment") return [];
  const findings: Finding[] = [];
  const shared = new Set(
    files
      .filter((file) => shippedPath(file.source)?.condition === null)
      .map((file) => outputPath(file.path)),
  );
  const checked = new Set<string>();
  for (const file of files) {
    const condition = shippedPath(file.source)?.condition;
    if (condition?.kind !== "stack") continue;
    if (!checked.has(condition.id)) {
      checked.add(condition.id);
      const issue = overlayStackFinding(view, entry, condition.id, file.source);
      if (issue) findings.push(issue);
    }
    if (shared.has(outputPath(file.path)))
      findings.push(
        finding(entry, {
          check: "overlay-path-duplicate",
          severity: "error",
          file: view.file(entry, file.source),
          message: `overlay path ${outputPath(file.path)} duplicates this fragment's files/ path`,
        }),
      );
  }
  return findings;
}

function overlayStackFinding(
  view: View,
  entry: Entry,
  id: string,
  source: string,
): Finding | undefined {
  if (entry.meta.kind !== "fragment") return undefined;
  const stack = view.all.filter(isStack).find((stack) => stack.id === id);
  if (stack && fitsStack(entry.meta.appliesTo, { id: stack.id, tags: stack.meta.tags }))
    return undefined;
  return finding(entry, {
    check: stack ? "overlay-stack-fit" : "overlay-stack-unknown",
    severity: "error",
    file: view.file(entry, source),
    message: stack
      ? `overlay stack ${id} is not admitted by applies_to`
      : `overlay stack ${id} does not exist`,
  });
}
