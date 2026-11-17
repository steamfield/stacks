/**
 * Computes composition and proof fingerprints. Neutral template values keep project names and
 * authors out of the composition digest. See `proofFingerprint` for how stack proofs stay current
 * when shared content changes.
 */
import { createHash } from "node:crypto";
import { Effect } from "effect";
import { composeFiles, NEUTRAL_VARS, type RenderedFile } from "./compose/files";
import type { Composition } from "./compose/types";
import { canonicalJson } from "./fs/canonical-json";
import { Registry } from "./registry/registry";
import { HYGIENE_TAG } from "./verify/plan";

/**
 * Length-prefixed fields and list counts keep different inputs distinct. The persisted digest
 * depends on field order and exact framing: decimal byte length, colon, then bytes (UTF-8 for text).
 */
function framedHash() {
  const hash = createHash("sha256");
  const encoder = new TextEncoder();
  return {
    field(value: string | Uint8Array) {
      const bytes = typeof value === "string" ? encoder.encode(value) : value;
      hash.update(`${bytes.byteLength}:`);
      hash.update(bytes);
    },
    digest: () => `sha256:${hash.digest("hex")}`,
  };
}

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
 * The stack's own source files this composition writes, sorted by source path: its selected agent
 * adapters and payload, not every one the stack ships.
 */
const writtenStackFiles = (composition: Composition, registry: Registry["Service"]) =>
  Effect.gen(function* () {
    const stack = composition.stack;
    const written = composition.files.filter((file) =>
      file.owners.some((owner) => owner.kind === "stack" && owner.id === stack.id),
    );
    return (yield* registry.files(stack))
      .filter((file) =>
        written.some((planned) =>
          planned.source
            ? planned.source.entry.kind === "stack" && planned.source.file === file.source
            : planned.path === file.path,
        ),
      )
      .sort((a, b) => (a.source < b.source ? -1 : 1));
  });

/** The fragments the user asked for with `--with`, sorted, as one canonical JSON field. */
const addedFragments = (composition: Composition) =>
  canonicalJson(
    composition.selection
      .filter((item) => item.via === "with")
      .map((item) => item.id)
      .sort(),
  );

/**
 * What a ledger proof covers: the stack's own directory (STACK.md, and the files, adapters and
 * payload this composition writes from it), the composed verify steps, the preset, payload and
 * added fragments. Canaries cover shared fragment content so a shared change need not stale
 * every stack proof.
 */
export const proofFingerprint = (composition: Composition) =>
  Effect.gen(function* () {
    const registry = yield* Registry.pipe(Effect.provide(Registry.layer([])));
    const stack = composition.stack;
    const files = yield* writtenStackFiles(composition, registry);
    const { field, digest } = framedHash();
    field("proof:1");
    field(stack.id);
    field(composition.preset);
    field(composition.lean ? "lean" : "");
    field(composition.payload ?? "");
    field(addedFragments(composition));
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
    return digest();
  });

/** Hash an already neutral-rendered snapshot, so scaffold never rereads its sources. */
export const fingerprintFromFiles = (
  composition: Composition,
  files: ReadonlyArray<RenderedFile>,
): string => {
  const { field, digest } = framedHash();
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
  return digest();
};
