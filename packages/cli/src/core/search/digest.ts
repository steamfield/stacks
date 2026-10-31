import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import type { Entry } from "../registry/entry";

/** The framed per-entry inputs used by fingerprint, without files or adapter selection. */
export function searchSourceDigest(entry: Pick<Entry, "kind" | "id" | "meta" | "body">): string {
  const hash = createHash("sha256");
  for (const value of [entry.kind, entry.id, canonicalJson(entry.meta), entry.body]) {
    const bytes = new TextEncoder().encode(value);
    hash.update(`${bytes.byteLength}:`);
    hash.update(bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}
