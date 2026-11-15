/**
 * Combines the hosted API's search hits with the local ranking into the one result `stacks search`
 * prints.
 *
 * `run.ts::search` ranks locally and asks the API at the same time, then hands both here. When the
 * API answered, its hits win for official entries (bundled or from the signed index), because the
 * hosted ranking can be fresher. A local override, a project or user entry with the same kind and
 * id as an official one, always wins over the API's hit, since that local entry is the one
 * `stacks new` or `stacks add` would actually use. When the API wasn't used, the local ranking is
 * the result.
 *
 * Evidence is merged per hit: an API hit missing stats or a last run borrows the local value.
 * Because API and local stats can come from different populations, each hit's stats source is
 * tracked so the result can say when any shown number is seeded development data. The requested
 * `limit` and `kind` filter apply only after merging, so an override is never cut before it can
 * replace its official twin.
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

/** The `kind:id` key that identifies one entry across both rankings. */
const hitKey = (hit: Pick<SearchHit, "kind" | "id">) => `${hit.kind}:${hit.id}`;

/** An API hit whose missing stats or last run is filled from the local hit for the same entry. */
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
 * The API's hits, minus overridden entries, joined with the local hits the API didn't return, in
 * rank order; plus where each shown hit's stats came from.
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

/** The final search result: merged hits, the ranking used, the remote status and the population. */
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
