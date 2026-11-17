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
import { Effect, Schema } from "effect";
import { SEARCH_DIRECTORY } from "../../project-layout";
import { isAbsent } from "../fs/absent";
import { denied } from "../fs/denied";
import type { FileAccess } from "../registry/types";

export function sidecarPath(entry: { kind: Kind; id: string }): string {
  return `${SEARCH_DIRECTORY}/${entry.kind === "stack" ? "stacks" : "fragments"}/${entry.id}.json`;
}

/**
 * Refuse links below the root because a project registry controls these names. Treat a missing
 * path or non-directory ancestor as absent. Other inspection failures report `PermissionDenied`.
 */
export const readSearchFile = Effect.fn("search.readFile")(function* (
  { fs, path }: FileAccess,
  root: string,
  rel: string,
) {
  let at = root;
  for (const part of rel.split("/")) {
    at = path.join(at, part);
    const info = yield* fs
      .lstat(at)
      .pipe(
        Effect.catch((error) =>
          isAbsent(error) ? Effect.succeed(undefined) : Effect.fail(denied("read", at)),
        ),
      );
    if (info === undefined) return undefined;
    if (info.type === "SymbolicLink") return yield* denied("read", at);
  }
  return yield* fs.readFile(at).pipe(Effect.mapError(() => denied("read", at)));
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
