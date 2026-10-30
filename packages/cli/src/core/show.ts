import type { DependencyCard, Kind } from "@steamfield/stacks-format";
import { Effect, Option, Result } from "effect";
import { AppConfig } from "../config";
import { BadInput, NotFound } from "../errors";
import type { LedgerRecord } from "../schemas/ledger";
import type { ShowReport } from "../schemas/show";
import { Output } from "../services/output";
import { countWords } from "./brief/words";
import { targetAgents } from "./compose/agents";
import { compose } from "./compose/compose";
import { fitsStack } from "./compose/selection";
import { fingerprint } from "./fingerprint";
import { lastDefaultRecord, latestMatchingRecord, ledgerAdapterSets, readLedger } from "./ledger";
import { toRow } from "./list";
import { type CatalogEntry, type Entry, outputPath } from "./registry/entry";
import { Registry, type RegistryRoot, type RegistryRoots, remoteRoots } from "./registry/registry";
import { searchSourceDigest } from "./search/digest";
import { decodeDependencyCards, decodeSidecar } from "./search/sidecar";
import { Stats } from "./stats";
import { closest } from "./suggest";
import { BUDGET, bodyLimit, canonicalBrief, composedLimit } from "./validate/budget";

/** Full review data; neither entries nor tools are executed. */
export const showReport = (id: string, kind: Kind | undefined, reviewRoots?: RegistryRoots) =>
  Effect.gen(function* () {
    const roots = reviewRoots ?? (yield* remoteRoots);
    const settings = yield* (yield* AppConfig).get;
    const output = yield* Output;
    const bundled = roots.find((root) => root.origin === "bundled");
    const ledger = bundled ? yield* readLedger(bundled.path) : undefined;
    if (ledger && (!ledger.fileValid || ledger.skipped.invalid || ledger.skipped.newer))
      yield* output.note(
        "Warning: the bundled ledger runs.json is unreadable or contains unsupported records.",
      );
    const records = ledger?.records ?? [];
    return yield* Effect.gen(function* () {
      const registry = yield* Registry;
      const all = yield* registry.catalog;
      const match = yield* findEntry(all, id, kind);
      const entry = yield* registry.get(match.kind, id);
      const { stats: _summaryStats, ...row } = toRow(entry, records, yield* registry.authors);
      const stats = yield* officialDetail(entry);
      const { meta } = entry;
      const copy = yield* entryCopy(entry, registry);
      const files = (yield* registry.files(entry)).map((file) => {
        const agent = /^adapters\/([^/]+)\//.exec(file.source)?.[1];
        return {
          source: file.source,
          path: outputPath(file),
          ...(agent ? { agent } : {}),
        };
      });
      const composition =
        entry.kind === "stack"
          ? yield* compose({
              stack: id,
              with: [],
              without: [],
              preset: "default",
              agents: targetAgents(undefined, settings).slice(0, 1),
              always: [],
              mode: "new",
            })
          : null;
      const lastRun =
        entry.indexEntry?.lastRun && row.lastRun
          ? { ...row.lastRun, sameContent: yield* indexSameContent(entry) }
          : yield* entryLastRun(entry, records, bundled);
      return {
        ...row,
        ...stats,
        path: entry.dir,
        deps: meta.deps,
        ...copy,
        tools: meta.tools,
        decisions: meta.decisions,
        env: meta.env,
        commands: meta.commands,
        verify: meta.verify,
        ...selectionMetadata(entry, all),
        files,
        body: entry.body,
        bodyWords: countWords(entry.body),
        bodyCap: bodyLimit(entry),
        briefWords: composition ? canonicalBrief(composition).briefWords : null,
        briefCap: composition ? composedLimit(composition) : BUDGET.composed,
        lastRun,
      } satisfies ShowReport;
    }).pipe(Effect.provide(Registry.layer(roots)));
  });

const entryCopy = Effect.fn("show.copy")(function* (entry: Entry, registry: Registry["Service"]) {
  const plain = yield* entryPlain(entry, registry);
  const dependencyCards = yield* entryDependencyCards(entry, registry);
  return { ...(plain ? { plain } : {}), ...(dependencyCards ? { dependencyCards } : {}) };
});

const entryPlain = Effect.fn("show.plain")(function* (entry: Entry, registry: Registry["Service"]) {
  const loaded = yield* Effect.result(registry.search(entry));
  if (loaded._tag === "Failure" || loaded.success === undefined) return undefined;
  const decoded = yield* Effect.result(decodeSidecar(loaded.success));
  if (decoded._tag === "Failure") return undefined;
  const card = decoded.success;
  if (card.kind !== entry.kind || card.id !== entry.id) return undefined;
  const plain = card.plain;
  if (plain === undefined) return undefined;
  const example = card.projectExamples?.[0];
  return {
    ...plain,
    ...(example ? { example: { title: example.title, description: example.description } } : {}),
    ...(card.source.digest !== searchSourceDigest(entry) ? { stale: true } : {}),
    ...(entry.origin === "user" || entry.origin === "project" || !entry.trusted
      ? { unreviewed: true }
      : {}),
  };
});

