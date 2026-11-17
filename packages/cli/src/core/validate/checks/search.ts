/**
 * Validates registry search cards against the bundled vocabulary and uses `searchSourceDigest`
 * to detect copy written against older entry text.
 */
import type { Kind, SearchMetadata, SearchVocabulary } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path, Result } from "effect";
import { PermissionDenied } from "../../../errors";
import type { Finding } from "../../../schemas/validate";
import { countWords } from "../../brief/words";
import type { Entry } from "../../registry/entry";
import { Registry } from "../../registry/registry";
import { searchSourceDigest } from "../../search/digest";
import { decodeSidecar, decodeVocabulary, readSearchFile, sidecarPath } from "../../search/sidecar";
import type { Check, View } from "../types";
import { finding } from "../view";
import { exampleProblems, hedgedExamples } from "./search-examples";

/** Builds a finding about the card being checked, so callers name only check, severity, text. */
type CardIssue = (check: string, severity: Finding["severity"], message: string) => Finding;

const VOCABULARY_FILE = "search/vocabulary.json";

/** Two labels of one vocabulary category may not share an alias, compared case-insensitively. */
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

/** Labels on the card that the vocabulary doesn't define, per field the card's kind carries. */
function unknownValues(card: SearchMetadata, vocabulary: SearchVocabulary): string[] {
  const fields =
    card.kind === "stack"
      ? ([
          ["platforms", card.platforms],
          ["productKinds", card.productKinds],
          ["languages", card.languages],
        ] as const)
      : ([["capabilities", card.capabilities]] as const);
  return fields.flatMap(([field, values]) =>
    values
      .filter((value) => !Object.hasOwn(vocabulary[field], value))
      .map((value) => `${field}: unknown value ${JSON.stringify(value)}`),
  );
}

/** Every size limit the card breaks, in a fixed order, since they are joined into one message. */
function sizeProblems(card: SearchMetadata): string[] {
  return [
    ...countProblems(card),
    ...wordProblems(card),
    ...kindSizeProblems(card),
    ...editorialSizeProblems(card),
    ...plainSizeProblems(card),
    ...cardWordProblems(card),
  ];
}

function countProblems(card: SearchMetadata): string[] {
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
  return problems;
}

function wordProblems(card: SearchMetadata): string[] {
  const problems: string[] = [];
  if (countWords(card.summary) > 25) problems.push("summary: at most 25 words");
  if (card.requests.some((text) => countWords(text) > 15))
    problems.push("requests: at most 15 words each");
  if (card.caveats?.some((text) => countWords(text) > 25))
    problems.push("caveats: at most 25 words each");
  return problems;
}

function cardWordProblems(card: SearchMetadata): string[] {
  const text = [
    card.summary,
    ...card.requests,
    ...card.useCases,
    ...card.synonyms,
    ...card.goodFor,
    ...card.notFor,
    ...(card.caveats ?? []),
  ].join(" ");
  return countWords(text) > 150 ? ["card: at most 150 words of text"] : [];
}

/** Limits on `plain`, the optional unscored copy `stacks show` leads with. */
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

/** Limits on the optional editorial fields: description, SEO text and project examples. */
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

/** Limits that depend on the card's kind: a fragment's capabilities, a stack's languages. */
function kindSizeProblems(card: SearchMetadata): string[] {
  if (card.kind === "fragment")
    return card.capabilities.length > 3 ? ["capabilities: at most 3 items"] : [];
  return card.languages.length < 1 || card.languages.length > 3 ? ["languages: 1 to 3 items"] : [];
}

/** A note when a root other than the bundled one carries a vocabulary file search never reads. */
const ignoredVocabulary = Effect.fn("validate.searchVocabularyIgnored")(function* (view: View) {
  if (view.asBundled) return [];
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const exists = yield* fs
    .exists(path.join(view.root, VOCABULARY_FILE))
    .pipe(Effect.orElseSucceed(() => false));
  if (!exists) return [];
  const note: Finding = {
    check: "vocabulary-ignored",
    severity: "note",
    file: VOCABULARY_FILE,
    message: "Only the bundled search vocabulary is used; this file is ignored.",
  };
  return [note];
});

const loadVocabulary = Effect.fn("validate.searchVocabularyLoad")(function* () {
  const registry = yield* Registry;
  const loaded = yield* Effect.result(registry.vocabulary);
  if (Result.isFailure(loaded) || loaded.success === undefined)
    return Result.fail("Bundled search vocabulary is missing or unreadable.");
  const decoded = yield* Effect.result(decodeVocabulary(loaded.success));
  if (Result.isFailure(decoded)) return Result.fail(String(decoded.failure));
  return Result.succeed(decoded.success);
});

const vocabularyInvalid = (message: string): Finding => ({
  check: "vocabulary-invalid",
  severity: "error",
  file: VOCABULARY_FILE,
  message,
});

/**
 * The vocabulary the cards are checked against, with findings about the vocabulary itself. With
 * no usable vocabulary, cards skip the label check rather than each repeating the same error.
 */
