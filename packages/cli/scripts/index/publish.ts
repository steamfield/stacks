import {
  AuthorsFile,
  authorKey,
  DependencyAllowlist,
  DependencyCards,
  DirectoryData,
  type IndexEntry,
  OfficialNames,
  RegistryIndex,
  SearchIndex,
} from "@steamfield/stacks-format";
import { Console, Effect, Exit, FileSystem, Path, Schema } from "effect";
import type { currentIndex } from "./proof";
import { bundlePath, bundleRefs, fetchBundle, fetchFragment } from "./remote";
import { signIndex } from "./signing";

const headers = `/v1/index.json
  Cache-Control: public, max-age=300, stale-while-revalidate=3600
/v1/entries/*
  Cache-Control: public, max-age=31536000, immutable
/v1/search.json
  Cache-Control: public, max-age=300, stale-while-revalidate=3600
`;

function selectStacks(
  current: Effect.Success<ReturnType<typeof currentIndex>>,
  previous: RegistryIndex | null,
) {
  const entries = new Map(current.entries.map((entry) => [`${entry.kind}/${entry.id}`, entry]));
  const lines: string[] = [];
  for (const id of current.stacks) {
    const old = previous?.entries.find((entry) => entry.kind === "stack" && entry.id === id);
    const fresh = entries.get(`stack/${id}`);
    if (fresh !== undefined && fresh.lastRun === undefined) {
      lines.push(
        `Included stack/${id} unproven: no matching pass with zero interventions and full tamper check.`,
      );
    } else if (fresh !== undefined) {
      lines.push(
        `${old === undefined ? "Added" : "Updated"} stack/${id}: current default composition proven (${fresh.lastRun?.date}, ${fresh.lastRun?.preset}, ${fresh.lastRun?.agent}).`,
      );
    } else if (old !== undefined) {
      entries.set(`stack/${id}`, old);
      lines.push(
        `Carried forward stack/${id}: current default composition has no matching pass with zero interventions and full tamper check.`,
      );
    } else {
      lines.push(
        `Omitted stack/${id}: no matching pass with zero interventions and full tamper check; never published.`,
      );
    }
  }
  return { entries, lines };
}

const includePinnedFragments = Effect.fn("index.includePinnedFragments")(function* (
  entries: Map<string, IndexEntry>,
  options: { previous: RegistryIndex | null; base: string; bundles: Map<string, Uint8Array> },
) {
  const stacks = [...entries.values()].filter((entry) => entry.kind === "stack");
  for (const stack of stacks)
    for (const [id, digest] of Object.entries(stack.composition ?? {})) {
      if (entries.has(`fragment/${id}`)) continue;
      const old = options.previous?.entries.find(
        (entry) => entry.kind === "fragment" && entry.id === id,
      );
      if (old?.digest === digest) {
        entries.set(`fragment/${id}`, old);
      } else {
        const ref = { kind: "fragment", id, digest } as const;
        const value = yield* fetchFragment(options.base, ref);
        options.bundles.set(bundlePath(ref), value.bytes);
        entries.set(`fragment/${id}`, value.metadata);
      }
    }
});

export const carryForward = Effect.fn("index.carryForward")(function* (
  current: Effect.Success<ReturnType<typeof currentIndex>>,
  previous: RegistryIndex | null,
  base: string,
) {
  const { entries, lines } = selectStacks(current, previous);
  yield* includePinnedFragments(entries, { previous, base, bundles: current.bundles });
  const sorted = [...entries.values()].sort((a, b) =>
    `${a.kind}/${a.id}`.localeCompare(`${b.kind}/${b.id}`, "en"),
  );
  // Cached previous indexes still name their original immutable bundle URLs.
  for (const ref of bundleRefs([...sorted, ...(previous?.entries ?? [])])) {
    const at = bundlePath(ref);
    if (!current.bundles.has(at)) current.bundles.set(at, yield* fetchBundle(base, ref));
  }
  return { entries: sorted, bundles: current.bundles, lines };
});

/** The registry's `authors.json`; a registry without one credits nobody. */
export const readAuthors = Effect.fn("index.readAuthors")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(root, "authors.json");
  if (!(yield* fs.exists(file))) return {};
  const text = yield* fs
    .readFileString(file)
    .pipe(Effect.mapError(() => new Error(`${file}: authors could not be read.`)));
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(AuthorsFile))(text).pipe(
    Effect.mapError(() => new Error(`${file}: invalid AuthorsFile.`)),
  );
});

/**
 * Each entry with its creator's login from `authors.json`, which is the only source: a
 * carried-forward entry keeps no author the file no longer names.
 */
