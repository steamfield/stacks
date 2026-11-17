/**
 * Builds the report for reviewing an entry before use. It composes a stack's defaults to measure
 * the actual brief and dependencies. A broken default composition fails the review because
 * partial measurements would hide missing material, while optional display copy can be omitted.
 */
import {
  type AgentId,
  type DependencyCard,
  type DependencyRollup,
  type FragmentMeta,
  type Kind,
  outputPath,
  shippedPath,
  stackDependencies,
} from "@steamfield/stacks-format";
import { Effect, Option, Result } from "effect";
import { AppConfig } from "../../config";
import { BadInput, NotFound } from "../../errors";
import type { LedgerRecord } from "../../schemas/ledger";
import type { ShowReport } from "../../schemas/show";
import { Output } from "../../services/output";
import { countWords } from "../brief/words";
import { targetAgents } from "../compose/agents";
import { fitsStack } from "../compose/selection";
import type { Composition } from "../compose/types";
import { goAllowlistKey } from "../deps/index";
import { readLedger } from "../ledger";
import { toRow } from "../list/index";
import { defined } from "../object";
import { type CatalogEntry, type Entry, isFragment } from "../registry/entry";
import { Registry } from "../registry/registry";
import { type RegistryRoots, remoteRoots } from "../registry/roots";
import { searchSourceDigest } from "../search/digest";
import { decodeDependencyCards, decodeSidecar } from "../search/sidecar";
import { Stats } from "../stats/index";
import { closest } from "../text/suggest";
import { BUDGET, bodyLimit, canonicalBrief, composedLimit } from "../validate/compositions/budget";
import { composeNew, reportLastRun } from "./last-run";

/**
 * The full review of entry `id`, from `reviewRoots` or the usual roots (remote index included).
 * Neither the entry nor any tool it names is executed.
 */
export const showReport = (id: string, kind: Kind | undefined, reviewRoots?: RegistryRoots) =>
  Effect.gen(function* () {
    const roots = reviewRoots ?? (yield* remoteRoots);
    const settings = yield* (yield* AppConfig).settings;
    const records = yield* bundledRecords(roots);
    // The brief is measured for the first agent the user targets by default.
    const agents = targetAgents(undefined, settings).slice(0, 1);
    return yield* reviewEntry({ id, kind, records, agents }).pipe(
      Effect.provide(Registry.layer(roots)),
    );
  });

/**
 * The bundled ledger's records, with a warning when the ledger can't be fully read. None when
 * there is no bundled root.
 */
const bundledRecords = (roots: RegistryRoots) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const registryRoot = roots.find((root) => root.origin === "bundled");
    if (!registryRoot) return [];
    const ledger = yield* readLedger(registryRoot.path);
    if (!ledger.fileValid || ledger.skipped.invalid || ledger.skipped.newer)
      yield* output.note(
        "Warning: the bundled ledger runs.json is unreadable or contains unsupported records.",
      );
    return ledger.records;
  });

const reviewEntry = Effect.fn("show.review")(function* (request: {
  id: string;
  kind: Kind | undefined;
  records: ReadonlyArray<LedgerRecord>;
  agents: ReadonlyArray<AgentId>;
}) {
  const { id, kind, records, agents } = request;
  const registry = yield* Registry;
  const catalog = yield* registry.catalog;
  const match = yield* findEntry(catalog, id, kind);
  const entry = yield* registry.get(match.kind, id);
  // The list row's summary stats give way to the detailed stats below.
  const { stats: _summaryStats, ...row } = toRow(entry, records, yield* registry.authors);
  const stats = yield* officialDetail(entry);
  const fragments = yield* dependencyFragments(entry, registry);
  const files = yield* shippedFiles(entry, registry);
  const payloads = [
    ...new Set(files.flatMap((file) => (file.payload ? [file.payload] : []))),
  ].sort();
  const composition = yield* defaultComposition(entry, agents);
  const dependencyRollup = entryDependencyRollup(entry, fragments, composition);
  const copy = yield* entryCopy(entry, registry, dependencyRollup);
  const lastRun = yield* reportLastRun({ entry, indexRun: row.lastRun, records, registry });
  const selection = yield* selectionMetadata(entry, catalog, registry);
  const { meta } = entry;
  return defined({
    ...row,
    ...stats,
    path: entry.dir,
    deps: meta.deps,
    dependencyRollup,
    ...copy,
    tools: meta.tools,
    decisions: meta.decisions,
    env: meta.env,
    commands: meta.commands,
    verify: meta.verify,
    ...selection,
    files,
    ...(payloads.length ? { payloads } : {}),
    body: entry.body,
    bodyWords: countWords(entry.body),
    bodyCap: bodyLimit(entry),
    briefWords: composition ? canonicalBrief(composition).briefWords : null,
    briefCap: composition ? composedLimit(composition) : BUDGET.composed,
    lastRun,
  }) satisfies ShowReport;
});

