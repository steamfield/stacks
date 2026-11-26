/**
 * Which index `new` and `add` read: refreshes it once before the first registry read, and turns a
 * failed refresh into the `index_fallback` warning their results report.
 */
import { Effect, Option } from "effect";
import type { NewResult } from "../../schemas/new";
import type { ProjectSources } from "../../schemas/sources";
import type { Revalidation } from "../cached-fetch";
import { defined } from "../object";
import { RemoteIndex } from "../registry/remote/service";

/** The index header a project records, with when the CLI fetched that index. */
export type IndexHeader = NonNullable<ProjectSources["index"]>;

/** What `RemoteIndex.refresh` left: its outcome and the header of the index now in use. */
export type IndexProvenance = {
  revalidation: Revalidation;
  index: IndexHeader | undefined;
};

/** No index root configured: no request, no warning, `index: null`. */
export const NO_INDEX_PROVENANCE: IndexProvenance = {
  revalidation: { source: "none" },
  index: undefined,
};

/** Refreshes the index once for the invocation and reads the header now in use. */
export const readIndexProvenance: Effect.Effect<IndexProvenance> = Effect.gen(function* () {
  const service = yield* Effect.serviceOption(RemoteIndex);
  if (Option.isNone(service)) return NO_INDEX_PROVENANCE;
  const remote = service.value;
  const revalidation = yield* remote.refresh;
  const cached = yield* remote.cached;
  if (Option.isNone(cached)) return { revalidation, index: undefined };
  const { commit, generatedAt } = cached.value;
  const { cachedAt, lastAttempt } = yield* remote.status;
  // A fresh index can still be used in memory when its cache cannot be written.
  const fetchedAt = cachedAt ?? lastAttempt;
  return {
    revalidation,
    index: fetchedAt === null ? undefined : { commit, generatedAt, fetchedAt },
  };
});

/** The `index_fallback` warning, or undefined when refresh succeeded or no index is configured. */
export const indexFallbackWarning = ({
  revalidation: { source, reason, cachedAt },
}: IndexProvenance): NewResult["warnings"][number] | undefined => {
  if (source === "fresh" || source === "revalidated" || reason === undefined) return undefined;
  return defined({
    code: "index_fallback",
    id: "index",
    reason,
    cachedAt: source === "cached" ? cachedAt : undefined,
  });
};
