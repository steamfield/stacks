/**
 * Picks the recorded run `stacks show` reports for an entry, and checks whether that run still
 * proves what the entry would produce today.
 *
 * A recorded run is a bench pass kept in a ledger: the bundled `registry/runs.json` for bundled
 * entries, or the `lastRun` a signed index entry carries. Each record names the composition it ran
 * (stack, added fragments, preset and agent) and a fingerprint, a hash of what was composed. To
 * fill in `sameContent`, this module composes the same input again and compares fingerprints, so
 * the answer is true only when the run tested what a user would get now. A stack compares its own
 * proof fingerprint (`fingerprint.ts::proofFingerprint`, which leaves shared fragments out); a
 * fragment compares the whole composition's, because a fragment is only ever proven as part of a
 * stack.
 *
 * `show.ts::showReport` calls `reportLastRun`. Only index and bundled entries have a run; user and
 * project entries report none. A bundled run is recomposed against the bundled registry alone, so a
 * local entry shadowing one of its fragments can't make an old run look current. Start at
 * `reportLastRun`.
 */
import type { AgentId } from "@steamfield/stacks-format";
import { Effect, Result } from "effect";
import type { LedgerRecord } from "../schemas/ledger";
import type { ListRow } from "../schemas/list";
import { targetAgents } from "./compose/agents";
import { compose } from "./compose/compose";
import type { ComposeOptions, Composition } from "./compose/types";
import { fingerprint, proofFingerprint } from "./fingerprint";
import { lastDefaultRecord, latestMatchingRecord, ledgerAdapterSets } from "./ledger";
import type { Entry } from "./registry/entry";
import { Registry } from "./registry/registry";

type Preset = ComposeOptions["preset"];

/** Entry metadata keyed `<kind>/<id>`, as `Registry.bundled` returns it. */
type Metadata = ReadonlyMap<string, Entry["meta"]>;

/** The input a recorded run composed; `agent` may be one agent or a label covering several. */
type RecordedComposition = {
  stack: string;
  with: ReadonlyArray<string>;
  preset: Preset;
  agent: Parameters<typeof ledgerAdapterSets>[0];
};

/** Composes `stack` as a plain `stacks new` would, with `with` added and nothing removed. */
export const composeNew = (options: {
  stack: string;
  with: ReadonlyArray<string>;
  preset: Preset;
  agents: ReadonlyArray<AgentId>;
}) => compose({ ...options, without: [], always: [], mode: "new" });

/** Only `default` and `sandbox` runs can be composed again; other preset names can't be compared. */
const isComparablePreset = (preset: string): preset is Preset =>
  preset === "default" || preset === "sandbox";

/**
 * Whether composing `run` today hashes to `recorded` under any adapter set its agent label stands
 * for: one set for a single agent, every combination otherwise. A composition that fails counts as
 * no match.
 */
const composesTo = <E, R>(
  run: RecordedComposition,
  digest: (composition: Composition) => Effect.Effect<string, E, R>,
  recorded: string | undefined,
) =>
  Effect.gen(function* () {
    const currents = yield* Effect.forEach(ledgerAdapterSets(run.agent), (agents) =>
      Effect.result(
        composeNew({ stack: run.stack, with: run.with, preset: run.preset, agents }).pipe(
          Effect.flatMap(digest),
        ),
      ),
    );
    return currents.some((current) => Result.isSuccess(current) && current.success === recorded);
  });

/** Whether the proof a signed index entry carries still matches the stack's content. */
const indexSameContent = Effect.fn("show.indexSameContent")(function* (entry: Entry) {
  const proof = entry.indexEntry?.lastRun;
  if (!proof || !isComparablePreset(proof.preset)) return false;
  const run = { stack: entry.id, with: [], preset: proof.preset, agent: proof.agent };
  return yield* composesTo(run, proofFingerprint, proof.fingerprint);
});

/**
 * Whether fragment `id` can be reached from `ids` through `requires`. An id with no fragment
 * metadata counts as reaching it, since its requirements can't be ruled out.
 */
const fragmentReachable = (
  id: string,
  ids: ReadonlyArray<string>,
  metadata: Metadata,
  seen = new Set<string>(),
): boolean => {
  for (const candidate of ids) {
    if (candidate === id) return true;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const fragment = metadata.get(`fragment/${candidate}`);
    if (fragment?.kind !== "fragment") return true;
    if (fragmentReachable(id, fragment.requires, metadata, seen)) return true;
  }
  return false;
};

