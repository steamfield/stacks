/**
 * Loads the registry data and evidence for pure local ranking through `rank`. Broken search
 * metadata can cost ranking quality only.
 */
import type { SearchVocabulary, StatsSummary } from "@steamfield/stacks-format";
import { Effect } from "effect";
import { type LedgerRead, readLedger } from "../ledger";
import { toRow } from "../list/index";
import { type Entry, isRejected } from "../registry/entry";
import { Registry } from "../registry/registry";
import { defaultRoots } from "../registry/roots";
import { cachedStats, readStatsCache } from "../stats/cache";
import { decodeSidecar, decodeVocabulary } from "./sidecar";

const emptyVocabulary: SearchVocabulary = {
  schemaVersion: 1,
  platforms: {},
  productKinds: {},
  languages: {},
  capabilities: {},
};

/** Keep local ranking available without aliases if the vocabulary is missing or invalid. */
const readVocabulary = Effect.fn("search.vocabulary")(function* (registry: Registry["Service"]) {
  const bytes = yield* registry.vocabulary;
  if (!bytes) return emptyVocabulary;
  return yield* decodeVocabulary(bytes).pipe(Effect.catch(() => Effect.succeed(emptyVocabulary)));
});

/** Require a matching kind and id so ranking cannot borrow another entry's card. */
const readCard = Effect.fn("search.card")(function* (registry: Registry["Service"], entry: Entry) {
  const bytes = yield* registry.search(entry);
  const decoded = bytes
    ? yield* decodeSidecar(bytes).pipe(Effect.catch(() => Effect.succeed(undefined)))
    : undefined;
  return decoded?.id === entry.id && decoded.kind === entry.kind ? decoded : undefined;
});

const entryInput = Effect.fn("search.entryInput")(function* (
  registry: Registry["Service"],
  entry: Entry,
  evidence: { ledger: LedgerRead | undefined; stats: StatsSummary | undefined },
) {
  const search = yield* readCard(registry, entry);
  const statsRow = cachedStats(evidence.stats, entry);
  return {
    entry,
    ...(search ? { search } : {}),
    evidence: {
      lastRun: toRow(entry, evidence.ledger?.records).lastRun,
      ...(statsRow ? { stats: statsRow } : {}),
    },
  };
});

/** Pass every local override to `mergeSearch`, including rejections that hide an official entry. */
export const searchInput = Effect.fn("search.input")(function* (
  request: string,
  options: { limit: number; kind?: "stack" | "fragment" },
) {
  const registry = yield* Registry;
  const roots = yield* defaultRoots;
  const bundled = roots.find((root) => root.origin === "bundled");
  const ledger = bundled ? yield* readLedger(bundled.path) : undefined;
  const stats = yield* readStatsCache();
  const vocabulary = yield* readVocabulary(registry);
  const visible = yield* registry.all;
  // A rejected local winner still hides the official entry in `show` and `new`, so it overrides.
  const overrides = visible
    .filter((entry) => entry.origin !== "bundled" && entry.origin !== "index")
    .map(({ kind, id }) => ({ kind, id }));
  const entries = yield* Effect.forEach(
    visible.filter((item): item is Entry => !isRejected(item)),
    (entry) => entryInput(registry, entry, { ledger, stats }),
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
