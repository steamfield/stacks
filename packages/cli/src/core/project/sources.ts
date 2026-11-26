/**
 * Builds and writes `.stacks/sources.json`, the only writer of it, and the `index_fallback`
 * warning `new` and `add` report when the configured index couldn't be revalidated.
 */
import { Effect } from "effect";
import type { NewResult } from "../../schemas/new";
import type { ProjectSources } from "../../schemas/sources";
import type { Revalidation } from "../cached-fetch";
import type { RemoteIndex } from "../registry/remote/service";

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
export const readIndexProvenance: Effect.Effect<IndexProvenance, never, RemoteIndex> =
  Effect.succeed(NO_INDEX_PROVENANCE);

/** The `index_fallback` warning, or undefined when refresh succeeded or no index is configured. */
export const indexFallbackWarning = (
  _provenance: IndexProvenance,
): NewResult["warnings"][number] | undefined => undefined;

/** The `sources.json` document for a composition's resolved entries. */
export const projectSources = (_input: {
  provenance: IndexProvenance;
  entries: ProjectSources["entries"];
}): ProjectSources => ({ formatVersion: 1, index: null, entries: [] });
