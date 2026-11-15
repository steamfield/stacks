import { createHash } from "node:crypto";
import { Effect } from "effect";
import { canonicalJson } from "./canonical-json";
import type { Composition } from "./compose/compose";
import { composeFiles, NEUTRAL_VARS, type RenderedFile } from "./compose/files";
import { Registry } from "./registry/registry";
import { HYGIENE_TAG } from "./verify/plan";

/** Hash the composed inputs and shipped files, excluding project settings and fixed CLI prose. */
export const fingerprint = (composition: Composition) =>
  Effect.map(composeFiles(composition, NEUTRAL_VARS), (files) =>
    fingerprintFromFiles(composition, files),
  );

/** A step's `hygiene` tag only decides whether plain `verify` runs it, so no proof covers it. */
const withoutHygiene = <T extends { readonly tags?: ReadonlyArray<string> | undefined }>(
  step: T,
) => {
  const { tags, ...rest } = step;
  const kept = tags?.filter((tag) => tag !== HYGIENE_TAG) ?? [];
  return kept.length ? { ...rest, tags: kept } : rest;
};

/**
 * What a ledger proof covers: the stack's own directory (STACK.md, and the files, adapters and
 * payload this composition writes from it), the composed verify steps, the preset, payload and added fragments. Shared fragment content is
 * left out; the canaries in `registry/canaries.json` prove it. `fingerprint` still identifies the
 * whole composition for manifests and telemetry.
 */
export const proofFingerprint = (composition: Composition) =>
  Effect.gen(function* () {
    const registry = yield* Registry.pipe(Effect.provide(Registry.layer([])));
    const stack = composition.stack;
    // The stack's sources this composition writes: its selected adapters and payload, not every one.
    const written = composition.files.filter((file) =>
      file.owners.some((owner) => owner.kind === "stack" && owner.id === stack.id),
    );
    const files = (yield* registry.files(stack))
      .filter((file) =>
        written.some((planned) =>
          planned.source
            ? planned.source.entry.kind === "stack" && planned.source.file === file.source
            : planned.path === file.path,
        ),
      )
      .sort((a, b) => (a.source < b.source ? -1 : 1));
    const hash = createHash("sha256");
    const encoder = new TextEncoder();
    // The same framing as `fingerprintFromFiles`: decimal byte length + ':' + raw bytes.
    const field = (value: string | Uint8Array) => {
      const bytes = typeof value === "string" ? encoder.encode(value) : value;
      hash.update(`${bytes.byteLength}:`);
      hash.update(bytes);
    };
    field("proof:1");
    field(stack.id);
    field(composition.preset);
    field(composition.lean ? "lean" : "");
    field(composition.payload ?? "");
    field(
      canonicalJson(
        composition.selection
          .filter((item) => item.via === "with")
          .map((item) => item.id)
          .sort(),
      ),
    );
    // skipByDefault is left out: it follows from the tags and preset, which are hashed.
    field(
      canonicalJson(
        composition.verify.map(({ owner: _owner, skipByDefault: _skip, ...step }) =>
          withoutHygiene(step),
        ),
      ),
    );
    const { meta, body } = stack;
    field(canonicalJson({ ...meta, verify: meta.verify.map(withoutHygiene) }));
    field(body);
    field(String(files.length));
    for (const file of files) {
      field(file.source);
      field((file.mode & 0o111) !== 0 ? "1" : "0");
      field(yield* registry.bytes(stack, file.source));
    }
    return `sha256:${hash.digest("hex")}`;
  });

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
