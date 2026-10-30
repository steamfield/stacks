import type { Kind, SearchMetadata, SearchVocabulary } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path } from "effect";
import { PermissionDenied } from "../../errors";
import type { Finding } from "../../schemas/validate";
import { countWords } from "../brief/words";
import type { Entry } from "../registry/entry";
import { Registry } from "../registry/registry";
import { searchSourceDigest } from "../search/digest";
import { decodeSidecar, decodeVocabulary, readSearchFile, sidecarPath } from "../search/sidecar";
import { exampleProblems } from "./search-examples";
import { type Check, finding, type View } from "./view";

function aliasProblems(vocabulary: SearchVocabulary): string[] {
  const problems: string[] = [];
  for (const category of ["platforms", "productKinds", "languages", "capabilities"] as const) {
    const seen = new Map<string, string>();
    for (const [value, aliases] of Object.entries(vocabulary[category])) {
      for (const alias of aliases) {
        const normalized = alias.toLowerCase().trim();
        const previous = seen.get(normalized);
        if (previous !== undefined && previous !== value)
          problems.push(
            `${category}: ${previous} and ${value} share alias ${JSON.stringify(alias)}`,
          );
        seen.set(normalized, value);
      }
    }
  }
  return problems;
}

function unknownValues(card: SearchMetadata, vocabulary: SearchVocabulary): string[] {
  const fields =
    card.kind === "stack"
      ? ([
          ["platforms", card.platforms],
          ["productKinds", card.productKinds],
          ["languages", card.languages],
        ] as const)
      : ([["capabilities", card.capabilities]] as const);
  return fields.flatMap(([field, values]) => {
    return values
      .filter((value) => !Object.hasOwn(vocabulary[field], value))
      .map((value) => `${field}: unknown value ${JSON.stringify(value)}`);
  });
}

function sizeProblems(card: SearchMetadata): string[] {
  const problems: string[] = [];
  if ((card.caveats?.length ?? 0) > 3) problems.push("caveats: at most 3 items");
  for (const [field, values, maximum] of [
    ["requests", card.requests, 5],
    ["useCases", card.useCases, 6],
    ["synonyms", card.synonyms, 12],
    ["goodFor", card.goodFor, 4],
    ["notFor", card.notFor, 4],
  ] as const) {
    if (values.length > maximum) problems.push(`${field}: at most ${maximum} items`);
  }
  if (card.requests.length < 3) problems.push("requests: at least 3 items");
  if (countWords(card.summary) > 25) problems.push("summary: at most 25 words");
  if (card.requests.some((text) => countWords(text) > 15))
    problems.push("requests: at most 15 words each");
  if (card.caveats?.some((text) => countWords(text) > 25))
    problems.push("caveats: at most 25 words each");
  problems.push(...kindSizeProblems(card));
  problems.push(...editorialSizeProblems(card));
  problems.push(...plainSizeProblems(card));
  const text = [
    card.summary,
    ...card.requests,
    ...card.useCases,
    ...card.synonyms,
    ...card.goodFor,
    ...card.notFor,
    ...(card.caveats ?? []),
  ].join(" ");
  if (countWords(text) > 150) problems.push("card: at most 150 words of text");
  return problems;
}

function plainSizeProblems(card: SearchMetadata): string[] {
  if (!card.plain) return [];
  const problems: string[] = [];
  if (countWords(card.plain.whatItIs) > 30) problems.push("plain.whatItIs: at most 30 words");
  for (const field of ["goodAt", "notGoodAt"] as const) {
    const items = card.plain[field];
    if (items.length > 3) problems.push(`plain.${field}: at most 3 items`);
    if (items.some((text) => countWords(text) > 15))
      problems.push(`plain.${field}: at most 15 words each`);
  }
  return problems;
}

function editorialSizeProblems(card: SearchMetadata): string[] {
  const problems: string[] = [];
  if (card.description !== undefined && countWords(card.description) > 120)
    problems.push("description: at most 120 words");
  if (card.seoDescription !== undefined && [...card.seoDescription].length > 160)
    problems.push("seoDescription: at most 160 Unicode code points");
  const examples = card.projectExamples;
  if (examples === undefined) return problems;
  if (examples.length < 1 || examples.length > 3) problems.push("projectExamples: 1 to 3 items");
  for (const [index, example] of examples.entries()) {
    const at = `projectExamples[${index + 1}]`;
    if (countWords(example.title) > 8) problems.push(`${at}.title: at most 8 words`);
    if (countWords(example.description) > 35) problems.push(`${at}.description: at most 35 words`);
    if ((example.withFragments?.length ?? 0) > 3)
      problems.push(`${at}.withFragments: at most 3 items`);
  }
  return problems;
}

function kindSizeProblems(card: SearchMetadata): string[] {
  if (card.kind === "fragment")
    return card.capabilities.length > 3 ? ["capabilities: at most 3 items"] : [];
  return card.languages.length < 1 || card.languages.length > 3 ? ["languages: 1 to 3 items"] : [];
}

const vocabularyFor = Effect.fn("validate.searchVocabulary")(function* (
  view: View,
  findings: Finding[],
) {
  const registry = yield* Registry;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = "search/vocabulary.json";
  if (
    !view.bundled &&
    (yield* fs.exists(path.join(view.root, file)).pipe(Effect.orElseSucceed(() => false)))
  )
    findings.push({
      check: "vocabulary-ignored",
      severity: "note",
      file,
      message: "Only the bundled search vocabulary is used; this file is ignored.",
    });
  const loaded = yield* Effect.result(registry.vocabulary);
  const decoded =
    loaded._tag === "Success" && loaded.success !== undefined
      ? yield* Effect.result(decodeVocabulary(loaded.success))
      : undefined;
  if (decoded === undefined || decoded._tag === "Failure") {
    findings.push({
      check: "vocabulary-invalid",
      severity: "error",
      file,
      message:
        decoded?._tag === "Failure"
          ? String(decoded.failure)
          : "Bundled search vocabulary is missing or unreadable.",
    });
    return undefined;
  }
  const problems = aliasProblems(decoded.success);
  if (problems.length)
    findings.push({
      check: "vocabulary-invalid",
      severity: "error",
      file,
      message: problems.join("; "),
    });
  return decoded.success;
});

