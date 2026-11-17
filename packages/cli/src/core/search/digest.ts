/**
 * Hashes entry identity and text without shipped files to detect stale search cards. The digest format
 * is stable because committed cards store it.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import type { Entry } from "../registry/entry";

/** Match `framedHash` fields: decimal byte length, a colon and the UTF-8 bytes. */
export function searchSourceDigest(entry: Pick<Entry, "kind" | "id" | "meta" | "body">): string {
  const hash = createHash("sha256");
  // This field order is part of the digest stored in existing cards.
  for (const value of [entry.kind, entry.id, canonicalJson(entry.meta), entry.body]) {
    const bytes = new TextEncoder().encode(value);
    hash.update(`${bytes.byteLength}:`);
    hash.update(bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}
