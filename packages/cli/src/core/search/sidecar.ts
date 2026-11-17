/**
 * Reads and decodes registry metadata stored outside entries. Symlink checks keep a project
 * registry from supplying arbitrary local files.
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

export function sidecarPath(entry: { kind: Kind; id: string }): string {
  return `${SEARCH_DIRECTORY}/${entry.kind === "stack" ? "stacks" : "fragments"}/${entry.id}.json`;
}

const readDenied = (path: string) => new PermissionDenied({ details: { reason: "read", path } });

/**
 * Refuse links below the root because a project registry controls these names. Treat a missing
 * path or non-directory ancestor as absent. Other inspection failures report `PermissionDenied`.
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

export const decodeSidecar = (bytes: Uint8Array) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(SearchMetadata))(jsonText(bytes), {
    onExcessProperty: "error",
  });
export const decodeVocabulary = (bytes: Uint8Array) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(SearchVocabulary))(jsonText(bytes), {
    onExcessProperty: "error",
  });
/** Authors data is the only sidecar decode that allows unknown keys. */
export const decodeAuthors = (bytes: Uint8Array) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(AuthorsFile))(jsonText(bytes));

/** One ecosystem's dependency cards, `deps/<ecosystem>.json` in the bundled registry. */
export const decodeDependencyCards = (bytes: Uint8Array) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(DependencyCardFile))(jsonText(bytes), {
    onExcessProperty: "error",
  });