export function withAuthors(
  entries: ReadonlyArray<IndexEntry>,
  authors: AuthorsFile,
): IndexEntry[] {
  return entries.map(({ author: _previous, ...entry }) => {
    const key = authorKey(entry.kind, entry.id);
    const login = Object.hasOwn(authors, key) ? authors[key] : undefined;
    return login === undefined ? entry : { ...entry, author: login };
  });
}

const replaceOutput = Effect.fn("index.replaceOutput")(function* (options: {
  stage: string;
  backup: string;
  out: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const existed = yield* fs.exists(options.out);
  yield* Effect.acquireRelease(
    existed ? fs.rename(options.out, options.backup) : Effect.void,
    (_, exit) =>
      Exit.isFailure(exit) && existed
        ? fs.rename(options.backup, options.out).pipe(Effect.orDie)
        : Effect.void,
  );
  yield* fs.rename(options.stage, options.out);
});

export const publish = Effect.fn("index.publish")(function* (options: {
  out: string;
  index: RegistryIndex;
  names: OfficialNames;
  allowlist: DependencyAllowlist;
  deps: DependencyCards;
  search: SearchIndex;
  directory: DirectoryData;
  bundles: ReadonlyMap<string, Uint8Array>;
  key: string | undefined;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const envelope = yield* signIndex(`${JSON.stringify(options.index, null, 2)}\n`, options.key);
  const namesEnvelope = yield* signIndex(
    `${JSON.stringify(options.names, null, 2)}\n`,
    options.key,
  );
  const allowlistEnvelope = yield* signIndex(
    `${JSON.stringify(options.allowlist, null, 2)}\n`,
    options.key,
  );
  const depsEnvelope = yield* signIndex(`${JSON.stringify(options.deps, null, 2)}\n`, options.key);
  yield* Schema.decodeUnknownEffect(SearchIndex)(options.search);
  const searchEnvelope = yield* signIndex(
    `${JSON.stringify(options.search, null, 2)}\n`,
    options.key,
  );
  const directoryEnvelope = yield* signIndex(
    `${JSON.stringify(options.directory, null, 2)}\n`,
    options.key,
  );
  // Encoding checks the same contract the consumer will decode before touching the output.
  yield* Schema.decodeUnknownEffect(RegistryIndex)(options.index);
  yield* Schema.decodeUnknownEffect(OfficialNames)(options.names);
  yield* Schema.decodeUnknownEffect(DependencyAllowlist)(options.allowlist);
  yield* Schema.decodeUnknownEffect(DependencyCards)(options.deps);
  yield* Schema.decodeUnknownEffect(DirectoryData)(options.directory);
  yield* Effect.scoped(
    Effect.gen(function* () {
      yield* fs.makeDirectory(path.dirname(options.out), { recursive: true });
      const temporary = yield* fs.makeTempDirectoryScoped({
        directory: path.dirname(options.out),
        prefix: ".stacks-index-",
      });
      const stage = path.join(temporary, "output");
      yield* fs.makeDirectory(path.join(stage, "v1"), { recursive: true });
      for (const [file, bytes] of options.bundles) {
        const at = path.join(stage, file);
        yield* fs.makeDirectory(path.dirname(at), { recursive: true });
        yield* fs.writeFile(at, bytes);
      }
      yield* fs.writeFileString(
        path.join(stage, "v1/index.json"),
        `${JSON.stringify(envelope, null, 2)}\n`,
      );
      yield* fs.writeFileString(path.join(stage, "_headers"), headers);
      yield* fs.writeFileString(
        path.join(stage, "v1/names.json"),
        `${JSON.stringify(namesEnvelope, null, 2)}\n`,
      );
      yield* fs.writeFileString(
        path.join(stage, "v1/allowlist.json"),
        `${JSON.stringify(allowlistEnvelope, null, 2)}\n`,
      );
      yield* fs.writeFileString(
        path.join(stage, "v1/deps.json"),
        `${JSON.stringify(depsEnvelope, null, 2)}\n`,
      );
      yield* fs.writeFileString(
        path.join(stage, "v1/search.json"),
        `${JSON.stringify(searchEnvelope, null, 2)}\n`,
      );
      yield* fs.writeFileString(
        path.join(stage, "v1/directory.json"),
        `${JSON.stringify(directoryEnvelope, null, 2)}\n`,
      );
      yield* replaceOutput({ stage, backup: path.join(temporary, "previous"), out: options.out });
    }),
  );
  yield* Console.log(
    `Built ${options.index.entries.filter((entry) => entry.kind === "stack").length} stack(s), ${options.index.entries.filter((entry) => entry.kind === "fragment").length} fragment(s), ${options.bundles.size} bundle(s).${options.key === undefined ? " Unsigned; --check will reject this output." : ""}`,
  );
});
