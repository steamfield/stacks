import { Schema } from "effect";
import { DetectedAgent } from "../agent.js";
import { Columnar } from "../columnar.js";
import { Kebab, Kind } from "../entry.js";
import { StatsPopulation } from "../stats.js";

const Origin = Schema.Literals(["project", "user", "index", "bundled"]);
const LastRun = Schema.Struct({
  date: Schema.String,
  result: Schema.Literals(["pass", "partial", "fail", "infra"]),
  agent: DetectedAgent,
  preset: Schema.String,
  fingerprint: Schema.String,
});

const Words = Schema.Array(Schema.String);
const Prose = Schema.String.check(Schema.isPattern(/\S/u));
const ProjectExample = Schema.Struct({
  title: Prose,
  description: Prose,
  stack: Schema.optionalKey(Kebab),
  withFragments: Schema.optionalKey(
    Schema.Array(Kebab).check(
      Schema.makeFilter(
        (ids) => new Set(ids).size === ids.length || "fragment selections must be unique",
      ),
    ),
  ),
});
const PlainItems = Schema.Array(Prose).check(Schema.isMinLength(1));
export const Plain = Schema.Struct({
  whatItIs: Prose,
  goodAt: PlainItems,
  notGoodAt: PlainItems,
});
const Source = Schema.Struct({
  digest: Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)),
  by: Schema.Literals(["author", "drafted"]),
  model: Schema.optionalKey(Schema.String),
  promptVersion: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  reviewedAt: Schema.NullOr(Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))),
});
// Field order is the order `decorate` writes a card in: identity, then the matched fields.
const identity = {
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  source: Source,
  summary: Schema.String,
  description: Schema.optionalKey(Prose),
  /** Display copy only; excluded from ranking and embeddings. */
  seoDescription: Schema.optionalKey(Prose),
  projectExamples: Schema.optionalKey(Schema.Array(ProjectExample)),
  /** Display copy only; excluded from ranking and embeddings. */
  plain: Schema.optionalKey(Plain),
};
const common = {
  requests: Words,
  useCases: Words,
  synonyms: Words,
  goodFor: Words,
  notFor: Words,
  caveats: Schema.optionalKey(Words),
};

/** Size limits are validation warnings; the two kinds have distinct closed fields. */
export const SearchMetadata = Schema.Union([
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    kind: Schema.Literal("stack"),
    ...identity,
    platforms: Words,
    productKinds: Words,
    languages: Words,
    ...common,
  }),
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    kind: Schema.Literal("fragment"),
    ...identity,
    capabilities: Words,
    ...common,
  }),
]);
export type SearchMetadata = typeof SearchMetadata.Type;

const Aliases = Schema.Record(
  Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  Words,
);
export const SearchVocabulary = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  platforms: Aliases,
  productKinds: Aliases,
  languages: Aliases,
  capabilities: Aliases,
});
export type SearchVocabulary = typeof SearchVocabulary.Type;

/** The signed search publication contains the aliases needed to rank its cards. */
export const SearchIndex = Schema.Struct({
  formatVersion: Schema.Literal(1),
  entries: Schema.Array(
    Schema.Union(
      SearchMetadata.members.map((member) =>
        Schema.Struct({ ...member.fields, stale: Schema.optionalKey(Schema.Boolean) }),
      ),
    ),
  ),
  vocabulary: SearchVocabulary,
});
export type SearchIndex = typeof SearchIndex.Type;

const Share = Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum: 0, maximum: 1 }));
export const SearchEvidence = Schema.Struct({
  stats: Schema.optionalKey(
    Schema.Struct({
      greenRateLower: Share,
      sample: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      projects: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      window: Schema.Literals([7, 28]),
    }),
  ),
  lastRun: Schema.optionalKey(Schema.NullOr(LastRun)),
});
export type SearchEvidence = typeof SearchEvidence.Type;
export const SearchWhy = Schema.Struct({
  field: Schema.String,
  matched: Schema.String,
  from: Schema.String,
});
export type SearchWhy = typeof SearchWhy.Type;
export const SearchHit = Schema.Struct({
  kind: Kind,
  id: Schema.String,
  name: Schema.String,
  summary: Schema.String,
  origin: Origin,
  trusted: Schema.Boolean,
  tier: Schema.Literals(["strong", "partial", "weak"]),
  score: Share,
  coverage: Share,
  why: Schema.Array(SearchWhy),
  penalties: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(["platform", "language", "productKind", "notFor", "untrusted"]),
      request: Schema.String,
      entry: Schema.String,
    }),
  ),
  caveats: Schema.optionalKey(Words),
  appliesTo: Schema.optionalKey(Words),
  evidence: SearchEvidence,
});
export type SearchHit = typeof SearchHit.Type;
export const SearchResult = Schema.Struct({
  notice: Schema.optionalKey(Schema.String),
  request: Schema.String,
  ranking: Schema.Literals(["api", "local"]),
  remote: Schema.optionalKey(Schema.Literals(["used", "off", "unavailable"])),
  remoteReason: Schema.optionalKey(
    Schema.Literals(["local_flag", "offline", "do_not_track", "backoff", "no_endpoint"]),
  ),
  method: Schema.optionalKey(Schema.Literals(["lexical", "hybrid"])),
  statsPopulation: Schema.optionalKey(StatsPopulation),
  understood: Schema.Struct({
    platforms: Words,
    productKinds: Words,
    languages: Words,
    capabilities: Words,
    unmatched: Words.annotate({
      description:
        "Request words no entry's strong metadata fields matched; these words may still appear in entry bodies.",
    }),
  }),
  noStrongMatch: Schema.Boolean,
  stacks: Schema.Array(SearchHit),
  fragments: Schema.Array(SearchHit),
});
export type SearchResult = typeof SearchResult.Type;

const ResponseEvidence = Schema.Struct({
  ...SearchEvidence.fields,
  lastRun: Schema.NullOr(LastRun),
});

/**
 * The API ranks official entries and returns no copy of the request text. New fields go at the
 * top level: a column added inside `stacks` or `fragments` fails every older decoder.
 */
export const SearchResponse = Schema.Struct({
  method: Schema.Literals(["lexical", "hybrid"]),
  indexGeneratedAt: Schema.String,
  statsPopulation: Schema.optionalKey(StatsPopulation),
  understood: SearchResult.fields.understood,
  noStrongMatch: SearchResult.fields.noStrongMatch,
  stacks: Columnar(
    Schema.Struct({
      ...SearchHit.fields,
      evidence: ResponseEvidence,
      kind: Schema.Literal("stack"),
      id: Kebab,
      origin: Schema.Literal("index"),
      trusted: Schema.Literal(true),
    }),
  ),
  fragments: Columnar(
    Schema.Struct({
      ...SearchHit.fields,
      evidence: ResponseEvidence,
      kind: Schema.Literal("fragment"),
      id: Kebab,
      origin: Schema.Literal("index"),
      trusted: Schema.Literal(true),
    }),
  ),
});
export type SearchResponse = typeof SearchResponse.Type;
