import type { FragmentMeta, Kind, StackMeta } from "../entry.js";
import { bm25 } from "./bm25.js";
import {
  existingRepository,
  facetConflicts,
  hostingTarget,
  missingTarget,
  removeSpans,
  requestConstraints,
  type StackMention,
  stackMentions,
} from "./constraints.js";
import { constraintReasons, excluded } from "./explain.js";
import type {
  SearchEvidence,
  SearchHit,
  SearchMetadata,
  SearchResult,
  SearchVocabulary,
  SearchWhy,
} from "./schema.js";
import { surfaceForms, tokens } from "./tokens.js";
import { type Category, categories, matchedWords, vocabularyMatches } from "./vocabulary.js";

export type RankRecord = {
  readonly entry: {
    readonly id: string;
    readonly kind: Kind;
    readonly origin: SearchHit["origin"];
    readonly trusted: boolean;
    readonly meta: StackMeta | FragmentMeta;
    readonly body: string;
  };
  readonly search?: SearchMetadata;
  readonly evidence?: SearchEvidence;
};
export type RankInput = {
  readonly request: string;
  readonly entries: ReadonlyArray<RankRecord>;
  readonly vocabulary: SearchVocabulary;
  readonly limit?: number;
  readonly kind?: Kind;
};
type Field = { name: string; weight: number; text: string; words: string[] };
type Candidate = {
  record: RankRecord;
  fields: Field[];
  why: SearchWhy[];
  covered: Set<string>;
  raw: number;
  constraints: SearchWhy[];
};
type RankContext = {
  stacks: ReadonlyArray<RankRecord>;
  targets: ReadonlyArray<RankRecord>;
  mentionText: string;
  strongStacks: ReadonlySet<string>;
  matches: SearchWhy[];
  denominator: number;
  mentions: ReadonlyArray<StackMention>;
  positive: string;
};
const field = (name: string, weight: number, text: string): Field => ({
  name,
  weight,
  text,
  words: tokens(text),
});

