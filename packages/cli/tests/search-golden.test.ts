import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { expect, test } from "vitest";
import { loadRank, records, vocabulary } from "./helpers/search-command";
import { evaluate } from "./helpers/search-eval";
import { GoldenSet } from "./helpers/search-golden";

test("local ranking meets every golden judgment and the metric gate [4.5c#2]", async () => {
  const rank = await loadRank();
  const entries = await records();
  const aliases = vocabulary();
  const golden = Schema.decodeUnknownSync(GoldenSet)(
    JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/search/golden.json"), "utf8")),
  );
  const ranking = (request: string) => {
    const result = rank({ request, entries, vocabulary: aliases, limit: 20 });
    return [...result.stacks, ...result.fragments];
  };
  for (const query of golden.queries) {
    const hits = ranking(query.query);
    if (query.first !== undefined)
      expect(
        hits.find(({ kind }) => kind === query.first?.kind),
        query.id,
      ).toMatchObject(query.first);
    if (query.noMatch)
      expect(
        hits.filter(({ tier }) => tier === "strong"),
        query.id,
      ).toEqual([]);
  }
  const report = evaluate(ranking, golden);
  for (const split of [report.tune, report.holdout, report.total]) {
    expect(split.firstResult.passed).toBe(split.firstResult.total);
    expect(split.noMatch.passed).toBe(split.noMatch.total);
  }
  for (const metric of ["mrr", "recallAt3", "fragmentRecallAt5"] as const)
    expect(report.total[metric], metric).toBeGreaterThanOrEqual(golden.gate[metric] - 0.02);
  // Ranking every judgment against all 41 stacks takes about 3 s, and more than Vitest's 5 s on
  // CI with coverage.
}, 30_000);