/**
 * A cheap first check that a record's composition could include the fragment `entry`, from
 * metadata alone; `recordIncludes` confirms it by composing. An unknown stack can't be ruled out.
 */
const recordConcerns = (entry: Entry, record: LedgerRecord, metadata: Metadata) => {
  if (record.with.includes(entry.id)) return true;
  const stack = metadata.get(`stack/${record.stack}`);
  if (stack?.kind !== "stack") return true;
  return fragmentReachable(
    entry.id,
    [...stack.fragments.required, ...stack.fragments.default, ...record.with],
    metadata,
  );
};

/** Whether composing the record's input today selects the fragment `entry`. */
const recordIncludes = (entry: Entry, record: LedgerRecord) =>
  Effect.gen(function* () {
    const current = yield* Effect.result(
      composeNew({
        stack: record.stack,
        with: record.with,
        preset: record.preset === "sandbox" ? "sandbox" : "default",
        agents: ledgerAdapterSets(record.agent)[0] ?? targetAgents(undefined, {}),
      }),
    );
    return (
      Result.isSuccess(current) &&
      current.success.fragments.some((fragment) => fragment.id === entry.id)
    );
  });

/** The comparable records whose composition includes the fragment `entry`, in ledger order. */
const fragmentRecords = (entry: Entry, records: ReadonlyArray<LedgerRecord>, metadata: Metadata) =>
  Effect.gen(function* () {
    const candidates: LedgerRecord[] = [];
    for (const record of records) {
      if (!isComparablePreset(record.preset)) continue;
      if (!recordConcerns(entry, record, metadata)) continue;
      if (yield* recordIncludes(entry, record)) candidates.push(record);
    }
    return candidates;
  });

/**
 * The latest bundled record for `entry`: a stack's latest run of its default composition, or the
 * latest comparable run whose composition includes the fragment.
 */
const latestBundledRecord = (
  entry: Entry,
  records: ReadonlyArray<LedgerRecord>,
  metadata: Metadata,
) =>
  entry.kind === "stack"
    ? Effect.succeed(lastDefaultRecord(records, entry.id))
    : Effect.map(fragmentRecords(entry, records, metadata), (candidates) =>
        latestMatchingRecord(candidates, () => true),
      );

/** The run a bundled entry reports from the bundled ledger, or `null` when none covers it. */
const bundledLastRun = (entry: Entry, records: ReadonlyArray<LedgerRecord>, metadata: Metadata) =>
  Effect.gen(function* () {
    const record = yield* latestBundledRecord(entry, records, metadata);
    if (!record) return null;
    const isFragment = entry.kind === "fragment";
    const run = {
      date: record.date,
      result: record.result,
      fingerprint: record.fingerprint,
      agent: record.agent,
      preset: record.preset,
      ...(isFragment ? { stack: record.stack } : {}),
    };
    if (!isComparablePreset(record.preset)) return { ...run, sameContent: false };
    const recorded = {
      stack: record.stack,
      with: record.with,
      preset: record.preset,
      agent: record.agent,
    };
    const sameContent = isFragment
      ? yield* composesTo(recorded, fingerprint, record.compositionFingerprint)
      : yield* composesTo(recorded, proofFingerprint, record.fingerprint);
    return { ...run, sameContent };
  });

/**
 * The `lastRun` field of a `ShowReport`: the index entry's proof when it carries one, the bundled
 * ledger's latest covering run for a bundled entry, and `null` for anything else. `indexRun` is
 * the entry's list row `lastRun`, already decoded from the index proof.
 */
export const reportLastRun = Effect.fn("show.lastRun")(function* (options: {
  entry: Entry;
  indexRun: ListRow["lastRun"];
  records: ReadonlyArray<LedgerRecord>;
  registry: Registry["Service"];
}) {
  const { entry, indexRun, records, registry } = options;
  if (entry.indexEntry?.lastRun && indexRun)
    return { ...indexRun, sameContent: yield* indexSameContent(entry) };
  if (entry.origin !== "bundled") return null;
  // A bundled run is compared only to bundled inputs, never a local shadow of a fragment.
  const bundled = yield* registry.bundled;
  return yield* bundledLastRun(entry, records, bundled.metadata).pipe(
    Effect.provideService(Registry, { ...registry, ...bundled }),
  );
});