/**
 * The one catalog entry with `id` (and `kind`, when given). Two matches need `--kind`; none is
 * `NotFound` with the closest ids of that kind as suggestions.
 */
const findEntry = (catalog: ReadonlyArray<CatalogEntry>, id: string, kind: Kind | undefined) =>
  Effect.gen(function* () {
    const ofKind = catalog.filter((entry) => kind === undefined || entry.kind === kind);
    const matches = ofKind.filter((entry) => entry.id === id);
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
            ofKind.map((entry) => entry.id),
          ),
        },
      });
    return match;
  });

/** Published stats for bundled and index entries; other origins aren't counted, so none. */
const officialDetail = Effect.fn("show.officialDetail")(function* (entry: Entry) {
  if (entry.origin !== "bundled" && entry.origin !== "index") return {};
  const detail = Option.getOrUndefined(yield* (yield* Stats).detail(entry.kind, entry.id));
  return detail?.published ? { stats: detail } : {};
});

/** A stack's fragments and their `requires`, one lookup each; unresolvable ones are left out. */
const dependencyFragments = Effect.fn("show.dependencyFragments")(function* (
  entry: Entry,
  registry: Registry["Service"],
) {
  const resolved: FragmentMeta[] = [];
  if (entry.meta.kind !== "stack") return resolved;
  const { fragments } = entry.meta;
  // Grows as each fragment's `requires` are found, so the loop walks the whole closure.
  const pending = [...fragments.required, ...fragments.default, ...fragments.optional];
  const seen = new Set<string>();
  for (const id of pending) {
    if (seen.has(id)) continue;
    seen.add(id);
    const loaded = yield* Effect.result(registry.get("fragment", id));
    if (Result.isFailure(loaded)) {
      // compose reports a missing or rejected default fragment; optional ones only lose their row.
      if (loaded.failure._tag === "PermissionDenied") return yield* loaded.failure;
      continue;
    }
    if (!isFragment(loaded.success)) continue;
    resolved.push(loaded.success.meta);
    pending.push(...loaded.success.meta.requires);
  }
  return resolved;
});

/** Each shipped file with its project path and its agent, host stack or payload condition. */
const shippedFiles = (entry: Entry, registry: Registry["Service"]) =>
  Effect.map(registry.files(entry), (files) => files.map(shownFile));

function shownFile(file: { source: string; path: string }) {
  const condition = shippedPath(file.source)?.condition;
  return {
    source: file.source,
    path: outputPath(file.path),
    ...(condition?.kind === "agent" ? { agent: condition.id } : {}),
    ...(condition?.kind === "stack" ? { stack: condition.id } : {}),
    ...(condition?.kind === "payload" ? { payload: condition.id } : {}),
  };
}

/** A stack's default composition, as a plain `stacks new` would build it; `null` for a fragment. */
const defaultComposition = (entry: Entry, agents: ReadonlyArray<AgentId>) =>
  entry.kind === "stack"
    ? composeNew({ stack: entry.id, with: [], preset: "default", agents })
    : Effect.succeed(null);

/** Every dependency a stack brings, its own and its fragments'; `undefined` for a fragment. */
function entryDependencyRollup(
  entry: Entry,
  fragments: ReadonlyArray<FragmentMeta>,
  composition: Composition | null,
) {
  if (entry.meta.kind !== "stack") return undefined;
  // Composition already selects pinned snapshots and applies project/user overrides.
  const included = composition?.fragments.flatMap((fragment) =>
    fragment.meta.kind === "fragment" ? [fragment.meta] : [],
  );
  return stackDependencies(entry.meta, [...fragments, ...(included ?? [])]);
}

