import {
  bundleDigest,
  DependencyAllowlist,
  DependencyCards,
  DirectoryData,
  EntryBundle,
  type IndexEntry,
  OfficialNames,
  RegistryIndex,
  SearchIndex,
  SignedIndex,
} from "@steamfield/stacks-format";
import { Effect, Schema } from "effect";
import { decodeEntry } from "../../src/core/registry/entry";
import { verifySignature } from "./signing";

export type BundleRef = Pick<IndexEntry, "kind" | "id" | "digest">;
export const bundlePath = (entry: BundleRef) =>
  `v1/entries/${entry.kind}/${entry.id}/${entry.digest}.json`;

/** Every bundle the entries name: their own, their pinned fragments' and their pinned parts'. */
export function bundleRefs(entries: ReadonlyArray<IndexEntry>): BundleRef[] {
  const refs = new Map<string, BundleRef>();
  const add = (ref: BundleRef) => refs.set(bundlePath(ref), ref);
  for (const entry of entries) {
    add(entry);
    for (const [id, digest] of Object.entries(entry.composition ?? {}))
      add({ kind: "fragment", id, digest });
    for (const { stack, digest } of Object.values(entry.parts ?? {}))
      add({ kind: "stack", id: stack, digest });
  }
  return [...refs.values()].sort((a, b) => bundlePath(a).localeCompare(bundlePath(b), "en"));
}

/** The file's text, or null when the host answers 404. */
const fetchOptionalText = (url: string) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    },
    catch: () => new Error(`${url}: could not fetch file.`),
  });

const fetchText = (url: string) =>
  fetchOptionalText(url).pipe(
    Effect.flatMap((text) =>
      text === null
        ? Effect.fail(new Error(`${url}: could not fetch file.`))
        : Effect.succeed(text),
    ),
  );

/** A signed document's payload, verified against the maintainer keys and decoded. */
const signedPayload = Effect.fnUntraced(function* <S extends Schema.Codec<unknown, unknown>>(
  url: string,
  text: string,
  payload: { schema: S; name: string },
) {
  const envelope = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SignedIndex))(text).pipe(
    Effect.mapError(() => new Error(`${url}: invalid SignedIndex.`)),
  );
  yield* verifySignature(envelope, url);
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(payload.schema))(
    envelope.payload,
  ).pipe(Effect.mapError(() => new Error(`${url}: invalid ${payload.name} payload.`)));
});

export const fetchIndex = Effect.fn("index.fetchIndex")(function* (url: string) {
  const text = yield* fetchText(url);
  return yield* signedPayload(url, text, { schema: RegistryIndex, name: "RegistryIndex" });
});

export const fetchNames = Effect.fn("index.fetchNames")(function* (url: string) {
  // The first names build can use an index published before names.json existed.
  const text = yield* fetchOptionalText(url);
  if (text === null) return null;
  return yield* signedPayload(url, text, { schema: OfficialNames, name: "OfficialNames" });
});

export const fetchAllowlist = Effect.fn("index.fetchAllowlist")(function* (url: string) {
  const text = yield* fetchText(url);
  return yield* signedPayload(url, text, {
    schema: DependencyAllowlist,
    name: "DependencyAllowlist",
  });
});

export const fetchDependencyCards = Effect.fn("index.fetchDependencyCards")(function* (
  url: string,
) {
  const text = yield* fetchText(url);
  return yield* signedPayload(url, text, { schema: DependencyCards, name: "DependencyCards" });
});

export const fetchSearch = Effect.fn("index.fetchSearch")(function* (url: string) {
  const text = yield* fetchOptionalText(url);
  if (text === null) return null;
  return yield* signedPayload(url, text, { schema: SearchIndex, name: "SearchIndex" });
});

export const fetchPreviousDirectory = Effect.fn("index.fetchPreviousDirectory")(function* (
  url: string,
) {
  const text = yield* fetchOptionalText(url);
  if (text === null) return null;
  return yield* signedPayload(url, text, { schema: DirectoryData, name: "DirectoryData" });
});

export const fetchBundle = Effect.fn("index.fetchBundle")(function* (base: string, ref: BundleRef) {
  const url = new URL(bundlePath(ref), base).href;
  const text = yield* fetchText(url);
  const bundle = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(EntryBundle))(text).pipe(
    Effect.mapError(() => new Error(`${url}: invalid EntryBundle.`)),
  );
  if (
    bundle.kind !== ref.kind ||
    bundle.id !== ref.id ||
    (yield* bundleDigest(bundle)) !== ref.digest
  )
    return yield* Effect.fail(new Error(`${url}: bundle digest or identity mismatch.`));
  return new TextEncoder().encode(text);
});

export const fetchFragment = Effect.fn("index.fetchFragment")(function* (
  base: string,
  ref: BundleRef,
) {
  const bytes = yield* fetchBundle(base, ref);
  const bundle = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(EntryBundle))(
    new TextDecoder().decode(bytes),
  );
  const file = bundle.files.find((file) => file.path === "FRAGMENT.md");
  const invalid = () => new Error(`${bundlePath(ref)}: invalid fragment metadata.`);
  if (file === undefined) return yield* Effect.fail(invalid());
  const text =
    file.encoding === "utf8" ? file.content : Buffer.from(file.content, "base64").toString("utf8");
  const decoded = yield* decodeEntry("fragment", text);
  if (decoded._tag !== "Meta" || decoded.meta.id !== ref.id) return yield* Effect.fail(invalid());
  const metadata: IndexEntry = {
    id: ref.id,
    kind: "fragment",
    digest: ref.digest,
    schemaVersion: decoded.meta.schemaVersion,
    name: decoded.meta.name,
    description: decoded.meta.description,
    tags: decoded.meta.tags,
  };
  return { metadata, bytes };
});

export const checkHost = Effect.fn("index.checkHost")(function* (base: URL) {
  const root = new URL(`${base.href.replace(/\/$/, "")}/`).href;
  const index = yield* fetchIndex(new URL("v1/index.json", root).href);
  const refs = bundleRefs(index.entries);
  for (const ref of refs) yield* fetchBundle(root, ref);
  const namesUrl = new URL("v1/names.json", root).href;
  if ((yield* fetchNames(namesUrl)) === null)
    return yield* Effect.fail(new Error(`${namesUrl}: could not fetch file (HTTP 404).`));
  const allowlistUrl = new URL("v1/allowlist.json", root).href;
  yield* fetchAllowlist(allowlistUrl);
  const depsUrl = new URL("v1/deps.json", root).href;
  yield* fetchDependencyCards(depsUrl);
  const searchUrl = new URL("v1/search.json", root).href;
  if ((yield* fetchSearch(searchUrl)) === null)
    return yield* Effect.fail(new Error(`${searchUrl}: could not fetch file (HTTP 404).`));
  const directoryUrl = new URL("v1/directory.json", root).href;
  if ((yield* fetchPreviousDirectory(directoryUrl)) === null)
    return yield* Effect.fail(new Error(`${directoryUrl}: could not fetch file (HTTP 404).`));
  return `Checked v1/index.json, v1/names.json, v1/allowlist.json, v1/deps.json, v1/search.json, v1/directory.json and ${refs.length} bundle(s).`;
});
