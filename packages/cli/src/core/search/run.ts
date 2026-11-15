/**
 * Runs one `stacks search`: ranks the registry locally and asks the hosted API at the same time,
 * then merges the two.
 *
 * `commands/search.ts` calls `search` and renders what it returns with `report.ts::renderSearch`.
 * The two rankings run concurrently so the API's 800 ms deadline (`remote.ts`) never adds to the
 * local work. Local ranking reads the registry through `input.ts::searchInput` and ranks with the
 * shared `rank` from `@steamfield/stacks-format`; `merge.ts::mergeSearch` then decides which hit
 * wins for each entry and applies the requested limit.
 *
 * Search marks the invocation offline before reading the registry, so the signed remote index is
 * read from its cache and never fetched. The caller's own offline choice is captured first and
 * still decides whether the search API is asked.
 */
import { rank } from "@steamfield/stacks-format";
import { Effect } from "effect";
import { AppConfig } from "../../config";
import { Registry, remoteRoots } from "../registry/registry";
import { searchInput } from "./input";
import { mergeSearch } from "./merge";
import { remoteSearch } from "./remote";

/** Ranks every candidate locally; the requested limit applies only after merging. */
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

/** The merged search result for `request`. */
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
