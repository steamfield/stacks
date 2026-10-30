import { rank } from "@steamfield/stacks-format";
import { Effect } from "effect";
import { AppConfig } from "../../config";
import { Registry, remoteRoots } from "../registry/registry";
import { searchInput } from "./input";
import { mergeSearch } from "./merge";
import { remoteSearch } from "./remote";

export const search = Effect.fn("search.run")(function* (
  request: string,
  options: { limit: number; kind?: "stack" | "fragment"; local: boolean },
) {
  const config = yield* AppConfig;
  const offline = yield* config.offline;
  // Only the index is cache-only. Preserve the caller's offline choice for the API.
  yield* config.setOffline(true);
  const local = Effect.gen(function* () {
    const roots = yield* remoteRoots;
    const input = yield* searchInput(request, options).pipe(Effect.provide(Registry.layer(roots)));
    // Keep every candidate for local overrides and apply the requested limit after merging.
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
  const [localRanking, remote] = yield* Effect.all(
    [local, remoteSearch({ request, ...options, offline })],
    { concurrency: "unbounded" },
  );
  return mergeSearch(localRanking.result, remote, {
    ...options,
    overrides: localRanking.overrides,
    localPopulation: localRanking.statsPopulation,
  });
});
