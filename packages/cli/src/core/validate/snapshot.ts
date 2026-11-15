/**
 * A caching wrapper around the registry for one `stacks validate` run.
 *
 * Validating a registry composes every stack many times over (each preset, each extra fragment,
 * each coding-agent adapter), and every composition reads the same entry files again.
 * `index.ts::validate` provides `snapshotRegistry` in place of the plain `Registry`, so each file
 * listing, text read and byte read happens once per run. The cache lives inside the Effect that
 * builds it, so nothing carries over to the next invocation.
 *
 * Composition hands back fresh entry objects (with conditional sections resolved), so a lookup
 * first maps an entry back to the one the registry loaded, by its directory, before using it as
 * a cache key.
 */
import { Cache, Data, Effect } from "effect";
import { type Entry, isRejected } from "../registry/entry";
import { Registry } from "../registry/registry";

/** A cache key compared by value, so two requests for the same entry and file share one read. */
class ReadRequest extends Data.Class<{ entry: Entry; source: string }> {}

/** Repeated compositions share checked reads within this validation, never across invocations. */
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
