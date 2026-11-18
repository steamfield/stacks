import {
  bundleDigest,
  canonicalBundle,
  type EntryBundle,
  type IndexEntry,
} from "@steamfield/stacks-format";
import { Effect } from "effect";
import { compose } from "../../src/core/compose/compose";
import type { Composition } from "../../src/core/compose/types";
import { proofFingerprint } from "../../src/core/fingerprint";
import { latestMatchingRecord, ledgerAdapterSets, readLedger } from "../../src/core/ledger";
import { type Entry, isFragment, isRejected, isStack } from "../../src/core/registry/entry";
import { Registry } from "../../src/core/registry/registry";
import type { LedgerRecord } from "../../src/schemas/ledger";
import { bundlePath } from "./remote";

const proveRecord = Effect.fn("index.proveRecord")(function* (record: LedgerRecord) {
  if (record.result !== "pass" || record.interventions !== 0 || record.run?.tamperCheck !== "full")
    return null;
  if (record.preset !== "default" && record.preset !== "sandbox") return null;
  for (const agents of ledgerAdapterSets()) {
    const attempt = yield* Effect.result(
      compose({
        stack: record.stack,
        with: record.with,
        without: [],
        preset: record.preset,
        agents,
        always: [],
        mode: "new",
      }).pipe(
        Effect.flatMap((composition) =>
          Effect.map(proofFingerprint(composition), (value) => ({ composition, value })),
        ),
      ),
    );
    if (attempt._tag === "Success" && attempt.success.value === record.fingerprint)
      return attempt.success.composition;
  }
  return null;
});

const rawEntry = Effect.fn("index.rawEntry")(function* (entry: Entry) {
  const registry = yield* Registry;
  const tree = yield* registry.tree(entry);
  const files: EntryBundle["files"][number][] = [];
  for (const file of tree.files) {
    const content = yield* registry.bytes(entry, file.source);
    files.push({
      path: file.source,
      executable: (file.mode & 0o111) !== 0,
      encoding: "base64",
      content: Buffer.from(content).toString("base64"),
    });
  }
  const bundle: EntryBundle = { id: entry.id, kind: entry.kind, files };
  const digest = yield* bundleDigest(bundle);
  const metadata: IndexEntry = {
    id: entry.id,
    kind: entry.kind,
    schemaVersion: entry.meta.schemaVersion,
    name: entry.meta.name,
    description: entry.meta.description,
    tags: entry.meta.tags,
    digest,
    ...(entry.kind === "stack" ? { composition: {} } : {}),
  };
  return { metadata, bytes: canonicalBundle(bundle) };
});

type Proven = { record: LedgerRecord; composition: Composition };
type Raw = ReadonlyMap<string, Effect.Success<ReturnType<typeof rawEntry>>>;

function fragmentDigests(fragments: Composition["fragments"], raw: Raw) {
  const composition: Record<string, string> = {};
  for (const fragment of fragments) {
    const value = raw.get(`fragment/${fragment.id}`);
    if (value !== undefined) composition[fragment.id] = value.metadata.digest;
  }
  return composition;
}

/**
 * A workspace's pin for each part: the part's stack id and the bundle digest of the part stack it
 * was composed with. Absent for a composition without parts, so single-stack entries are unchanged.
 * A part stack with no bundle fails the build: a pin missing a part would let readers compose that
 * part from whatever copy is current.
 */
const partDigests = Effect.fn("index.partDigests")(function* (
  parts: Composition["parts"],
  raw: Raw,
) {
  if (parts === undefined) return {};
  const pins: Record<string, { stack: string; digest: string }> = {};
  for (const { mount } of parts) {
    const value = raw.get(`stack/${mount.stack}`);
    if (value === undefined)
      return yield* Effect.fail(
        new Error(`part ${mount.name}: stack/${mount.stack} has no bundle to pin.`),
      );
    pins[mount.name] = { stack: mount.stack, digest: value.metadata.digest };
  }
  return { parts: pins } satisfies Pick<IndexEntry, "parts">;
});

const stackEntry = Effect.fn("index.stackEntry")(function* (
  stack: Entry,
  proven: ReadonlyArray<Proven>,
  raw: Raw,
) {
  const own = proven.filter(({ record }) => record.stack === stack.id && record.with.length === 0);
  // An agent run is preferred: it measures minutesToGreen. A scaffold run proves the same content.
  const records = own.map(({ record }) => record);
  const newest =
    latestMatchingRecord(records, (record) => record.mode !== "scaffold") ??
    latestMatchingRecord(records, () => true);
  const proof = own.find(({ record }) => record === newest);
  const value = raw.get(`stack/${stack.id}`);
  if (proof === undefined || value === undefined) return null;
  const record = proof.record;
  const entry: IndexEntry = {
    ...value.metadata,
    composition: fragmentDigests(proof.composition.fragments, raw),
    ...(yield* partDigests(proof.composition.parts, raw)),
    lastRun: {
      date: record.date,
      result: "pass",
      agent: record.agent,
      preset: record.preset,
      minutesToGreen: record.minutesToGreen,
      fingerprint: record.fingerprint,
    },
  };
  return entry;
});

