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
  const localById = new Map(local.map((hit) => [`${hit.kind}:${hit.id}`, hit]));
  const official = api
    .filter((hit) => !overrides.has(`${hit.kind}:${hit.id}`))
    .map((hit) => {
      const fallback = localById.get(`${hit.kind}:${hit.id}`)?.evidence;
      const stats = hit.evidence.stats ?? fallback?.stats;
      const lastRun = hit.evidence.lastRun ?? fallback?.lastRun;
      return {
        ...hit,
        evidence: {
          ...(stats ? { stats } : {}),
          ...(lastRun ? { lastRun } : {}),
        },
      };
    });
  const replaced = new Set(official.map((hit) => hit.id));
  return [...local.filter((hit) => !replaced.has(hit.id)), ...official].sort(compareSearchHits);
}

/** The population behind the stats a result shows: seeded when any shown value's source is. */
function shownPopulation(
  shown: ReadonlyArray<SearchHit>,
  remote: RemoteSearch,
  options: { overrides: ReadonlySet<string>; local: StatsPopulation | undefined },
): StatsPopulation | undefined {
  const response = remote.remote === "used" ? remote.response : undefined;
  const fromApi = new Set(
    [...(response?.stacks ?? []), ...(response?.fragments ?? [])]
      .filter((hit) => hit.evidence.stats && !options.overrides.has(`${hit.kind}:${hit.id}`))
      .map((hit) => `${hit.kind}:${hit.id}`),
  );
  const sources = shown
    .filter((hit) => hit.evidence.stats)
    .map((hit) =>
      fromApi.has(`${hit.kind}:${hit.id}`) ? response?.statsPopulation : options.local,
    );
  return sources.includes("seeded development data")
    ? "seeded development data"
    : sources.find((population) => population !== undefined);
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
  const mergedStacks =
    remote.remote === "used"
      ? mergeHits(local.stacks, remote.response.stacks, overrides)
      : local.stacks;
  const mergedFragments =
    remote.remote === "used"
      ? mergeHits(local.fragments, remote.response.fragments, overrides)
      : local.fragments;
  const stacks = options.kind === "fragment" ? [] : limitHits(mergedStacks, options.limit ?? 5);
  const fragments = options.kind === "stack" ? [] : limitHits(mergedFragments, options.limit ?? 5);
  const statsPopulation = shownPopulation([...stacks, ...fragments], remote, {
    overrides,
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
