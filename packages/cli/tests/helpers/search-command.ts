import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { Kind, SearchHit, StatsPopulation } from "@steamfield/stacks-format";
import { SearchMetadata, SearchVocabulary } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { expect } from "vitest";
import type { Entry } from "../../src/core/registry/entry";
import type { LastRun } from "../../src/schemas/ledger";
import { quiet, runCli } from "./cli";
import {
  bundled,
  card,
  cardPath,
  entryAt,
  put,
  readJson,
  seed,
  sourceDigest,
} from "./search-metadata";

// Consumer contracts for exports that do not exist yet. No production test-only hooks.
export type Evidence = {
  readonly stats?: {
    readonly greenRateLower: number;
    readonly sample: number;
    readonly projects: number;
    readonly window: 7 | 28;
  };
  readonly lastRun?: LastRun | null;
};
export type Hit = {
  readonly kind: Kind;
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly origin: Entry["origin"];
  readonly trusted: boolean;
  readonly tier: "strong" | "partial" | "weak";
  readonly score: number;
  readonly coverage: number;
  readonly why: ReadonlyArray<{
    readonly field: string;
    readonly matched: string;
    readonly from: string;
  }>;
  readonly penalties: SearchHit["penalties"];
  readonly caveats?: ReadonlyArray<string>;
  readonly appliesTo?: ReadonlyArray<string>;
  readonly evidence: Evidence;
};
export type SearchView = {
  readonly request: string;
  readonly ranking: "local";
  readonly statsPopulation?: StatsPopulation;
  readonly understood: {
    readonly platforms: ReadonlyArray<string>;
    readonly productKinds: ReadonlyArray<string>;
    readonly languages: ReadonlyArray<string>;
    readonly capabilities: ReadonlyArray<string>;
    readonly unmatched: ReadonlyArray<string>;
  };
  readonly noStrongMatch: boolean;
  readonly stacks: ReadonlyArray<Hit>;
  readonly fragments: ReadonlyArray<Hit>;
};
export type RankRecord = {
  readonly entry: Entry;
  readonly search?: SearchMetadata;
  readonly evidence?: Evidence;
};
export type Rank = (input: {
  readonly request: string;
  readonly entries: ReadonlyArray<RankRecord>;
  readonly vocabulary: SearchVocabulary;
  readonly limit?: number;
  readonly kind?: Kind;
}) => SearchView;

export async function loadRank(): Promise<Rank> {
  const modulePath = join(import.meta.dirname, "../../../format/src/search/rank.ts");
  return (await import(modulePath)).rank;
}
export async function searchSchema(): Promise<Schema.Codec<SearchView>> {
  const modulePath = join(import.meta.dirname, "../../../format/src/search/schema.ts");
  return (await import(modulePath)).SearchResult;
}
export async function hitSchema(): Promise<Schema.Codec<Hit>> {
  const modulePath = join(import.meta.dirname, "../../../format/src/search/schema.ts");
  return (await import(modulePath)).SearchHit;
}
export const vocabulary = () =>
  Schema.decodeUnknownSync(SearchVocabulary)(readJson(join(bundled, "search/vocabulary.json")));

export async function records(root = bundled): Promise<RankRecord[]> {
  const { readdirSync } = await import("node:fs");
  const entries: RankRecord[] = [];
  for (const kind of ["stack", "fragment"] as const) {
    for (const id of readdirSync(join(root, `${kind}s`)).sort()) {
      const ref = { kind, id };
      const entry = await entryAt(root, ref);
      const search = Schema.decodeUnknownSync(SearchMetadata)(readJson(cardPath(root, ref)));
      entries.push({ entry, search });
    }
  }
  return entries;
}

export async function fixtureRecord(
  root: string,
  id: string,
  overrides: { kind?: Kind; search?: Partial<SearchMetadata>; entry?: Partial<Entry> } = {},
): Promise<RankRecord> {
  const ref = { kind: overrides.kind ?? "stack", id };
  seed(root, ref);
  const search = Schema.decodeUnknownSync(SearchMetadata)({
    ...card(ref, await sourceDigest(root, ref)),
    summary: "An iOS journal for tracking workouts.",
    ...(ref.kind === "stack" ? { platforms: ["ios"], languages: ["typescript"] } : {}),
    requests: ["track workouts on an iphone"],
    notFor: [],
    ...overrides.search,
  });
  put(cardPath(root, ref), JSON.stringify(search));
  return { entry: { ...(await entryAt(root, ref)), ...overrides.entry }, search };
}

export function options(home: string, registry = bundled): Parameters<typeof runCli>[1] {
  return {
    home: realpathSync(home),
    env: { ...quiet, XDG_STATE_HOME: join(realpathSync(home), "state") },
    host: { registry, cwd: realpathSync(home) },
  };
}
export async function searched(
  request: string | ReadonlyArray<string>,
  opts: Parameters<typeof runCli>[1] = {},
  flags: ReadonlyArray<string> = [],
) {
  const result = await runCli(
    ["search", ...(typeof request === "string" ? [request] : request), ...flags, "--json"],
    opts,
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  return {
    ...result,
    value: Schema.decodeUnknownSync(await searchSchema())(JSON.parse(result.stdout)),
  };
}
export function hit(hits: ReadonlyArray<Hit>, id: string): Hit {
  const found = hits.find((row) => row.id === id);
  expect(found, `Missing search hit ${id}`).toBeDefined();
  if (found === undefined) throw new Error(`Missing search hit ${id}`);
  return found;
}
export function mobileCaveats() {
  const value = Schema.decodeUnknownSync(SearchMetadata)(
    JSON.parse(readFileSync(cardPath(bundled, { kind: "stack", id: "mobile-expo" }), "utf8")),
  );
  expect(value.caveats?.length).toBeGreaterThan(0);
  return value.caveats ?? [];
}
