/**
 * Hashes the parts of an entry that a search card describes, so the CLI can tell when a card has
 * gone stale.
 *
 * A search card (the sidecar JSON under the registry's search directory) carries hand-written
 * metadata about one entry, plus `source.digest`, the value this function returned when the card
 * was written. When the entry's text later changes, the two digests differ and the card is flagged
 * stale: `show` marks it (`core/show.ts`), `validate` reports it (`core/validate/search.ts`) and
 * `submit` refreshes it (`core/submit/assemble.ts`). The digest is persisted in committed cards, so
 * its bytes must never change.
 *
 * It covers the entry's kind, id, frontmatter and body, framed the same way `fingerprint.ts`
 * frames a field (decimal byte length, `:`, then the UTF-8 bytes), and leaves out shipped files.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import type { Entry } from "../registry/entry";

/** The `sha256:` digest of an entry's kind, id, canonical frontmatter and body, in that order. */
export function searchSourceDigest(entry: Pick<Entry, "kind" | "id" | "meta" | "body">): string {
  const hash = createHash("sha256");
  for (const value of [entry.kind, entry.id, canonicalJson(entry.meta), entry.body]) {
    const bytes = new TextEncoder().encode(value);
    hash.update(`${bytes.byteLength}:`);
    hash.update(bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}