/** The optional people-facing copy: the sidecar's `plain` text and the dependency cards. */
const entryCopy = Effect.fn("show.copy")(function* (
  entry: Entry,
  registry: Registry["Service"],
  rollup: DependencyRollup | undefined,
) {
  const plain = yield* entryPlain(entry, registry);
  const dependencyCards = yield* entryDependencyCards(entry, registry, rollup);
  return { ...(plain ? { plain } : {}), ...(dependencyCards ? { dependencyCards } : {}) };
});

/**
 * The sidecar's `plain` copy, with its first project example. It is marked `stale` when the entry
 * changed after the copy was written, and `unreviewed` when the entry's own author wrote it.
 * A missing, unreadable or mismatched sidecar gives no copy.
 */
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
    ...(isUnreviewed(entry) ? { unreviewed: true } : {}),
  };
});

/** Copy from a user, project or untrusted entry comes from its author, not the stacks review. */
const isUnreviewed = (entry: Entry) =>
  entry.origin === "user" || entry.origin === "project" || !entry.trusted;

/**
 * The bundled dependency cards for the entry's dependencies, keyed `<ecosystem>/<name>`.
 * A card file that doesn't decode is skipped; `undefined` when no card matches.
 */
const entryDependencyCards = Effect.fn("show.dependencyCards")(function* (
  entry: Entry,
  registry: Registry["Service"],
  rollup: DependencyRollup | undefined,
) {
  const wanted = wantedDependencyNames(entry, rollup);
  if (!wanted.size) return undefined;
  // Go cards are keyed by module path without its major-version suffix.
  const goWanted = new Set([...wanted].map(goAllowlistKey));
  const found: Record<string, DependencyCard> = {};
  const files = yield* registry.dependencyCards;
  for (const [ecosystem, bytes] of files) {
    const decoded = yield* Effect.result(decodeDependencyCards(bytes));
    if (decoded._tag === "Failure") continue;
    const selected = ecosystem === "go" ? goWanted : wanted;
    for (const [name, card] of Object.entries(decoded.success.cards))
      if (selected.has(name)) found[`${ecosystem}/${name}`] = card;
  }
  return Object.keys(found).length ? found : undefined;
});

/** Dependency names to find cards for: the rollup's, or the entry's own without one. */
function wantedDependencyNames(entry: Entry, rollup: DependencyRollup | undefined) {
  if (rollup === undefined) return new Set(Object.values(entry.meta.deps).flat());
  const deps = [...rollup.included, ...rollup.optional.flatMap((optional) => optional.deps)];
  return new Set(deps.map((dep) => dep.name));
}

/**
 * How the entry is selected: a stack's fragment lists, or a fragment's fit fields and the stacks
 * it fits. A fitting stack that fails to load is left out; index stacks aren't loaded, since that
 * would download their bundles.
 */
function selectionMetadata(
  entry: Entry,
  catalog: ReadonlyArray<CatalogEntry>,
  registry: Registry["Service"],
) {
  const { meta } = entry;
  if (meta.kind === "stack") return Effect.succeed({ fragments: meta.fragments });
  return Effect.gen(function* () {
    const stacks = catalog
      .filter((candidate) => candidate.kind === "stack" && !candidate.rejected)
      .filter((stack) => fitsStack(meta.appliesTo, stack));
    const loads = yield* Effect.forEach(stacks, (stack) =>
      stack.origin === "index"
        ? Effect.succeed(true)
        : Effect.result(registry.get("stack", stack.id)).pipe(Effect.map(Result.isSuccess)),
    );
    return {
      category: meta.category,
      appliesTo: meta.appliesTo,
      requires: meta.requires,
      conflicts: meta.conflicts,
      requiresTools: meta.requiresTools,
      needsOwnRepo: meta.needsOwnRepo,
      fits: stacks.filter((_, index) => loads[index]).map((stack) => stack.id),
    };
  });
}
