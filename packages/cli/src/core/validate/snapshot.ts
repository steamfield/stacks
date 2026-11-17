/**
 * Caches registry reads within one validation invocation to avoid repeating file I/O across
 * compositions. Composition can return fresh entry objects, so cache lookups recover the original
 * entry by directory.
 */
import { Cache, Data, Effect } from "effect";
import { type Entry, isRejected } from "../registry/entry";
import { Registry } from "../registry/registry";

/** A cache key compared by value, so two requests for the same entry and file share one read. */
class ReadRequest extends Data.Class<{ entry: Entry; source: string }> {}

export const snapshotRegistry = Effect.gen(function* () {
  const registry = yield* Registry;
  const loaded = new Map(
    (yield* registry.all).flatMap((entry) =>
      isRejected(entry) ? [] : [[entry.dir, entry] as const],
    ),
  );
  const original = (entry: Entry) => loaded.get(entry.dir) ?? entry;
  const files = yield* Cache.make({ capacity: Number.MAX_SAFE_INTEGER, lookup: registry.files });
  const reads = yield* Cache.make({
    capacity: Number.MAX_SAFE_INTEGER,
    lookup: ({ entry, source }: ReadRequest) => registry.read(entry, source),
  });
  const bytes = yield* Cache.make({
    capacity: Number.MAX_SAFE_INTEGER,
    lookup: ({ entry, source }: ReadRequest) => registry.bytes(entry, source),
  });
  return Registry.of({
    ...registry,
    files: (entry) => Cache.get(files, original(entry)),
    read: (entry, source) => Cache.get(reads, new ReadRequest({ entry: original(entry), source })),
    bytes: (entry, source) => Cache.get(bytes, new ReadRequest({ entry: original(entry), source })),
  });
});
