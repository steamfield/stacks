/**
 * Runs local and hosted ranking concurrently so their latencies don't add together. Use offline
 * registry reads so the index can use its cache without a second request. Capture the caller's
 * offline preference first because it still controls hosted ranking.
 */
import { rank } from "@steamfield/stacks-format";
import { Effect } from "effect";
import { AppConfig } from "../../config";
import { Registry, remoteRoots } from "../registry/registry";
import { searchInput } from "./input";
import { mergeSearch } from "./merge";
import { remoteSearch } from "./remote";

const rankLocally = Effect.fn("search.local")(function* (
  request: string,
  options: { limit: number; kind?: "stack" | "fragment" },
) {
  const roots = yield* remoteRoots;
  const input = yield* searchInput(request, options).pipe(Effect.provide(Registry.layer(roots)));
  // Every candidate is kept so a local override can still replace an official hit when merging.
  return {
    result: rank({
      request,
      entries: input.entries,
      vocabulary: input.vocabulary,
      limit: input.entries.length,
    }),
    overrides: input.overrides,
    statsPopulation: input.statsPopulation,
  };
});

export const search = Effect.fn("search.run")(function* (
  request: string,
  options: { limit: number; kind?: "stack" | "fragment"; local: boolean },
) {
  const config = yield* AppConfig;
  const offline = yield* config.offline;
  yield* config.setOffline(true);
  const [localRanking, remote] = yield* Effect.all(
    [rankLocally(request, options), remoteSearch({ request, ...options, offline })],
    { concurrency: "unbounded" },
  );
  return mergeSearch(localRanking.result, remote, {
    ...options,
    overrides: localRanking.overrides,
    localPopulation: localRanking.statsPopulation,
  });
});
