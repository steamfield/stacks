import type { IndexEntry, SearchIndex } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path } from "effect";
import { decodeEntry, markdownFile } from "../../src/core/registry/entry";
import type { FileAccess } from "../../src/core/registry/types";
import { searchSourceDigest } from "../../src/core/search/digest";
import {
  decodeSidecar,
  decodeVocabulary,
  readSearchFile,
  sidecarPath,
} from "../../src/core/search/sidecar";
import { readBundle } from "./bundle";

const VOCABULARY_FILE = "search/vocabulary.json";
const vocabularyError = () =>
  new Error(`${VOCABULARY_FILE}: missing or invalid search vocabulary.`);

/** The bundled vocabulary `rank` needs; the build fails without a valid one. */
const readVocabulary = (io: FileAccess, root: string) =>
  readSearchFile(io, root, VOCABULARY_FILE).pipe(
    Effect.flatMap((bytes) =>
      bytes === undefined ? Effect.fail(vocabularyError()) : decodeVocabulary(bytes),
    ),
    Effect.mapError(vocabularyError),
  );

export const indexSearch = Effect.fn("index.search")(function* (options: {
  root: string;
  entries: ReadonlyArray<IndexEntry>;
  bundles: ReadonlyMap<string, Uint8Array>;
  previous: SearchIndex | null;
}) {
  const io = { fs: yield* FileSystem.FileSystem, path: yield* Path.Path };
  const vocabulary = yield* readVocabulary(io, options.root);
  const entries: SearchIndex["entries"][number][] = [];
  for (const ref of options.entries) {
    const bytes = yield* readSearchFile(io, options.root, sidecarPath(ref));
    const card =
      bytes === undefined
        ? options.previous?.entries.find((card) => card.kind === ref.kind && card.id === ref.id)
        : yield* decodeSidecar(bytes);
    const invalid = () =>
      new Error(`${sidecarPath(ref)}: missing or invalid indexed search metadata.`);
    if (card === undefined || card.kind !== ref.kind || card.id !== ref.id)
      return yield* Effect.fail(invalid());
    const bundle = yield* readBundle(ref, options.bundles);
    const file = bundle.files.find((file) => file.path === markdownFile(ref.kind));
    if (file === undefined) return yield* Effect.fail(invalid());
    const text =
      file.encoding === "utf8"
        ? file.content
        : Buffer.from(file.content, "base64").toString("utf8");
    const decoded = yield* decodeEntry(ref.kind, text);
    if (decoded._tag !== "Meta") return yield* Effect.fail(invalid());
    const digest = searchSourceDigest({
      kind: ref.kind,
      id: ref.id,
      meta: decoded.meta,
      body: decoded.body,
    });
    // Drop any previous publication's stale annotation before comparing with this bundle.
    const { stale: _stale, ...current } = { stale: false, ...card };
    entries.push({ ...current, ...(card.source.digest === digest ? {} : { stale: true }) });
  }
  return { formatVersion: 1, entries, vocabulary } satisfies SearchIndex;
});
