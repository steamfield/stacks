import type { SearchMetadata, SearchVocabulary, SearchWhy } from "./schema.js";
import { phraseIn, STOP, words } from "./tokens.js";

type FacetConstraint = SearchWhy & { field: "languages" | "platforms"; exclusive: boolean };
type Span = { start: number; end: number };
type Stack = { entry: { id: string; meta: { name: string } } };
export type StackMention = Span & { id: string; text: string; negated: boolean };
const NEGATOR =
  /\b(?:no|without|not(?:\s+using)?|don['’]t|do\s+not|doesn['’]t|won['’]t|avoid|instead\s+of|other\s+than|except|rather\s+than)\s+(?:(?:want|use|need)\s+)?(?:(?:a|an|any|the)\s+){0,2}$/i;
const GENERIC = new Set([...STOP, "site", "starter"]);

/** Single-word vocabulary values and aliases: an id built only from these describes, not names. */
function vocabularyWords(vocabulary: SearchVocabulary): ReadonlySet<string> {
  const groups = [
    vocabulary.platforms,
    vocabulary.productKinds,
    vocabulary.languages,
    vocabulary.capabilities,
  ];
  return new Set(
    groups
      .flatMap((group) => Object.entries(group).flatMap(([value, aliases]) => [value, ...aliases]))
      .map((term) => term.toLowerCase()),
  );
}

function mentionAt(
  request: string,
  options: {
    source: ReadonlyArray<RegExpMatchArray>;
    at: number;
    length: number;
    id: string;
    names: ReadonlySet<string>;
    descriptive: boolean;
    generic: ReadonlySet<string>;
  },
): StackMention | undefined {
  const { source, at, length, id, names, descriptive, generic } = options;
  const slice = source.slice(at, at + length);
  if (slice.length !== length) return undefined;
  const start = slice[0]?.index;
  const last = slice.at(-1);
  if (start === undefined || !last || last.index === undefined) return undefined;
  const end = last.index + last[0].length;
  const text = request.slice(start, end);
  const matchedWords = slice.map((word) => word[0].toLowerCase());
  if (descriptive && (length === 1 || text.toLowerCase() !== id)) return undefined;
  if (!names.has(matchedWords.join(""))) return undefined;
  if (text.toLowerCase() !== id && matchedWords.every((word) => generic.has(word)))
    return undefined;
  const negative = request.slice(0, start).match(NEGATOR);
  return {
    id,
    text,
    start: negative ? start - negative[0].length : start,
    end,
    negated: !!negative,
  };
}

/** Match distinctive stack ids or their leading name words across punctuation variants. */
export function stackMentions(
  request: string,
  stacks: ReadonlyArray<Stack>,
  vocabulary: SearchVocabulary,
): StackMention[] {
  const source = [...request.matchAll(/[\p{L}\p{N}]+/gu)];
  const terms = vocabularyWords(vocabulary);
  const leading = stacks
    .map((stack) => words(stack.entry.meta.name)[0])
    .filter((word) => word !== undefined);
  const counts = new Map<string, number>();
  for (const word of leading) counts.set(word, (counts.get(word) ?? 0) + 1);
  const generic = new Set([
    ...terms,
    ...GENERIC,
    ...leading.filter((word) => (counts.get(word) ?? 0) > 1),
  ]);
  const mentions: StackMention[] = [];
  for (const stack of stacks) {
    const id = stack.entry.id;
    const parts = id.split("-");
    const descriptive = parts.every((part) => terms.has(part));
    const nameWords = words(stack.entry.meta.name).slice(0, 3);
    const names = new Set([
      id.replaceAll("-", ""),
      ...nameWords.slice(1).map((_, index) => nameWords.slice(0, index + 2).join("")),
    ]);
    for (let at = 0; at < source.length; at++) {
      for (let length = 3; length >= 1; length--) {
        const mention = mentionAt(request, {
          source,
          at,
          length,
          id,
          names,
          descriptive,
          generic,
        });
        if (mention) {
          mentions.push(mention);
          at += length - 1;
          break;
        }
      }
    }
  }
  return mentions;
}

export function removeSpans(request: string, spans: ReadonlyArray<Span>): string {
  return request
    .split("")
    .map((char, index) =>
      spans.some((span) => index >= span.start && index < span.end) ? " " : char,
    )
    .join("");
}

function occurrences(request: string, aliases: ReadonlyArray<string>) {
  const pattern = [...new Set(aliases)]
    .map((alias) => words(alias).join("[\\s.-]+"))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .join("|");
  return request.matchAll(new RegExp(`\\b(?:${pattern})\\b`, "gi"));
}

function constraintAt(request: string, occurrence: RegExpMatchArray) {
  const index = occurrence.index;
  if (index === undefined) return undefined;
  const before = request.slice(0, index);
  const after = request.slice(index + occurrence[0].length);
  const negative = before.match(NEGATOR)?.[0];
  const free = after.match(/^-free\b/i)?.[0];
  const only = /\bonly\s+$/i.test(before) || /^\s+only\b/i.test(after);
  const exclusive = !negative && !free;
  if (
    (!negative && !free && !only) ||
    (exclusive && roleScoped(before, after)) ||
    /\bnot\s+only\s+$/i.test(before)
  )
    return undefined;
  const start = index - (negative?.length ?? 0);
  const end = index + occurrence[0].length + (free?.length ?? 0);
  return {
    start,
    end,
    exclusive,
    from: exclusive ? `only ${occurrence[0]}` : request.slice(start, end),
  };
}

function roleScoped(before: string, after: string): boolean {
  const role = "(?:front[ -]?end|back[ -]?end|client|ui)";
  return (
    new RegExp(`\\b${role}\\s+(?:uses?\\s+)?(?:only\\s+)?$`, "i").test(before) ||
    new RegExp(`^\\s*(?:only\\s+)?(?:on|in|for)\\s+(?:the\\s+)?${role}\\b`, "i").test(after)
  );
}

/** Remove negated facets before lexical scoring; keep their original text for explanations. */
export function requestConstraints(request: string, vocabulary: SearchVocabulary) {
  const facets: FacetConstraint[] = [];
  const removed: Span[] = [];
  for (const field of ["languages", "platforms"] as const) {
    for (const [matched, aliases] of Object.entries(vocabulary[field])) {
      for (const occurrence of occurrences(request, [matched, ...aliases])) {
        const constraint = constraintAt(request, occurrence);
        if (!constraint) continue;
        const { from, exclusive } = constraint;
        facets.push({ field, matched, from, exclusive });
        if (!exclusive) removed.push(constraint);
      }
    }
  }
  const positive = removeSpans(request, removed);
  return { positive, facets };
}

export function facetConflicts(
  card: SearchMetadata | undefined,
  facets: ReadonlyArray<FacetConstraint>,
): SearchWhy[] {
  if (card?.kind !== "stack") return [];
  return facets.flatMap((constraint) => {
    const values = card[constraint.field].filter((value) =>
      constraint.exclusive ? value !== constraint.matched : value === constraint.matched,
    );
    return values.length
      ? [
          {
            field: "constraint",
            from: constraint.from,
            matched: `${constraint.from}: entry includes ${values.join(", ")}`,
          },
        ]
      : [];
  });
}

export function existingRepository(request: string): boolean {
  const software = "(?:repo|repository|app|application|project|codebase)";
  const target = `(?:[\\w-]+\\s+){0,3}${software}\\b`;
  // Opening "add" and noun-bound clauses both signal work in an existing repository.
  return [
    "^\\s*(?:(?:please|i want to|i'd like to)\\s+)?add\\b",
    `\\bexisting\\s+${target}`,
    "\\b(?:my|our)\\s+(?:repo|repository)\\b",
    `\\badd\\b[^.!?;]*\\bto\\s+${target}`,
  ].some((pattern) => new RegExp(pattern, "i").test(request));
}

/** Destination clauses exclude migration sources and trailing qualifications. */
export function hostingTarget(request: string): string | undefined {
  const clause = request.match(
    /\b(?:deploy|deployment|host|hosting|publish|migrate)\b([^;!?]*)/i,
  )?.[1];
  const destination = clause
    ?.match(
      /\b(?:to|on)\s+(.+?)(?=\s+(?:instead|from|with|using|for|without|today|tomorrow|now)\b|[,;!?]|$)/i,
    )?.[1]
    ?.trim();
  if (
    !destination ||
    /^(?:my|our|the|a|an|production|staging|local|a\s+server)\b/i.test(destination)
  )
    return undefined;
  return destination;
}

export function missingTarget(
  target: string | undefined,
  texts: ReadonlyArray<string>,
): SearchWhy[] {
  return target && !texts.some((text) => phraseIn(text, target))
    ? [
        {
          field: "constraint",
          from: target,
          matched: `hosting target ${target} is not matched by this entry`,
        },
      ]
    : [];
}