const unprovenStack = Effect.fn("index.unprovenStack")(function* (stack: Entry, raw: Raw) {
  const value = raw.get(`stack/${stack.id}`);
  if (value === undefined) return null;
  const composition = yield* compose({
    stack: stack.id,
    with: [],
    without: [],
    preset: "default",
    agents: [],
    always: [],
    mode: "new",
  });
  return {
    ...value.metadata,
    composition: fragmentDigests(composition.fragments, raw),
    ...(yield* partDigests(composition.parts, raw)),
  };
});

function addFragments(ids: ReadonlyArray<string>, raw: Raw, published: Map<string, IndexEntry>) {
  for (const id of ids) {
    const value = raw.get(`fragment/${id}`);
    if (value !== undefined) published.set(`fragment/${id}`, value.metadata);
  }
}

function addStack(metadata: IndexEntry, raw: Raw, published: Map<string, IndexEntry>) {
  published.set(`stack/${metadata.id}`, metadata);
  addFragments(Object.keys(metadata.composition ?? {}), raw, published);
}

/**
 * Every part stack a published workspace pins is published too, with its own proof when it has
 * one and otherwise unproven, since a reader of the workspace downloads its bundle.
 */
const addPinnedParts = Effect.fn("index.addPinnedParts")(function* (
  stacks: ReadonlyArray<Entry>,
  input: { proven: ReadonlyArray<Proven>; raw: Raw },
  published: Map<string, IndexEntry>,
) {
  const pinned = [...published.values()].flatMap((entry) => Object.values(entry.parts ?? {}));
  for (const { stack: id } of pinned) {
    const part = stacks.find((stack) => stack.id === id);
    if (part === undefined || published.has(`stack/${id}`)) continue;
    const metadata =
      (yield* stackEntry(part, input.proven, input.raw)) ?? (yield* unprovenStack(part, input.raw));
    if (metadata !== null) addStack(metadata, input.raw, published);
  }
});

const publicationEntries = Effect.fn("index.publicationEntries")(function* (
  entries: ReadonlyArray<Entry>,
  proven: ReadonlyArray<Proven>,
  raw: Raw,
  includeUnproven: boolean,
) {
  const published = new Map<string, IndexEntry>();
  const stacks = entries.filter(isStack);
  for (const stack of stacks) {
    const metadata =
      (yield* stackEntry(stack, proven, raw)) ??
      (includeUnproven ? yield* unprovenStack(stack, raw) : null);
    if (metadata !== null) addStack(metadata, raw, published);
  }
  yield* addPinnedParts(stacks, { proven, raw }, published);
  for (const proof of proven.filter(({ record }) => record.with.length > 0))
    addFragments(
      proof.composition.fragments.map((fragment) => fragment.id),
      raw,
      published,
    );
  if (includeUnproven)
    addFragments(
      entries.filter(isFragment).map((fragment) => fragment.id),
      raw,
      published,
    );
  return [...published.values()];
});

export const currentIndex = Effect.fn("index.currentIndex")(function* (
  root: string,
  includeUnproven = false,
) {
  const registry = yield* Registry;
  const entries = (yield* registry.all).filter((entry): entry is Entry => !isRejected(entry));
  const ledger = yield* readLedger(root);
  const proven: Proven[] = [];
  for (const record of ledger.records) {
    const composition = yield* proveRecord(record);
    if (composition !== null) proven.push({ record, composition });
  }
  const raw = new Map<string, Effect.Success<ReturnType<typeof rawEntry>>>();
  for (const entry of entries) raw.set(`${entry.kind}/${entry.id}`, yield* rawEntry(entry));
  const published = yield* publicationEntries(entries, proven, raw, includeUnproven);
  const bundles = new Map<string, Uint8Array>();
  for (const metadata of published) {
    const value = raw.get(`${metadata.kind}/${metadata.id}`);
    if (value !== undefined) bundles.set(bundlePath(metadata), value.bytes);
  }
  return {
    entries: published,
    bundles,
    stacks: entries.filter(isStack).map((entry) => entry.id),
    fragments: entries.filter(isFragment).map((entry) => entry.id),
  };
});
