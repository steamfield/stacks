import {
  compareSearchHits,
  limitHits,
  type RankInput,
  type SearchHit,
  type SearchResult,
  type StatsPopulation,
} from "@steamfield/stacks-format";
import type { RemoteSearch } from "./remote";

/** Official hits can be fresher; a local override is always the entry new would use. */
function mergeHits(
  local: ReadonlyArray<SearchHit>,
  api: ReadonlyArray<SearchHit>,
  overrides: ReadonlySet<string>,
) {
  const statsSources = new Map<string, "api" | "local">();
  const localById = new Map(local.map((hit) => [`${hit.kind}:${hit.id}`, hit]));
  const official = api
    .filter((hit) => !overrides.has(`${hit.kind}:${hit.id}`))
    .map((hit) => {
      const key = `${hit.kind}:${hit.id}`;
      const fallback = localById.get(`${hit.kind}:${hit.id}`)?.evidence;
      const stats = hit.evidence.stats ?? fallback?.stats;
      if (stats) statsSources.set(key, hit.evidence.stats ? "api" : "local");
      const lastRun = hit.evidence.lastRun ?? fallback?.lastRun;
      return {
        ...hit,
        evidence: {
          ...(stats ? { stats } : {}),
          ...(lastRun ? { lastRun } : {}),
        },
      };
    });
  const replaced = new Set(official.map((hit) => `${hit.kind}:${hit.id}`));
  const retained = local.filter((hit) => !replaced.has(`${hit.kind}:${hit.id}`));
  for (const hit of retained)
    if (hit.evidence.stats) statsSources.set(`${hit.kind}:${hit.id}`, "local");
  return { hits: [...retained, ...official].sort(compareSearchHits), statsSources };
}

/** The population behind the stats a result shows: seeded when any shown value's source is. */
function shownPopulation(
  shown: ReadonlyArray<SearchHit>,
  sources: ReadonlyMap<string, "api" | "local">,
  api: StatsPopulation | undefined,
  local: StatsPopulation | undefined,
): StatsPopulation | undefined {
  const populations = shown
    .filter((hit) => hit.evidence.stats)
    .map((hit) => (sources.get(`${hit.kind}:${hit.id}`) === "api" ? api : local));
  if (populations.includes("seeded development data")) return "seeded development data";
  if (populations.includes(undefined)) return undefined;
  return populations[0];
}

export function mergeSearch(
  local: SearchResult,
  remote: RemoteSearch,
  options: Pick<RankInput, "limit" | "kind"> & {
    overrides: ReadonlyArray<Pick<SearchHit, "kind" | "id">>;
    localPopulation?: StatsPopulation;
  },
): SearchResult & { remote: RemoteSearch["remote"] } {
  const overrides = new Set(options.overrides.map((entry) => `${entry.kind}:${entry.id}`));
  const localSources = new Map<string, "api" | "local">(
    [...local.stacks, ...local.fragments]
      .filter((hit) => hit.evidence.stats)
      .map((hit) => [`${hit.kind}:${hit.id}`, "local"]),
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
  const statsPopulation = shownPopulation(
    [...stacks, ...fragments],
    new Map([...mergedStacks.statsSources, ...mergedFragments.statsSources]),
    remote.remote === "used" ? remote.response.statsPopulation : undefined,
    options.localPopulation,
  );
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
