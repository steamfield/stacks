import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import type { SearchHit, SearchVocabulary } from "@steamfield/stacks-format";
import { type RankRecord, rank } from "@steamfield/stacks-format";
import { Console, Effect, FileSystem, Schema } from "effect";
import { isRejected } from "../src/core/registry/entry";
import { Registry } from "../src/core/registry/registry";
import { decodeSidecar, decodeVocabulary } from "../src/core/search/sidecar";
import { evaluate } from "../tests/helpers/search-eval";
import { GoldenSet } from "../tests/helpers/search-golden";
import { readConfig } from "./decorate/config";

const root = fileURLToPath(new URL("../registry", import.meta.url));
type Options = { split?: "tune" | "holdout"; withoutSidecars: boolean; embeddings: boolean };
function argumentsFor(args: string[]): Options {
  const options: Options = { withoutSidecars: false, embeddings: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--without-sidecars") options.withoutSidecars = true;
    else if (arg === "--embeddings") options.embeddings = true;
    else if (arg === "--split") {
      const split = args[++i];
      if (split !== "tune" && split !== "holdout")
        throw new Error("--split takes tune or holdout.");
      options.split = split;
    } else throw new Error("Use --split tune|holdout, --without-sidecars or --embeddings.");
  }
  return options;
}
const load = Effect.fn("searchEval.load")(function* () {
  const registry = yield* Registry;
  const bytes = yield* registry.vocabulary;
  if (!bytes) return yield* Effect.fail(new Error("Missing bundled vocabulary."));
  const vocabulary = yield* decodeVocabulary(bytes);
  const entries: RankRecord[] = [];
  for (const entry of yield* registry.all) {
    if (isRejected(entry)) continue;
    const bytes = yield* registry.search(entry);
    const search = bytes ? yield* decodeSidecar(bytes) : undefined;
    entries.push({ entry, ...(search ? { search } : {}) });
  }
  const fs = yield* FileSystem.FileSystem;
  const golden = yield* fs
    .readFileString(fileURLToPath(new URL("../tests/fixtures/search/golden.json", import.meta.url)))
    .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(GoldenSet))));
  return { entries, vocabulary, golden };
});
function cardText(record: RankRecord): string {
  const card = record.search;
  return [
    record.entry.id,
    record.entry.meta.name,
    card?.summary ?? record.entry.meta.description,
    ...(card?.requests ?? []),
    ...(card?.useCases ?? []),
    ...(card?.synonyms ?? []),
  ].join("\n");
}
const Embeddings = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      index: Schema.Int,
      embedding: Schema.Array(Schema.Number.check(Schema.isFinite())),
    }),
  ),
});
async function embed(input: string[]): Promise<ReadonlyArray<ReadonlyArray<number>>> {
  const config = readConfig();
  if (!config.key) throw new Error("--embeddings needs OPENROUTER_API_KEY (maintainer only).");
  const response = await fetch(`${config.base}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Embedding provider rejected the request.");
  const decoded = Schema.decodeUnknownSync(Embeddings)(await response.json());
  const ordered = [...decoded.data].sort((a, b) => a.index - b.index);
  const dimension = ordered[0]?.embedding.length;
  if (
    !dimension ||
    ordered.length !== input.length ||
    ordered.some((row, i) => row.index !== i || row.embedding.length !== dimension)
  )
    throw new Error("Invalid embedding response.");
  return ordered.map((row) => row.embedding);
}
function cosine(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  const dot = a.reduce((sum, value, i) => sum + value * (b[i] ?? 0), 0);
  const norm = (v: ReadonlyArray<number>) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return dot / (norm(a) * norm(b) || 1);
}
type EvaluationHit = Pick<SearchHit, "kind" | "id" | "tier" | "score">;
/** Reciprocal rank fusion within kind. Zero lexical scores and nonpositive cosine give no vote. */
function fuse(
  hits: ReadonlyArray<EvaluationHit>,
  similarities: ReadonlyMap<string, number>,
): EvaluationHit[] {
  const semantic = [...hits].sort(
    (a, b) =>
      (similarities.get(`${b.kind}:${b.id}`) ?? 0) - (similarities.get(`${a.kind}:${a.id}`) ?? 0) ||
      a.id.localeCompare(b.id),
  );
  const vote = (hit: EvaluationHit) => {
    const lexicalRank = hits.filter((row) => row.kind === hit.kind).indexOf(hit);
    const semanticRank = semantic.filter((row) => row.kind === hit.kind).indexOf(hit);
    return (
      (hit.score > 0 ? 1 / (61 + lexicalRank) : 0) +
      ((similarities.get(`${hit.kind}:${hit.id}`) ?? 0) > 0 ? 1 / (61 + semanticRank) : 0)
    );
  };
  return [...hits].sort((a, b) => vote(b) - vote(a) || a.id.localeCompare(b.id));
}
type Ranking = (request: string) => ReadonlyArray<EvaluationHit>;
function report(label: string, golden: GoldenSet, ranking: Ranking): string {
  const metrics = (set: GoldenSet) => {
    const value = evaluate(ranking, set).total;
    return `MRR ${value.mrr.toFixed(4)} | recall@3 ${value.recallAt3.toFixed(4)} | fragment recall@5 ${value.fragmentRecallAt5.toFixed(4)} | first ${value.firstResult.passed}/${value.firstResult.total} | no-match ${value.noMatch.passed}/${value.noMatch.total}`;
  };
  const lines = [`${label}: ${metrics(golden)}`, "", "Pool | metrics", "--- | ---"];
  for (const split of ["tune", "holdout"] as const) {
    const queries = golden.queries.filter((query) => query.split === split);
    if (queries.length) lines.push(`${split} | ${metrics({ ...golden, queries })}`);
  }
  for (const pool of [...new Set(golden.queries.map((query) => query.pool))])
    lines.push(
      `${pool} | ${metrics({ ...golden, queries: golden.queries.filter((query) => query.pool === pool) })}`,
    );
  lines.push(
    "",
    `Holdout paraphrase: ${metrics({ ...golden, queries: golden.queries.filter((query) => query.split === "holdout" && query.pool === "paraphrase") })}`,
  );
  return lines.join("\n");
}
function queryReport(
  golden: GoldenSet,
  rankings: ReadonlyArray<{ label: string; rank: Ranking }>,
): string {
  return golden.queries
    .map((query) =>
      [
        `${query.id}: ${query.query}`,
        ...rankings.flatMap((ranking) => {
          const hits = ranking.rank(query.query);
          return ["stack", "fragment"].map(
            (kind) =>
              `${ranking.label} ${kind}s: ${hits
                .filter((hit) => hit.kind === kind)
                .slice(0, 5)
                .map((hit) => `${hit.id} (${hit.tier}, ${hit.score.toFixed(3)})`)
                .join(", ")}`,
          );
        }),
      ].join("\n"),
    )
    .join("\n\n");
}
// Each report ranks every golden query once per split, pool and listing, and the fused ranking
// ranks lexically too. Ranking is pure, so each request is ranked once per run.
function lexicalRank(entries: ReadonlyArray<RankRecord>, vocabulary: SearchVocabulary): Ranking {
  const ranked = new Map<string, ReadonlyArray<EvaluationHit>>();
  return (request) => {
    const known = ranked.get(request);
    if (known !== undefined) return known;
    const result = rank({ request, entries, vocabulary, limit: entries.length });
    const hits = [...result.stacks, ...result.fragments];
    ranked.set(request, hits);
    return hits;
  };
}
const program = Effect.gen(function* () {
  const options = yield* Effect.try(() => argumentsFor(process.argv.slice(2)));
  const data = yield* load();
  const golden = {
    ...data.golden,
    queries: data.golden.queries.filter(
      (query) => options.split === undefined || query.split === options.split,
    ),
  };
  const entries = options.withoutSidecars
    ? data.entries.map(({ entry }) => ({ entry }))
    : data.entries;
  const lexical = lexicalRank(entries, data.vocabulary);
  yield* Console.log(report("Lexical", golden, lexical));
  if (!options.embeddings) {
    yield* writeReport(queryReport(golden, [{ label: "Lexical", rank: lexical }]));
    return;
  }
  const vectors = yield* Effect.tryPromise({
    try: () => embed([...entries.map(cardText), ...golden.queries.map((query) => query.query)]),
    catch: () =>
      new Error("Embedding evaluation failed; check the maintainer provider configuration."),
  });
  const fused: Ranking = (request) => {
    const queryIndex = golden.queries.findIndex((query) => query.query === request);
    const vector = vectors[entries.length + queryIndex] ?? [];
    const similarities = new Map(
      entries.map((record, i) => [
        `${record.entry.kind}:${record.entry.id}`,
        cosine(vector, vectors[i] ?? []),
      ]),
    );
    const ranked = lexical(request);
    const keys = new Set(ranked.map((hit) => `${hit.kind}:${hit.id}`));
    const unranked = entries
      .filter(({ entry }) => !keys.has(`${entry.kind}:${entry.id}`))
      .map(
        ({ entry }): EvaluationHit => ({
          kind: entry.kind,
          id: entry.id,
          tier: "weak",
          score: 0,
        }),
      );
    return fuse([...ranked, ...unranked], similarities);
  };
  yield* Console.log("\nFused ranks use RRF (k=60); tiers remain lexical for this experiment.");
  yield* Console.log(report("Fused", golden, fused));
  yield* writeReport(
    queryReport(golden, [
      { label: "Lexical", rank: lexical },
      { label: "Fused", rank: fused },
    ]),
  );
});
// Past the pipe buffer (64 KiB), Bun dropped the rest of a Console.log once the script ended, so
// the long per-query report waits for its write to finish.
function writeReport(text: string) {
  return Effect.callback<void>((resume) => {
    process.stdout.write(`${text}\n`, () => resume(Effect.void));
  });
}
process.exitCode = await Effect.runPromise(
  program.pipe(
    Effect.provide(Registry.layer([{ origin: "bundled", path: root }])),
    Effect.provide(NodeServices.layer),
    Effect.as(0),
    Effect.catch(() =>
      Console.error(
        "Search evaluation failed. Check arguments, registry data and provider configuration.",
      ).pipe(Effect.as(2)),
    ),
  ),
);
