/**
 * Reads cached published stats for search, which leaves cache updates to `Stats.summary`. Missing,
 * unreadable or invalid summaries yield no stats.
 */
import type { SearchEvidence } from "@steamfield/stacks-format";
import { type Kind, StatsSummary } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path, Schema } from "effect";
import { AppConfig } from "../../config";

/** The cached published summary at any age, or undefined when it can't be read or decoded. */
export const readStatsCache = Effect.fn("statsCache.read")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const paths = yield* (yield* AppConfig).paths;
  return yield* fs.readFileString(path.join(paths.cache, "stats", "summary.json")).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(StatsSummary))),
    Effect.catch(() => Effect.succeed(undefined)),
  );
});

/** The search evidence for one entry, or undefined when unpublished, missing or suppressed. */
export function cachedStats(
  summary: StatsSummary | undefined,
  ref: { id: string; kind: Kind },
): SearchEvidence["stats"] {
  if (!summary?.published) return undefined;
  const row = summary.items.find((item) => item.kind === ref.kind && item.id === ref.id);
  if (!row || row.greenRate.suppressed || row.projects.suppressed) return undefined;
  return {
    greenRateLower: row.greenRate.lower,
    sample: row.greenRate.sample,
    projects: row.projects.value,
    window: summary.window,
  };
}
