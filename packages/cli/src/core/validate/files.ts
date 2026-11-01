import { Effect, Result } from "effect";
import type { Finding, SizeRow } from "../../schemas/validate";
import { countWords } from "../brief/words";
import { isConditionalMarker, scanConditionals } from "../compose/conditionals";
import { fitsStack } from "../compose/selection";
import { type Entry, type EntryFile, isStack, outputPath, shippedPath } from "../registry/entry";
import { Registry } from "../registry/registry";
import { type Check, entryFile, finding, type View } from "./view";

/**
 * Shipped files: every `merge` path is one of the entry's own files, each copy of a merge file
 * parses as JSON (checked per entry, so a fragment no budgeted composition includes is still
 * checked), and Markdown under `files/` and `adapters/` is counted as a `shipped` size row with
 * no limit, so prose moved out of the body stays visible.
 */
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

/** An entry file that couldn't be read while checking: a finding, so the rest still reports. */
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
    const registry = yield* Registry;
    const findings: Finding[] = [];
    const sizes: SizeRow[] = [];
    const listed = yield* Effect.result(registry.files(entry));
    if (Result.isFailure(listed)) {
      findings.push(unreadable(view, entry, listed.failure));
      return { findings, sizes };
    }
    const files = listed.success;
    findings.push(...overlayFindings(view, entry, files));
    findings.push(...(yield* misplacedOverlay(view, entry)));
    const checkMerge = (target: string) =>
      Effect.gen(function* () {
        const copies = files.filter((file) => outputPath(file) === target);
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
      });
    for (const target of entry.meta.merge) yield* checkMerge(target);
    const checked = yield* checkShippedText(view, entry, files);
    findings.push(...checked.findings);
    const words = checked.words;
    if (words) sizes.push({ kind: "shipped", entryKind: entry.kind, entry: entry.id, words });
    return { findings, sizes };
  });

const misplacedOverlay = Effect.fn("validate.misplacedOverlay")(function* (
  view: View,
  entry: Entry,
) {
  if (entry.kind !== "stack") return [];
  const tree = yield* Effect.result((yield* Registry).tree(entry));
  if (Result.isFailure(tree) || !tree.success.directories.includes("stacks")) return [];
  return [
    finding(entry, {
      check: "overlay-fragment-only",
      severity: "error",
      file: entryFile(view, entry),
      message: "stacks/ overlays belong only to fragments; move these files into files/.",
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
    if (/\.md$/i.test(outputPath(file))) words += countWords(text.success);
    findings.push(...shippedConditionals(view, entry, file, text.success));
  }
  return { words, findings };
});

function shippedConditionals(view: View, entry: Entry, file: EntryFile, text: string): Finding[] {
  if (text.includes("\0")) return [];
  const malformed = scanConditionals(text);
  return text.split("\n").flatMap((line, index) =>
    isConditionalMarker(line) ||
    (!("blocks" in malformed) && malformed.line === index + 1 && malformed.problem === "not_alone")
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

function overlayFindings(view: View, entry: Entry, files: ReadonlyArray<EntryFile>): Finding[] {
  if (entry.meta.kind !== "fragment") return [];
  const findings: Finding[] = [];
  const shared = new Set(
    files.filter((file) => shippedPath(file.source)?.condition === null).map(outputPath),
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
    if (shared.has(outputPath(file)))
      findings.push(
        finding(entry, {
          check: "overlay-path-duplicate",
          severity: "error",
          file: view.file(entry, file.source),
          message: `overlay path ${outputPath(file)} duplicates this fragment's files/ path`,
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

const checkMergeCopy = (view: View, entry: Entry, copy: EntryFile) =>
  Effect.gen(function* () {
    const registry = yield* Registry;
    const findings: Finding[] = [];
    // A template on a merge path is 1.1's merge_template; compose reports it.
    if (outputPath(copy) !== copy.path) return findings;
    const text = yield* Effect.result(registry.read(entry, copy.source));
    if (Result.isFailure(text)) {
      findings.push(unreadable(view, entry, text.failure));
      return findings;
    }
    if (Result.isFailure(Result.try(() => JSON.parse(text.success) as unknown)))
      findings.push(
        finding(entry, {
          check: "merge-json",
          severity: "error",
          file: view.file(entry, copy.source),
          message: `${copy.source} is listed under merge but isn't valid JSON`,
        }),
      );
    return findings;
  });