function bestRequest(requests: ReadonlyArray<string>, query: ReadonlyArray<string>): string {
  const overlap = (text: string) =>
    new Set(tokens(text).filter((word) => query.includes(word))).size;
  return (
    [...requests].sort(
      (a, b) =>
        overlap(b) - overlap(a) || tokens(a).length - tokens(b).length || a.localeCompare(b),
    )[0] ?? ""
  );
}
function fieldsFor(record: RankRecord, query: ReadonlyArray<string>): Field[] {
  const { entry, search } = record;
  const fields = [
    field("id", 2, entry.id),
    field("name", 2, entry.meta.name),
    field("description", 1.5, entry.meta.description),
    field("tags", 1, entry.meta.tags.join(" ")),
    field("body", 0.15, entry.body),
  ];
  if (entry.meta.kind === "fragment") fields.push(field("category", 1, entry.meta.category));
  if (search)
    fields.push(
      field("summary", 1.5, search.summary),
      field("requests", 2.5, bestRequest(search.requests, query)),
      field("useCases", 1.5, search.useCases.join(" ")),
      field("synonyms", 1.5, search.synonyms.join(" ")),
      field("goodFor", 1, search.goodFor.join(" ")),
    );
  return fields;
}
function categoryValues(
  card: SearchMetadata | undefined,
  category: Category,
): ReadonlyArray<string> {
  if (!card) return [];
  if (card.kind === "fragment") return category === "capabilities" ? card.capabilities : [];
  return category === "capabilities" ? [] : card[category];
}
function prepare(
  input: RankInput,
  query: string[],
  matches: SearchWhy[],
  constraints: ReturnType<typeof requestConstraints>,
): Candidate[] {
  const forms = surfaceForms(input.request);
  const existing = existingRepository(input.request);
  const target = hostingTarget(input.request);
  return input.entries.map((record) => {
    const why = matches.filter((match) =>
      categories.some(
        (category) =>
          category === match.field &&
          categoryValues(record.search, category).includes(match.matched),
      ),
    );
    const covered = new Set(why.flatMap((reason) => matchedWords(input.request, reason)));
    const fields = fieldsFor(record, query);
    for (const f of fields) {
      const matched = query.filter((word) => f.words.includes(word));
      if (matched.length) {
        const from = matched.flatMap((word) => forms.get(word) ?? []).join(" ");
        why.push({ field: f.name, matched: from, from });
      }
      if (f.weight >= 1.5) for (const word of matched) covered.add(word);
    }
    const conflicts = [
      ...facetConflicts(record.search, constraints.facets),
      ...missingTarget(
        target,
        fields.filter((f) => f.name !== "body").map((f) => f.text),
      ),
      ...constraintReasons(existing && record.entry.kind === "stack", input.request),
    ];
    return { record, fields, why, covered, raw: 0, constraints: conflicts };
  });
}
function scoreFields(candidates: Candidate[], query: string[], matches: SearchWhy[]) {
  const names = new Set(candidates.flatMap((candidate) => candidate.fields.map((f) => f.name)));
  for (const name of names) {
    const fields = candidates.map((candidate) => candidate.fields.find((f) => f.name === name));
    const scores = bm25(
      fields.map((f) => f?.words ?? []),
      query,
    );
    candidates.forEach((candidate, i) => {
      candidate.raw += (scores[i] ?? 0) * (fields[i]?.weight ?? 0);
    });
  }
  for (const category of categories) {
    const keys = matches.filter((match) => match.field === category).map((match) => match.matched);
    const scores = bm25(
      candidates.map((candidate) => categoryValues(candidate.record.search, category)),
      keys,
    );
    candidates.forEach((candidate, i) => {
      candidate.raw += (scores[i] ?? 0) * 3;
    });
  }
}
function incompatible(
  record: RankRecord,
  category: "platforms" | "languages",
  desired: ReadonlyArray<string>,
): boolean {
  return (
    desired.length > 0 &&
    record.search?.kind === "stack" &&
    !categoryValues(record.search, category).some((value) => desired.includes(value))
  );
}
function mismatch(
  record: RankRecord,
  stacks: ReadonlyArray<RankRecord>,
  category: "platforms" | "languages",
  desired: ReadonlyArray<string>,
): ReadonlyArray<string> | undefined {
  if (record.entry.meta.kind === "stack")
    return incompatible(record, category, desired)
      ? categoryValues(record.search, category)
      : undefined;
  const applies = record.entry.meta.appliesTo;
  if (applies.length === 0 || desired.length === 0) return undefined;
  const targets = stacks.filter((stack) => fits(stack, applies));
  return targets.length > 0 && targets.every((stack) => incompatible(stack, category, desired))
    ? [...new Set(targets.flatMap((stack) => categoryValues(stack.search, category)))]
    : undefined;
}
function fits(stack: RankRecord, applies: ReadonlyArray<string>): boolean {
  return applies.some(
    (selector) => selector === stack.entry.id || stack.entry.meta.tags.includes(selector),
  );
}
function penaltyRequest(matches: ReadonlyArray<SearchWhy>): string {
  return matches
    .map((match) =>
      match.from === match.matched ? match.from : `${match.from} (${match.matched})`,
    )
    .join(", ");
}
function penaltiesFor(candidate: Candidate, context: RankContext): SearchHit["penalties"] {
  const { stacks, targets, mentionText, strongStacks, matches, mentions, positive } = context;
  const penalties: SearchHit["penalties"][number][] = [];
  for (const [category, penalty] of [
    ["platforms", "platform"],
    ["languages", "language"],
  ] as const) {
    const requested = matches.filter((match) => match.field === category);
    const conflicting = mismatch(
      candidate.record,
      stacks,
      category,
      requested.map((match) => match.matched),
    );
    if (conflicting)
      penalties.push({
        kind: penalty,
        request: penaltyRequest(requested),
        entry: conflicting.join(", ") || "(none listed)",
      });
  }
  const kinds = categoryValues(candidate.record.search, "productKinds");
  const requested = matches.filter((match) => match.field === "productKinds");
  if (
    requested.length > 0 &&
    kinds.length > 0 &&
    !requested.some((match) => kinds.includes(match.matched))
  )
    penalties.push({
      kind: "productKind",
      request: penaltyRequest(requested),
      entry: kinds.join(", "),
    });
  const exclusion = excluded(positive, candidate.record.search);
  if (exclusion) penalties.push({ kind: "notFor", ...exclusion });
  const negated = mentions.find(
    (mention) =>
      mention.negated &&
      candidate.record.entry.kind === "stack" &&
      mention.id === candidate.record.entry.id,
  );
  if (negated)
    penalties.push({
      kind: "notFor",
      request: negated.text,
      entry: "excluded by name in the request",
    });
  const applies =
    candidate.record.entry.meta.kind === "fragment" ? candidate.record.entry.meta.appliesTo : [];
  if (
    targets.length > 0 &&
    applies.length > 0 &&
    !targets.some((stack) => fits(stack, applies)) &&
    !stacks.some((stack) => strongStacks.has(stack.entry.id) && fits(stack, applies))
  )
    penalties.push({
      kind: "notFor",
      request: mentionText,
      entry: `applies to ${applies.join(", ")}`,
    });
  if (!candidate.record.entry.trusted)
    penalties.push({
      kind: "untrusted",
      request: "",
      entry: candidate.record.entry.origin,
    });
  return penalties;
}
function penaltyFactor(penalty: SearchHit["penalties"][number]): number {
  switch (penalty.kind) {
    case "platform":
    case "language":
    case "productKind":
      return 0.3;
    case "notFor":
      return 0.5;
    case "untrusted":
      return 1;
  }
}
function penalizedScore(raw: number, scale: number, penalties: SearchHit["penalties"]): number {
  let score = raw / (raw + scale);
  let applied = 0;
  for (const factor of penalties.map(penaltyFactor).sort((a, b) => a - b)) {
    if (factor === 1) continue;
    score *= applied === 0 ? factor : Math.sqrt(factor);
    applied++;
  }
  return score;
}
function hitFor(candidate: Candidate, context: RankContext): SearchHit {
  const { denominator } = context;
  const { entry, search, evidence } = candidate.record;
  const penalties = [
    ...penaltiesFor(candidate, context),
    ...candidate.constraints.map((reason) => ({
      kind: "notFor" as const,
      request: reason.from,
      entry: reason.matched,
    })),
  ];
  const scale = entry.kind === "stack" ? 1 : 20;
  const score = penalizedScore(candidate.raw, scale, penalties);
  const coverage = denominator === 0 ? 0 : candidate.covered.size / denominator;
  const hasStrongReason = candidate.why.some(
    (reason) =>
      reason.field === "id" ||
      reason.field === "name" ||
      categories.some((category) => category === reason.field),
  );
  let tier: SearchHit["tier"] = "weak";
  if (score >= 0.5 && coverage >= 0.5 && hasStrongReason && penalties.length === 0) tier = "strong";
  else if (score >= 0.25) tier = "partial";
  return {
    kind: entry.kind,
    id: entry.id,
    name: entry.meta.name,
    summary: search?.summary ?? entry.meta.description,
    origin: entry.origin,
    trusted: entry.trusted,
    tier,
    score,
    coverage,
    why: [...candidate.why, ...candidate.constraints],
    penalties,
    ...(search?.caveats ? { caveats: search.caveats } : {}),
    ...(entry.meta.kind === "fragment" ? { appliesTo: entry.meta.appliesTo } : {}),
    evidence: evidence ?? {},
  };
}
function quality(hit: SearchHit): number {
  // Confident stats reorder close hits within a tier; the scalar keeps comparison transitive.
  if (hit.evidence.stats) {
    const { greenRateLower, sample, projects } = hit.evidence.stats;
    const confidence = Math.min(1, sample / 200);
    return (
      confidence *
      (0.03 * (greenRateLower - 0.6) + 0.01 * Math.min(1, Math.log10(1 + projects) / 4))
    );
  }
  if (hit.evidence.lastRun?.result === "pass") return 0.002;
  if (hit.evidence.lastRun?.result === "fail") return -0.002;
  return 0;
}
const tierOrder = { strong: 0, partial: 1, weak: 2 } as const;
export function compareSearchHits(a: SearchHit, b: SearchHit): number {
  return (
    tierOrder[a.tier] - tierOrder[b.tier] ||
    Number(b.trusted) - Number(a.trusted) ||
    b.score + quality(b) - (a.score + quality(a)) ||
    (b.evidence.stats?.projects ?? 0) - (a.evidence.stats?.projects ?? 0) ||
    a.id.localeCompare(b.id)
  );
}
/** A reason that can list a hit: a request constraint or the intent verb "add" alone can't. */
function listedReason(reason: SearchWhy): boolean {
  return reason.field !== "constraint" && reason.matched.toLowerCase() !== "add";
}
/** Rounds, drops unmatched hits and keeps at most two weak hits once anything fits better. */
export function limitHits(hits: ReadonlyArray<SearchHit>, limit: number): SearchHit[] {
  const matched = hits
    .map((hit) => ({
      ...hit,
      score: Number(hit.score.toFixed(3)),
      coverage: Number(hit.coverage.toFixed(3)),
    }))
    .filter((hit) => hit.score > 0 && hit.why.some(listedReason));
  const weakLimit = matched.some((hit) => hit.tier !== "weak") ? 2 : limit;
  let weakCount = 0;
  return matched.filter((hit) => hit.tier !== "weak" || weakCount++ < weakLimit).slice(0, limit);
}
/** Pure, invocation-independent ranking over plain data; no service, file, network or clock. */
export function rank(input: RankInput): SearchResult {
  const request = input.request.trim();
  const stackRecords = input.entries.filter((record) => record.entry.kind === "stack");
  const mentions = stackMentions(request, stackRecords, input.vocabulary);
  const targetIds = new Set(
    mentions.filter((mention) => !mention.negated).map((mention) => mention.id),
  );
  const targets = stackRecords.filter((stack) => targetIds.has(stack.entry.id));
  const mentionTexts = new Map<string, string>();
  for (const mention of mentions.filter((mention) => !mention.negated))
    if (!mentionTexts.has(mention.text.toLowerCase()))
      mentionTexts.set(mention.text.toLowerCase(), mention.text);
  const mentionText = [...mentionTexts.values()].join(", ");
  const constraints = requestConstraints(
    removeSpans(
      request,
      mentions.filter((mention) => mention.negated),
    ),
    input.vocabulary,
  );
  const query = [...new Set(tokens(constraints.positive))];
  const matches = vocabularyMatches(constraints.positive, input.vocabulary);
  const candidates = prepare(input, query, matches, constraints);
  const strongWords = new Set(candidates.flatMap((candidate) => [...candidate.covered]));
  scoreFields(candidates, query, matches);
  const context: RankContext = {
    stacks: stackRecords,
    targets,
    mentionText,
    strongStacks: new Set(),
    matches,
    denominator: strongWords.size,
    mentions,
    positive: constraints.positive,
  };
  const eligibleStackHits = candidates
    .filter((candidate) => candidate.record.entry.kind === "stack")
    .map((candidate) => hitFor(candidate, context));
  const strongStacks = new Set(
    eligibleStackHits.filter((hit) => hit.tier === "strong").map((hit) => hit.id),
  );
  const stackHits = eligibleStackHits.map((hit) =>
    hit.tier === "strong" && targets.length > 0 && !targetIds.has(hit.id)
      ? { ...hit, tier: "partial" as const }
      : hit,
  );
  const hits = [
    ...stackHits,
    ...candidates
      .filter((candidate) => candidate.record.entry.kind === "fragment")
      .map((candidate) => hitFor(candidate, { ...context, strongStacks })),
  ].sort(compareSearchHits);
  const stacks =
    input.kind === "fragment"
      ? []
      : limitHits(
          hits.filter((hit) => hit.kind === "stack"),
          input.limit ?? 5,
        );
  const fragments =
    input.kind === "stack"
      ? []
      : limitHits(
          hits.filter((hit) => hit.kind === "fragment"),
          input.limit ?? 5,
        );
  const understood = {
    platforms: [],
    productKinds: [],
    languages: [],
    capabilities: [],
    unmatched: [...surfaceForms(constraints.positive)]
      .filter(([word]) => !strongWords.has(word))
      .map(([, surface]) => surface),
  } satisfies SearchResult["understood"];
  return {
    request,
    ranking: "local",
    understood: {
      ...understood,
      ...Object.fromEntries(
        categories.map((category) => [
          category,
          matches.filter((match) => match.field === category).map((match) => match.matched),
        ]),
      ),
    },
    noStrongMatch: ![...stacks, ...fragments].some((hit) => hit.tier === "strong"),
    stacks,
    fragments,
  };
}
