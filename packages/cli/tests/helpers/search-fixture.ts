import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Kind } from "@steamfield/stacks-format";
import { SearchMetadata } from "@steamfield/stacks-format";
import { Effect, Schema } from "effect";
import { decodeEntry } from "../../src/core/registry/entry";
import { searchSourceDigest } from "../../src/core/search/digest";
import { sidecarPath } from "../../src/core/search/sidecar";
import type { Finding } from "../../src/schemas/validate";
import { copyVocabulary } from "./search-metadata";

/** Complete a synthetic bundled registry after building or deliberately editing its entries. */
export function reviewSearchFixture(root: string, vocabularyRoot?: string): void {
  mkdirSync(join(root, "search"), { recursive: true });
  copyVocabulary(root, vocabularyRoot);
  for (const [kind, directory, markdown] of [
    ["stack", "stacks", "STACK.md"],
    ["fragment", "fragments", "FRAGMENT.md"],
  ] as const) {
    const parent = join(root, directory);
    if (!existsSync(parent) || lstatSync(parent).isSymbolicLink()) continue;
    for (const name of readdirSync(parent, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const file = join(parent, name.name, markdown);
      if (!existsSync(file) || !lstatSync(file).isFile()) continue;
      writeSearchCard({ root, kind, id: name.name, file });
    }
  }
}

function writeSearchCard({
  root,
  kind,
  id,
  file,
}: {
  root: string;
  kind: Kind;
  id: string;
  file: string;
}) {
  const decoded = Effect.runSync(decodeEntry(kind, readFileSync(file, "utf8")));
  if (decoded._tag !== "Meta" || decoded.meta.id !== id) return;
  const ref = { kind, id };
  const target = join(root, sidecarPath(ref));
  const existing = existsSync(target)
    ? Schema.decodeUnknownSync(Schema.fromJsonString(SearchMetadata))(readFileSync(target, "utf8"))
    : undefined;
  const card =
    existing ??
    Schema.decodeUnknownSync(SearchMetadata)({
      schemaVersion: 1,
      ...ref,
      source: {
        by: "author",
        reviewedAt: "2026-10-27",
        digest: searchSourceDigest({ ...ref, meta: decoded.meta, body: decoded.body }),
      },
      summary: "A synthetic registry entry for CLI tests.",
      ...(kind === "stack"
        ? { platforms: ["cli"], productKinds: ["cli-tool"], languages: ["typescript"] }
        : { capabilities: [] }),
      requests: [
        "exercise a fixture workflow",
        "inspect a sample project",
        "check a local example",
      ],
      useCases: [],
      synonyms: [],
      goodFor: [],
      notFor: [],
    });
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(
    target,
    `${JSON.stringify(
      Schema.encodeSync(SearchMetadata)({
        ...card,
        source: {
          ...card.source,
          by: "author",
          reviewedAt: "2026-10-27",
          digest: searchSourceDigest({ ...ref, meta: decoded.meta, body: decoded.body }),
        },
      }),
      null,
      2,
    )}\n`,
  );
}

/** Exact expected notes for fixture entries intentionally left without optional personal cards. */
export function missingSearchCards(options: {
  stacks?: readonly string[];
  fragments?: readonly string[];
}): Finding[] {
  return (["stack", "fragment"] as const).flatMap((kind) =>
    (kind === "stack" ? (options.stacks ?? []) : (options.fragments ?? [])).map((id) => ({
      check: "search-missing",
      severity: "note",
      kind,
      entry: id,
      file: sidecarPath({ kind, id }),
      message: "No search card; add a reviewed sidecar for search discovery.",
    })),
  );
}

export const missingSearchNotes = (options: Parameters<typeof missingSearchCards>[0]) =>
  missingSearchCards(options).map(
    ({ check, severity, kind, entry, file, message }) =>
      [check, severity, { kind, entry, file, text: [message] }] as const,
  );
