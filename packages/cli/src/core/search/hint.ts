/** Decides which search hits need an update hint from the cached index and its last outcome. */
import type { SearchHit } from "@steamfield/stacks-format";
import { Effect, Option } from "effect";
import { entryKey } from "../registry/entry";
import { RemoteIndex } from "../registry/remote/service";

export const indexUpdateHint = Effect.fn("search.indexUpdateHint")(function* () {
  const remote = yield* Effect.serviceOption(RemoteIndex);
  if (Option.isNone(remote)) return undefined;
  const index = yield* remote.value.cached;
  const status = yield* remote.value.status;
  if (status.lastOutcome === "unsupported") return () => true;
  if (Option.isNone(index)) return undefined;
  const indexed = new Set(index.value.entries.map(({ kind, id }) => entryKey(kind, id)));
  return (hit: SearchHit) => !indexed.has(entryKey(hit.kind, hit.id));
});
