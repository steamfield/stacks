/**
 * Gathers everything local ranking needs when someone runs `stacks search`.
 *
 * Ranking itself (`rank` in `@steamfield/stacks-format`, shared with the hosted API) is pure, so
 * this module does the reading first: every usable entry in the registry, each entry's search card
 * (the optional sidecar JSON of hand-written search metadata), the bundled vocabulary of aliases,
 * the latest bundled run from the ledger and any cached published stats. `run.ts::search` calls
 * `searchInput` and passes the result to `rank`.
 *
 * Search data is a hint, never a reason to fail: an unreadable or mismatched card is dropped and
 * an invalid vocabulary falls back to an empty one, so a broken sidecar costs ranking quality only.
 */
import type { SearchVocabulary, StatsSummary } from "@steamfield/stacks-format";
import { Effect } from "effect";
import { type LedgerRead, readLedger } from "../ledger";
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

/** The bundled vocabulary, or an empty one when it is missing or doesn't decode. */
const readVocabulary = Effect.fn("search.vocabulary")(function* (registry: Registry["Service"]) {
  const bytes = yield* registry.vocabulary;
  if (!bytes) return emptyVocabulary;
  return yield* decodeVocabulary(bytes).pipe(Effect.catch(() => Effect.succeed(emptyVocabulary)));
});

/** The entry's search card, kept only when it decodes and names this same entry. */
const readCard = Effect.fn("search.card")(function* (registry: Registry["Service"], entry: Entry) {
  const bytes = yield* registry.search(entry);
  const decoded = bytes
    ? yield* decodeSidecar(bytes).pipe(Effect.catch(() => Effect.succeed(undefined)))
    : undefined;
  return decoded?.id === entry.id && decoded.kind === entry.kind ? decoded : undefined;
});

/** One rank input: the entry, its card when there is one, and its run and stats evidence. */
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

/**
 * The rank input for `request`, plus `overrides`: every project or user entry (rejected ones
 * included), which hides the official hit with the same kind and id when results are merged.
 */
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
