/**
 * Reads and decodes the registry's data files that sit outside entry directories: search cards,
 * the search vocabulary, `authors.json` and the dependency cards.
 *
 * A search card is a sidecar JSON file (`search/stacks/<id>.json` or `search/fragments/<id>.json`
 * under a registry root) with hand-written search metadata for one entry. The vocabulary
 * (`search/vocabulary.json`) maps aliases to the platforms, languages and capabilities search
 * understands. `core/registry/registry.ts` reads these through `readSearchFile`, and search,
 * `show`, `validate`, `create` and `submit` decode them with the decoders below.
 *
 * Reads refuse symlinks at every step of the path below the root, because a link there could make
 * a project registry feed the CLI any file on the machine. A missing file is absent; anything the
 * CLI couldn't look at fails as `PermissionDenied`. Decoders strip a leading byte-order mark, and
 * all but `decodeAuthors` reject unknown keys.
 */
import type { Kind } from "@steamfield/stacks-format";
import {
  AuthorsFile,
  DependencyCardFile,
  SearchMetadata,
  SearchVocabulary,
} from "@steamfield/stacks-format";
import { Effect, FileSystem, Path, Schema } from "effect";
import { PermissionDenied } from "../../errors";
import { SEARCH_DIRECTORY } from "../../project-layout";

/** An entry's search card path, relative to its registry root. */
export function sidecarPath(entry: { kind: Kind; id: string }): string {
  return `${SEARCH_DIRECTORY}/${entry.kind === "stack" ? "stacks" : "fragments"}/${entry.id}.json`;
}

const readDenied = (path: string) => new PermissionDenied({ details: { reason: "read", path } });

/**
 * The bytes at `rel` below `root`, or `undefined` when some part of the path doesn't exist or isn't
 * a directory. No symlink below a registry root may supply search data, including project aliases.
 */
export const readSearchFile = Effect.fn("search.readFile")(function* (root: string, rel: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  let at = root;
  for (const part of rel.split("/")) {
    at = path.join(at, part);
    const info = yield* fs
      .lstat(at)
      .pipe(
        Effect.catch((error) =>
          error.reason._tag === "NotFound" || error.reason._tag === "BadResource"
            ? Effect.succeed(undefined)
            : Effect.fail(readDenied(at)),
        ),
      );
    if (info === undefined) return undefined;
    if (info.type === "SymbolicLink") return yield* readDenied(at);
  }
  return yield* fs.readFile(at).pipe(Effect.mapError(() => readDenied(at)));
});

/** The file's text without a leading byte-order mark, which some editors write. */
const jsonText = (bytes: Uint8Array) => new TextDecoder().decode(bytes).replace(/^﻿/, "");

/** An entry's search card. */
export const decodeSidecar = (bytes: Uint8Array) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(SearchMetadata))(jsonText(bytes), {
    onExcessProperty: "error",
  });
/** The bundled registry's `search/vocabulary.json`. */
export const decodeVocabulary = (bytes: Uint8Array) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(SearchVocabulary))(jsonText(bytes), {
    onExcessProperty: "error",
  });
/** The registry's `authors.json`. */
export const decodeAuthors = (bytes: Uint8Array) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(AuthorsFile))(jsonText(bytes));

/** One ecosystem's dependency cards, `deps/<ecosystem>.json` in the bundled registry. */
export const decodeDependencyCards = (bytes: Uint8Array) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(DependencyCardFile))(jsonText(bytes), {
    onExcessProperty: "error",
  });