const entryDependencyCards = Effect.fn("show.dependencyCards")(function* (
  entry: Entry,
  registry: Registry["Service"],
) {
  const wanted = new Set(Object.values(entry.meta.deps).flat());
  if (!wanted.size) return undefined;
  const found: Record<string, DependencyCard> = {};
  const files = yield* registry.dependencyCards;
  for (const [ecosystem, bytes] of files) {
    const decoded = yield* Effect.result(decodeDependencyCards(bytes));
    if (decoded._tag === "Failure") continue;
    for (const [name, card] of Object.entries(decoded.success.cards))
      if (wanted.has(name)) found[`${ecosystem}/${name}`] = card;
  }
  return Object.keys(found).length ? found : undefined;
});

const officialDetail = Effect.fn("show.officialDetail")(function* (entry: Entry) {
  if (entry.origin !== "bundled" && entry.origin !== "index") return {};
  const detail = Option.getOrUndefined(yield* (yield* Stats).detail(entry.kind, entry.id));
  return detail?.published ? { stats: detail } : {};
});

function selectionMetadata(entry: Entry, all: ReadonlyArray<CatalogEntry>) {
  const { meta } = entry;
  return meta.kind === "stack"
    ? { fragments: meta.fragments }
    : {
        category: meta.category,
        appliesTo: meta.appliesTo,
        requires: meta.requires,
        conflicts: meta.conflicts,
        requiresTools: meta.requiresTools,
        needsOwnRepo: meta.needsOwnRepo,
        fits: all
          .filter((entry) => entry.kind === "stack" && !entry.rejected)
          .filter((stack) => fitsStack(meta.appliesTo, stack))
          .map((stack) => stack.id),
      };
}

const indexSameContent = Effect.fn("show.indexSameContent")(function* (entry: Entry) {
  const proof = entry.indexEntry?.lastRun;
  if (!proof || (proof.preset !== "default" && proof.preset !== "sandbox")) return false;
  const preset = proof.preset;
  const currents = yield* Effect.forEach(ledgerAdapterSets(proof.agent), (agents) =>
    Effect.result(
      compose({
        stack: entry.id,
        with: [],
        without: [],
        preset,
        agents,
        always: [],
        mode: "new",
      }).pipe(Effect.flatMap(fingerprint)),
    ),
  );
  return currents.some(
    (current) => Result.isSuccess(current) && current.success === proof.fingerprint,
  );
});

const findEntry = (all: ReadonlyArray<CatalogEntry>, id: string, kind: Kind | undefined) =>
  Effect.gen(function* () {
    const matches = all.filter(
      (entry) => entry.id === id && (kind === undefined || entry.kind === kind),
    );
    if (matches.length > 1)
      return yield* new BadInput({ details: { id, flag: "kind", known: ["stack", "fragment"] } });
    const match = matches[0];
    if (!match)
      return yield* new NotFound({
        details: {
          id,
          ...(kind ? { kind } : {}),
          suggestions: closest(
            id,
            all
              .filter((entry) => kind === undefined || entry.kind === kind)
              .map((entry) => entry.id),
          ),
        },
      });
    return match;
  });

const fragmentRecords = (entry: Entry, records: ReadonlyArray<LedgerRecord>) =>
  Effect.gen(function* () {
    const candidates: LedgerRecord[] = [];
    for (const record of entry.kind === "stack" ? [] : records) {
      if (record.preset !== "default" && record.preset !== "sandbox") continue;
      const current = yield* Effect.result(
        compose({
          stack: record.stack,
          with: record.with,
          without: [],
          preset: record.preset,
          agents: ledgerAdapterSets(record.agent)[0] ?? targetAgents(undefined, {}),
          always: [],
          mode: "new",
        }),
      );
      if (
        Result.isSuccess(current) &&
        current.success.fragments.some((fragment) => fragment.id === entry.id)
      )
        candidates.push(record);
    }
    return candidates;
  });

const bundledLastRun = (entry: Entry, records: ReadonlyArray<LedgerRecord>) =>
  Effect.gen(function* () {
    const candidates = yield* fragmentRecords(entry, records);
    const record =
      entry.kind === "stack"
        ? lastDefaultRecord(records, entry.id)
        : latestMatchingRecord(candidates, () => true);
    if (!record) return null;
    const run = {
      date: record.date,
      result: record.result,
      fingerprint: record.fingerprint,
      agent: record.agent,
      preset: record.preset,
      ...(entry.kind === "fragment" ? { stack: record.stack } : {}),
    };
    if (record.preset !== "default" && record.preset !== "sandbox")
      return { ...run, sameContent: false };
    const preset = record.preset;
    const currents = yield* Effect.forEach(ledgerAdapterSets(record.agent), (agents) =>
      Effect.result(
        compose({
          stack: record.stack,
          with: record.with,
          without: [],
          preset,
          agents,
          always: [],
          mode: "new",
        }).pipe(Effect.flatMap(fingerprint)),
      ),
    );
    return {
      ...run,
      sameContent: currents.some(
        (current) => Result.isSuccess(current) && current.success === record.fingerprint,
      ),
    };
  });

const entryLastRun = (
  entry: Entry,
  records: ReadonlyArray<LedgerRecord>,
  bundled: RegistryRoot | undefined,
) =>
  entry.origin === "bundled" && bundled
    ? // A bundled run is compared only to bundled inputs, never a local shadow of a fragment.
      bundledLastRun(entry, records).pipe(
        Effect.provide(Registry.layer([{ ...bundled, remote: false }])),
      )
    : Effect.succeed(null);