const inspectCard = Effect.fn("validate.searchCard")(function* (options: {
  view: View;
  ref: { kind: Kind; id: string };
  entry: Entry | undefined;
  vocabulary: SearchVocabulary | undefined;
}) {
  const { view, ref, entry, vocabulary } = options;
  const file = sidecarPath(ref);
  const issue = (check: string, severity: Finding["severity"], message: string) =>
    finding(ref, { check, severity, file, message });
  const registry = yield* Registry;
  const loaded = yield* Effect.result(
    entry === undefined ? readSearchFile(view.root, file) : registry.search(entry),
  );
  if (loaded._tag === "Failure")
    return [issue("search-invalid", "error", "Cannot read sidecar (symlinks are not allowed).")];
  if (loaded.success === undefined)
    return entry === undefined
      ? []
      : [
          issue(
            "search-missing",
            entry.origin === "bundled" ? "warning" : "note",
            "No search card; add a reviewed sidecar for search discovery.",
          ),
        ];
  const decoded = yield* Effect.result(decodeSidecar(loaded.success));
  if (decoded._tag === "Failure")
    return [issue("search-invalid", "error", String(decoded.failure))];
  const card = decoded.success;
  const problems = vocabulary === undefined ? [] : unknownValues(card, vocabulary);
  if (card.kind !== ref.kind || card.id !== ref.id)
    problems.push(`Path names ${ref.kind}/${ref.id}, card names ${card.kind}/${card.id}.`);
  if (problems.length) return [issue("search-invalid", "error", problems.join("; "))];
  if (entry === undefined)
    return [issue("search-orphan", "error", `No ${ref.kind}/${ref.id} entry in this root.`)];
  const examples = yield* exampleProblems(card, view);
  return [
    ...(examples.length ? [issue("search-invalid", "error", examples.join("; "))] : []),
    ...staleFindings(card, entry, issue),
    ...cardWarnings(card).map(([check, message]) => issue(check, "warning", message)),
  ];
});

const staleFindings = (
  card: SearchMetadata,
  entry: Entry,
  issue: (check: string, severity: Finding["severity"], message: string) => Finding,
): Finding[] =>
  card.source.digest === searchSourceDigest(entry) ? [] : [staleFinding(card, issue)];

/**
 * A card stamped against other entry text. An unreviewed author draft has no reviewed baseline to
 * go stale against (submission restamps it), so for one this is only a note.
 */
function staleFinding(
  card: SearchMetadata,
  issue: (check: string, severity: Finding["severity"], message: string) => Finding,
): Finding {
  const draft = card.source.by === "author" && card.source.reviewedAt === null;
  return issue(
    "search-stale",
    draft ? "note" : "warning",
    "Entry text changed; draft again or review and restamp this card.",
  );
}

function cardWarnings(card: SearchMetadata): Array<[string, string]> {
  const warnings: Array<[string, string]> = [];
  if (card.source.reviewedAt === null)
    warnings.push(["search-unreviewed", "Read this draft and approve it before publishing."]);
  const size = sizeProblems(card);
  if (size.length) warnings.push(["search-size", size.join("; ")]);
  if (card.plain) {
    const text = [card.plain.whatItIs, ...card.plain.goodAt, ...card.plain.notGoodAt].join(" ");
    if (versionedPlain(text))
      warnings.push(["plain-versioned", "Plain copy names a version; keep it version-neutral."]);
  }
  return warnings;
}

export const versionedPlain = (text: string): boolean =>
  /\bv?\d+(?:\.\d+)+\b|\bv?\d+\.x\b/i.test(text);

const sidecarRefs = Effect.fn("validate.searchFiles")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const refs: { kind: Kind; id: string }[] = [];
  for (const [kind, dir] of [
    ["stack", "stacks"],
    ["fragment", "fragments"],
  ] as const) {
    const at = path.join(root, "search", dir);
    const names = yield* fs
      .readDirectory(at)
      .pipe(
        Effect.catch((error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed([])
            : Effect.fail(new PermissionDenied({ details: { reason: "read", path: at } })),
        ),
      );
    for (const name of names.filter((name) => name.endsWith(".json")).sort())
      refs.push({ kind, id: name.slice(0, -5) });
  }
  return refs;
});

const selectedRefs = (view: View) => {
  if (view.composition !== undefined) return Effect.succeed(view.entries);
  if (view.only !== undefined) return Effect.succeed([view.only]);
  return Effect.map(sidecarRefs(view.root), (refs) => {
    const existing = new Set(refs.map((ref) => `${ref.kind}/${ref.id}`));
    return [...refs, ...view.entries.filter((entry) => !existing.has(`${entry.kind}/${entry.id}`))];
  });
};

export const searchChecks: Check = Effect.fn("validate.search")(function* (view) {
  const findings: Finding[] = [];
  const vocabulary = yield* vocabularyFor(view, findings);
  const refs = yield* selectedRefs(view);
  for (const ref of refs.filter(view.wanted)) {
    findings.push(
      ...(yield* inspectCard({
        view,
        ref,
        vocabulary,
        entry: view.entries.find((entry) => entry.kind === ref.kind && entry.id === ref.id),
      })),
    );
  }
  return { findings };
});
