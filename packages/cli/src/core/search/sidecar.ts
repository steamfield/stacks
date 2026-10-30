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

/** No symlink below a registry root may supply search data, including project aliases. */
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
            : Effect.fail(new PermissionDenied({ details: { reason: "read", path: at } })),
        ),
      );
    if (info === undefined) return undefined;
    if (info.type === "SymbolicLink")
      return yield* new PermissionDenied({ details: { reason: "read", path: at } });
  }
  return yield* fs
    .readFile(at)
    .pipe(Effect.mapError(() => new PermissionDenied({ details: { reason: "read", path: at } })));
});

export const decodeSidecar = (bytes: Uint8Array) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(SearchMetadata))(
    new TextDecoder().decode(bytes).replace(/^\uFEFF/, ""),
    { onExcessProperty: "error" },
  );
export const decodeVocabulary = (bytes: Uint8Array) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(SearchVocabulary))(
    new TextDecoder().decode(bytes).replace(/^\uFEFF/, ""),
    { onExcessProperty: "error" },
  );
/** The registry's `authors.json`. */
export const decodeAuthors = (bytes: Uint8Array) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(AuthorsFile))(
    new TextDecoder().decode(bytes).replace(/^﻿/, ""),
  );

export const decodeDependencyCards = (bytes: Uint8Array) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(DependencyCardFile))(
    new TextDecoder().decode(bytes).replace(/^\uFEFF/, ""),
    { onExcessProperty: "error" },
  );
