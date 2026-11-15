/**
 * Computes the two digests that identify what a composition is made of.
 *
 * A composition is a stack combined with fragments: its files, verify steps, env and notes.
 * `fingerprint` hashes all of it, the entries' frontmatter and bodies plus every file it would
 * write, rendered with fixed neutral template values (`compose/files.ts::NEUTRAL_VARS`) so the
 * project's name or author never changes the result. `stacks new --json` and the manifest carry
 * it, and telemetry and the ledger compare compositions by it. `scaffold/new.ts` already holds the
 * neutral-rendered files, so it calls `fingerprintFromFiles` directly instead of rendering twice.
 *
 * `proofFingerprint` is narrower: what a ledger proof (a recorded green run in
 * `registry/runs.json`) vouches for. It covers the stack's own content and verify steps but not
 * shared fragment content, which the canaries in `registry/canaries.json` prove instead, so a
 * change to a shared fragment doesn't make every stack's proof stale. `validate` and `show` use it
 * to tell whether a stack's last proof still applies.
 *
 * Both hash a sequence of framed fields: each field is its decimal byte length, `:`, then its raw
 * bytes (strings as UTF-8), and lists are preceded by their count, so no two different inputs can
 * produce the same byte stream. The byte order is persisted in manifests and ledgers and pinned by
 * `tests/fingerprint-snapshot.test.ts` and `tests/digest-golden.test.ts`; never reorder a field.
 */
import { createHash } from "node:crypto";
import { Effect } from "effect";
import { canonicalJson } from "./canonical-json";
import { composeFiles, NEUTRAL_VARS, type RenderedFile } from "./compose/files";
import type { Composition } from "./compose/types";
import { Registry } from "./registry/registry";
import { HYGIENE_TAG } from "./verify/plan";

/** A sha256 fed one framed field at a time: decimal byte length, `:`, then the raw bytes. */
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
 * added fragments. Shared fragment content is left out; the canaries in `registry/canaries.json`
 * prove it. `fingerprint` still identifies the whole composition for manifests and telemetry.
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
