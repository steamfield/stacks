/**
 * Defines `.stacks/sources.json`: the index `new` or `add` read and where each composed entry came
 * from. A project without the file is valid; `add` replaces one it can't read.
 */
import { Digest, Kind } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { Origin } from "./origin";

export const ProjectSources = Schema.Struct({
  formatVersion: Schema.Literal(1),
  /** The index header in use, or null when no index root was configured or none could be read. */
  index: Schema.NullOr(
    Schema.Struct({ commit: Schema.String, generatedAt: Schema.String, fetchedAt: Schema.String }),
  ),
  /** Sorted by kind, then id, then part. */
  entries: Schema.Array(
    Schema.Struct({
      kind: Kind,
      id: Schema.String,
      origin: Origin,
      /** The entry's canonical bundle digest. */
      digest: Digest,
      /** The workspace part that mounts this stack. */
      part: Schema.optionalKey(Schema.String),
    }),
  ),
});
export type ProjectSources = typeof ProjectSources.Type;