const vocabularyFor = Effect.fn("validate.searchVocabulary")(function* (view: View) {
  const findings = yield* ignoredVocabulary(view);
  const loaded = yield* loadVocabulary();
  if (Result.isFailure(loaded))
    return { vocabulary: undefined, findings: [...findings, vocabularyInvalid(loaded.failure)] };
  const problems = aliasProblems(loaded.success);
  if (problems.length) findings.push(vocabularyInvalid(problems.join("; ")));
  return { vocabulary: loaded.success, findings };
});

/** Problems that make a card wrong rather than just untidy: unknown labels or the wrong identity. */
function cardProblems(
  card: SearchMetadata,
  ref: { kind: Kind; id: string },
  vocabulary: SearchVocabulary | undefined,
): string[] {
  const problems = vocabulary === undefined ? [] : unknownValues(card, vocabulary);
  if (card.kind !== ref.kind || card.id !== ref.id)
    problems.push(`Path names ${ref.kind}/${ref.id}, card names ${card.kind}/${card.id}.`);
  return problems;
}

/**
 * The findings for one card. `entry` is the validated entry the card describes, or undefined for
 * a card file with no entry behind it; that card is read straight from the root, since the
 * registry only looks up cards of entries it knows.
 */
const inspectCard = Effect.fn("validate.searchCard")(function* (options: {
  view: View;
  ref: { kind: Kind; id: string };
  entry: Entry | undefined;
  vocabulary: SearchVocabulary | undefined;
}) {
  const { view, ref, entry, vocabulary } = options;
  const file = sidecarPath(ref);
  const issue: CardIssue = (check, severity, message) =>
    finding(ref, { check, severity, file, message });
  const registry = yield* Registry;
  const loaded = yield* Effect.result(
    entry === undefined ? readSearchFile(view.root, file) : registry.search(entry),
  );
  if (Result.isFailure(loaded))
    return [issue("search-invalid", "error", "Cannot read sidecar (symlinks are not allowed).")];
  if (loaded.success === undefined) return entry === undefined ? [] : [missingCard(entry, issue)];
  const decoded = yield* Effect.result(decodeSidecar(loaded.success));
  if (Result.isFailure(decoded)) return [issue("search-invalid", "error", String(decoded.failure))];
  const card = decoded.success;
  const problems = cardProblems(card, ref, vocabulary);
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

/** A missing card is a warning in the bundled registry, which must stay searchable, else a note. */
const missingCard = (entry: Entry, issue: CardIssue): Finding =>
  issue(
    "search-missing",
    entry.origin === "bundled" ? "warning" : "note",
    "No search card; add a reviewed sidecar for search discovery.",
  );

const staleFindings = (card: SearchMetadata, entry: Entry, issue: CardIssue): Finding[] =>
  card.source.digest === searchSourceDigest(entry) ? [] : [staleFinding(card, issue)];

/**
 * A card stamped against other entry text. An unreviewed author draft has no reviewed baseline to
 * go stale against (submission restamps it), so for one this is only a note. A stale reviewed
 * card still works in search and gets a warning.
 */
function staleFinding(card: SearchMetadata, issue: CardIssue): Finding {
  const draft = card.source.by === "author" && card.source.reviewedAt === null;
  return issue(
    "search-stale",
    draft ? "note" : "warning",
    "Entry text changed; draft again or review and restamp this card.",
  );
}

/** Copy review and length problems are warnings because the card still works in search. */
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
  for (const message of hedgedExamples(card)) warnings.push(["example-hedged", message]);
  return warnings;
}

/**
 * Reader-facing copy outlives releases, so flag version claims such as `3.2`, `v18.1.0` and `5.x`.
 */
export const versionedPlain = (text: string): boolean =>
  /\bv?\d+(?:\.\d+)+\b|\bv?\d+\.x\b/i.test(text);

/** Every card file under the root's `search/` directory, by name order within each kind. */
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

/**
 * The cards to check. A preview (`view.composition`) and a single-entry run check only their
 * entries; a whole root checks every card file plus every entry without one, so both orphaned
 * cards and missing cards are found.
 */
const selectedRefs = (view: View) => {
  if (view.composition !== undefined) return Effect.succeed(view.entries);
  if (view.only !== undefined) return Effect.succeed([view.only]);
  return Effect.map(sidecarRefs(view.root), (refs) => {
    const existing = new Set(refs.map((ref) => `${ref.kind}/${ref.id}`));
    return [...refs, ...view.entries.filter((entry) => !existing.has(`${entry.kind}/${entry.id}`))];
  });
};

export const searchChecks: Check = Effect.fn("validate.search")(function* (view) {
  const { vocabulary, findings } = yield* vocabularyFor(view);
  const refs = (yield* selectedRefs(view)).filter(view.wanted);
  const cards = yield* Effect.forEach(refs, (ref) =>
    inspectCard({
      view,
      ref,
      vocabulary,
      entry: view.entries.find((entry) => entry.kind === ref.kind && entry.id === ref.id),
    }),
  );
  return { findings: [...findings, ...cards.flat()] };
});
