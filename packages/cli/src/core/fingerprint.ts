/**
 * Computes composition and proof fingerprints. Neutral template values keep project names and
 * authors out of the composition digest. See `proofFingerprint` for how stack proofs stay current
 * when shared content changes.
 */
import { createHash } from "node:crypto";
import { outputPath } from "@steamfield/stacks-format";
import { Effect } from "effect";
import { composeFiles, NEUTRAL_VARS, type RenderedFile } from "./compose/files";
import { placedPath } from "./compose/mount";
import { stackEntries } from "./compose/part-entries";
import type { ComposedPart, Composition, MountedEntry, PlannedFile } from "./compose/types";
import { canonicalJson } from "./fs/canonical-json";
import type { EntryFile } from "./registry/entry";
import { Registry } from "./registry/registry";
import { HYGIENE_TAG } from "./verify/plan";

type Field = (value: string | Uint8Array) => void;

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

const sameEntry = (ref: { kind: string; id: string }, entry: MountedEntry) =>
  ref.kind === entry.kind && ref.id === entry.id;

/**
 * Whether a planned file is this shipped file of `entry`. A file sourced from the entry matches
 * by source, so an unselected payload variant at the same output path never counts; a merged
 * file, or a hoisted copy whose bytes came from another part, matches by its placed path.
 */
const plannedFrom = (planned: PlannedFile, entry: MountedEntry, file: EntryFile) =>
  planned.source && sameEntry(planned.source.entry, entry)
    ? planned.source.file === file.source
    : planned.path === placedPath(outputPath(file.path), entry.mount);

/**
 * The entry's own source files this composition writes, sorted by source path: its selected
 * agent adapters and payload, not every one it ships, and every file it shares as a writer.
 */
export const writtenEntryFiles = (
  composition: Composition,
  entry: MountedEntry,
  registry: Registry["Service"],
) =>
  Effect.gen(function* () {
    const written = composition.files.filter((file) =>
      file.owners.some((owner) => sameEntry(owner, entry)),
    );
    return (yield* registry.files(entry))
      .filter((file) => written.some((planned) => plannedFrom(planned, entry, file)))
      .sort((a, b) => (a.source < b.source ? -1 : 1));
  });

/** Count, then each file's source, executable bit and bytes. */
const hashFiles = (
  field: Field,
  entry: MountedEntry,
  files: ReadonlyArray<EntryFile>,
  registry: Registry["Service"],
) =>
  Effect.gen(function* () {
    field(String(files.length));
    for (const file of files) {
      field(file.source);
      field((file.mode & 0o111) !== 0 ? "1" : "0");
      field(yield* registry.bytes(entry, file.source));
    }
  });

const metaWithoutHygiene = ({ meta }: MountedEntry) =>
  canonicalJson({ ...meta, verify: meta.verify.map(withoutHygiene) });

/**
 * One part's proof section: its mount, then its mounted meta, resolved body and written files.
 * A part stack the registry lacks (add mode only) hashes as `missing`.
 */
const hashPart = (
  field: Field,
  part: ComposedPart,
  input: { composition: Composition; registry: Registry["Service"] },
) =>
  Effect.gen(function* () {
    const { mount, entry } = part;
    field(`part:${mount.name}`);
    field(mount.role);
    field(mount.stack);
    if (entry === null) return field("missing");
    field(metaWithoutHygiene(entry));
    field(entry.body);
    const files = yield* writtenEntryFiles(input.composition, entry, input.registry);
    yield* hashFiles(field, entry, files, input.registry);
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
 * every stack proof. A workspace's proof also covers each part's directory as mounted, since the
 * index pins exactly those part bundles to the workspace.
 */
export const proofFingerprint = (composition: Composition) =>
  Effect.gen(function* () {
    const registry = yield* Registry.pipe(Effect.provide(Registry.layer([])));
    const stack = composition.stack;
    const files = yield* writtenEntryFiles(composition, stack, registry);
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
    field(metaWithoutHygiene(stack));
    field(stack.body);
    yield* hashFiles(field, stack, files, registry);
    // Only a workspace adds fields, so every single-stack proof stays byte-identical.
    for (const part of composition.parts ?? [])
      yield* hashPart(field, part, { composition, registry });
    return digest();
  });

/** The stack, each part's mounted entry in `parts` order, then the fragments. */
const fingerprintEntries = (composition: Composition): ReadonlyArray<MountedEntry> => [
  ...stackEntries(composition.stack, composition.parts),
  ...composition.fragments,
];

/** Hash an already neutral-rendered snapshot, so scaffold never rereads its sources. */
export const fingerprintFromFiles = (
  composition: Composition,
  files: ReadonlyArray<RenderedFile>,
): string => {
  const { field, digest } = framedHash();
  const entries = fingerprintEntries(composition);
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
