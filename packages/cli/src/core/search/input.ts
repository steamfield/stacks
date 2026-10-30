import type { SearchVocabulary } from "@steamfield/stacks-format";
import { Effect } from "effect";
import { readLedger } from "../ledger";
import { toRow } from "../list";
import { type Entry, isRejected } from "../registry/entry";
import { defaultRoots, Registry } from "../registry/registry";
import { cachedStats, readStatsCache } from "../stats-cache";
import { decodeSidecar, decodeVocabulary } from "./sidecar";

const emptyVocabulary: SearchVocabulary = {
  schemaVersion: 1,
  platforms: {},
  productKinds: {},
  languages: {},
  capabilities: {},
};
export const searchInput = Effect.fn("search.input")(function* (
  request: string,
  options: { limit: number; kind?: "stack" | "fragment" },
) {
  const registry = yield* Registry;
  const roots = yield* defaultRoots;
  const bundled = roots.find((root) => root.origin === "bundled");
  const ledger = bundled ? yield* readLedger(bundled.path) : undefined;
  const stats = yield* readStatsCache();
  const bytes = yield* registry.vocabulary;
  const vocabulary = bytes
    ? yield* decodeVocabulary(bytes).pipe(Effect.catch(() => Effect.succeed(emptyVocabulary)))
    : emptyVocabulary;
  const visible = yield* registry.all;
  // Rejected local winners still hide official entries in show/new.
  const overrides = visible
    .filter((entry) => entry.origin !== "bundled" && entry.origin !== "index")
    .map(({ kind, id }) => ({ kind, id }));
  const entries = yield* Effect.forEach(
    visible.filter((item): item is Entry => !isRejected(item)),
    (entry) =>
      Effect.gen(function* () {
        const bytes = yield* registry.search(entry);
        const decoded = bytes
          ? yield* decodeSidecar(bytes).pipe(Effect.catch(() => Effect.succeed(undefined)))
          : undefined;
        const search =
          decoded?.id === entry.id && decoded.kind === entry.kind ? decoded : undefined;
        const statsRow = cachedStats(stats, entry);
        return {
          entry,
          ...(search ? { search } : {}),
          evidence: {
            lastRun: toRow(entry, ledger?.records).lastRun,
            ...(statsRow ? { stats: statsRow } : {}),
          },
        };
      }),
  );
  return {
    request,
    entries,
    vocabulary,
    overrides,
    ...(stats?.published ? { statsPopulation: stats.population } : {}),
    ...options,
  };
});
