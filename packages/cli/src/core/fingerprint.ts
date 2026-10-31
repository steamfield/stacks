import { createHash } from "node:crypto";
import { Effect } from "effect";
import { canonicalJson } from "./canonical-json";
import type { Composition } from "./compose/compose";
import { composeFiles, NEUTRAL_VARS, type RenderedFile } from "./compose/files";

/** Hash the composed inputs and shipped files, excluding project settings and fixed CLI prose. */
export const fingerprint = (composition: Composition) =>
  Effect.map(composeFiles(composition, NEUTRAL_VARS), (files) =>
    fingerprintFromFiles(composition, files),
  );

/** Hash an already neutral-rendered snapshot, so scaffold never rereads its sources. */
export const fingerprintFromFiles = (
  composition: Composition,
  files: ReadonlyArray<RenderedFile>,
): string => {
  const hash = createHash("sha256");
  const encoder = new TextEncoder();
  // Each field is decimal byte length + ':' + raw bytes (strings are UTF-8). Framed list
  // counts delimit entries and files, so neither field nor record boundaries can collide.
  const field = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    hash.update(`${bytes.byteLength}:`);
    hash.update(bytes);
  };
  const entries = [composition.stack, ...composition.fragments];
  field(String(entries.length));
  for (const entry of entries) {
    field(entry.kind);
    field(entry.id);
    field(canonicalJson(entry.meta));
    field(entry.body);
  }
  field(composition.preset);
  field(String(files.length));
  for (const file of files) {
    field(file.path);
    field(file.owner);
    field(file.executable ? "1" : "0");
    field(file.bytes);
  }
  return `sha256:${hash.digest("hex")}`;
};
