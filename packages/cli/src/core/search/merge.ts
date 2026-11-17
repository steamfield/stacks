/**
 * Merges local and hosted search hits. Hosted ranking can be fresher, but a local override wins
 * because it is the entry new or add would use.
 */
import {
  compareSearchHits,
  limitHits,
  type RankInput,
  type SearchHit,
  type SearchResult,
  type StatsPopulation,
} from "@steamfield/stacks-format";
import type { RemoteSearch } from "./remote";

type StatsSource = "api" | "local";

const hitKey = (hit: Pick<SearchHit, "kind" | "id">) => `${hit.kind}:${hit.id}`;

/** Borrow missing API evidence from the local hit for the same entry. */
function withLocalEvidence(hit: SearchHit, local: SearchHit | undefined): SearchHit {
  const stats = hit.evidence.stats ?? local?.evidence.stats;
  const lastRun = hit.evidence.lastRun ?? local?.evidence.lastRun;
  return {
    ...hit,
    evidence: {
      ...(stats ? { stats } : {}),
      ...(lastRun ? { lastRun } : {}),
    },
  };
}

/**
 * Keep each hit's stats source because the API and local cache may represent different
 * populations. The combined result can then disclose any seeded development data.
 */
function mergeHits(
  local: ReadonlyArray<SearchHit>,
  api: ReadonlyArray<SearchHit>,
  overrides: ReadonlySet<string>,
) {
  const statsSources = new Map<string, StatsSource>();
  const localByKey = new Map(local.map((hit) => [hitKey(hit), hit]));
  const official = api
    .filter((hit) => !overrides.has(hitKey(hit)))
    .map((hit) => {
      const merged = withLocalEvidence(hit, localByKey.get(hitKey(hit)));
      if (merged.evidence.stats)
        statsSources.set(hitKey(hit), hit.evidence.stats ? "api" : "local");
      return merged;
    });
  const replaced = new Set(official.map(hitKey));
  const retained = local.filter((hit) => !replaced.has(hitKey(hit)));
  for (const hit of retained) if (hit.evidence.stats) statsSources.set(hitKey(hit), "local");
  return { hits: [...retained, ...official].sort(compareSearchHits), statsSources };
}

/** The population behind the stats a result shows: seeded when any shown value's source is. */
function shownPopulation(
  shown: ReadonlyArray<SearchHit>,
  options: {
    sources: ReadonlyMap<string, StatsSource>;
    api: StatsPopulation | undefined;
    local: StatsPopulation | undefined;
  },
): StatsPopulation | undefined {
  const { sources, api, local } = options;
  const populations = shown
    .filter((hit) => hit.evidence.stats)
    .map((hit) => (sources.get(hitKey(hit)) === "api" ? api : local));
  if (populations.includes("seeded development data")) return "seeded development data";
  if (populations.includes(undefined)) return undefined;
  return populations[0];
}

/**
 * Apply limit and kind after merging so a local override cannot be cut before replacing its
 * official counterpart.
 */
export function mergeSearch(
  local: SearchResult,
  remote: RemoteSearch,
  options: Pick<RankInput, "limit" | "kind"> & {
    overrides: ReadonlyArray<Pick<SearchHit, "kind" | "id">>;
    localPopulation?: StatsPopulation;
  },
): SearchResult & { remote: RemoteSearch["remote"] } {
  const overrides = new Set(options.overrides.map(hitKey));
  const localSources = new Map<string, StatsSource>(
    [...local.stacks, ...local.fragments]
      .filter((hit) => hit.evidence.stats)
      .map((hit) => [hitKey(hit), "local"]),
  );
  const mergedStacks =
    remote.remote === "used"
      ? mergeHits(local.stacks, remote.response.stacks, overrides)
      : { hits: local.stacks, statsSources: localSources };
  const mergedFragments =
    remote.remote === "used"
      ? mergeHits(local.fragments, remote.response.fragments, overrides)
      : { hits: local.fragments, statsSources: localSources };
  const stacks =
    options.kind === "fragment" ? [] : limitHits(mergedStacks.hits, options.limit ?? 5);
  const fragments =
    options.kind === "stack" ? [] : limitHits(mergedFragments.hits, options.limit ?? 5);
  const statsPopulation = shownPopulation([...stacks, ...fragments], {
    sources: new Map([...mergedStacks.statsSources, ...mergedFragments.statsSources]),
    api: remote.remote === "used" ? remote.response.statsPopulation : undefined,
    local: options.localPopulation,
  });
  const ranking =
    remote.remote === "used"
      ? ({ ranking: "api", method: remote.response.method } as const)
      : ({ ranking: "local" } as const);
  return {
    ...local,
    ...ranking,
    remote: remote.remote,
    ...(remote.remote === "off" ? { remoteReason: remote.remoteReason } : {}),
    ...(statsPopulation ? { statsPopulation } : {}),
    understood: remote.remote === "used" ? remote.response.understood : local.understood,
    noStrongMatch: ![...stacks, ...fragments].some((hit) => hit.tier === "strong"),
    stacks,
    fragments,
  };
}
