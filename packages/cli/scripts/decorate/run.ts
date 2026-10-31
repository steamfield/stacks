import type { SearchMetadata } from "@steamfield/stacks-format";
import { Clock, Console, Effect, FileSystem } from "effect";
import { type Entry, isRejected } from "../../src/core/registry/entry";
import { Registry } from "../../src/core/registry/registry";
import { openProject } from "../../src/core/scaffold/write";
import { searchSourceDigest } from "../../src/core/search/digest";
import { decodeSidecar, decodeVocabulary, sidecarPath } from "../../src/core/search/sidecar";
import { PermissionDenied } from "../../src/errors";
import type { Options } from "./arguments";
import { type Budget, draft } from "./client";
import { type DecorateConfig, estimateUsd } from "./config";
import { buildPrompt, EXAMPLE_CARDS, PROMPT_VERSION, recipeReferences } from "./prompt";

/** The placeholder digest a hand-written draft carries until it is stamped (`search-card.md`). */
const DRAFT_DIGEST = `sha256:${"0".repeat(64)}`;

const save = Effect.fn("decorate.save")(function* (root: string, card: SearchMetadata) {
  const fs = yield* FileSystem.FileSystem;
  const file = sidecarPath(card);
  const bytes = new TextEncoder().encode(`${JSON.stringify(card, null, 2)}\n`);
  yield* Effect.scoped(
    Effect.gen(function* () {
      const writer = yield* openProject(root);
      if (yield* fs.exists(`${root}/${file}`)) yield* writer.rewrite(file, bytes);
      else yield* writer.write(file, bytes);
    }),
  );
});

const review = Effect.fn("decorate.review")(function* (options: {
  root: string;
  entry: Entry;
  restamp: boolean;
  config: DecorateConfig;
}) {
  const { entry, config } = options;
  if (!options.restamp && (config.agent !== "none" || !config.stdinIsTTY))
    return yield* new PermissionDenied({
      details: {
        reason: config.agent !== "none" ? "agent" : "no-tty",
        path: sidecarPath(entry),
      },
    });
  const registry = yield* Registry;
  const bytes = yield* registry.search(entry);
  if (bytes === undefined)
    return yield* Effect.fail(new Error(`${entry.id}: no search card to review.`));
  const card = yield* decodeSidecar(bytes);
  if (options.restamp && card.source.reviewedAt === null)
    return yield* Effect.fail(
      new Error(`${entry.id}: unread draft; use --approve after a person reviews it.`),
    );
  if (card.kind !== entry.kind || card.id !== entry.id)
    return yield* Effect.fail(new Error(`${entry.id}: sidecar identity does not match.`));
  const reviewedAt = new Date(yield* Clock.currentTimeMillis).toISOString().slice(0, 10);
  // Approval stamps the card against the entry as it stands too: the person approving read it
  // against that entry, so one command clears a draft.
  const digest = searchSourceDigest(entry);
  if (!options.restamp && card.source.digest !== digest && card.source.digest !== DRAFT_DIGEST)
    yield* Console.log(
      `${entry.kind}/${entry.id}: the entry changed since this draft; approval stamps the card against the current entry.`,
    );
  yield* save(options.root, { ...card, source: { ...card.source, reviewedAt, digest } });
  yield* Console.log(
    `${options.restamp ? "Restamped" : "Approved and restamped"} ${entry.kind}/${entry.id}.`,
  );
});

const selectedEntries = Effect.fn("decorate.select")(function* (options: Options) {
  const registry = yield* Registry;
  const all = (yield* registry.all).filter((entry): entry is Entry => !isRejected(entry));
  const ids =
    options.restamp || options.approve ? [options.restamp ?? options.approve ?? ""] : options.ids;
  for (const id of ids)
    if (!all.some((entry) => entry.id === id))
      return yield* Effect.fail(new Error(`No registry entry named ${id}.`));
  const selected: Entry[] = [];
  for (const entry of all) {
    if (ids.length && !ids.includes(entry.id)) continue;
    if (!(yield* matchesFilter(entry, options))) continue;
    selected.push(entry);
  }
  return selected;
});

const matchesFilter = Effect.fn("decorate.filter")(function* (entry: Entry, options: Options) {
  if (!options.missing && !options.stale) return true;
  const bytes = yield* (yield* Registry).search(entry);
  if (bytes === undefined) return options.missing;
  if (!options.stale) return false;
  return (yield* decodeSidecar(bytes)).source.digest !== searchSourceDigest(entry);
});

const promptExamples = Effect.fn("decorate.examples")(function* () {
  const registry = yield* Registry;
  const examples: SearchMetadata[] = [];
  for (const entry of (yield* registry.all).filter((entry): entry is Entry => !isRejected(entry))) {
    const bytes = yield* registry.search(entry);
    if (bytes === undefined) continue;
    const decoded = yield* Effect.result(decodeSidecar(bytes));
    if (decoded._tag === "Failure") continue;
    const card = decoded.success;
    if (card.source.reviewedAt === null || card.kind !== entry.kind || card.id !== entry.id)
      continue;
    examples.push(card);
    if (examples.length === 2) return examples;
  }
  // The implementation can be exercised before the separately reviewed bundled cards land.
  return EXAMPLE_CARDS;
});

const draftEntry = Effect.fn("decorate.entry")(function* (options: {
  root: string;
  entry: Entry;
  prompt: string;
  config: DecorateConfig;
  flags: Options;
  budget: Budget;
}) {
  const { entry, flags } = options;
  const tokens = Math.ceil(new TextEncoder().encode(options.prompt).length / 4);
  if (flags.dryRun) {
    yield* Console.log(
      `${entry.kind}/${entry.id}: ${tokens} tokens (estimated input); estimate $${estimateUsd(tokens).toFixed(6)} (default model rates).`,
    );
    return;
  }
  const card = yield* draft({
    config: options.config,
    model: flags.model,
    prompt: options.prompt,
    id: `${entry.kind}/${entry.id}`,
    budget: options.budget,
  });
  if (card === undefined) return;
  if (card.kind !== entry.kind || card.id !== entry.id)
    return yield* Effect.fail(new Error(`${entry.id}: model returned a different entry identity.`));
  if (options.config.key && JSON.stringify(card).includes(options.config.key))
    return yield* Effect.fail(
      new Error(`${entry.id}: model output contains a credential; skipped.`),
    );
  yield* save(options.root, {
    ...card,
    source: {
      digest: searchSourceDigest(entry),
      by: "drafted",
      model: flags.model,
      promptVersion: PROMPT_VERSION,
      reviewedAt: null,
    },
  });
  yield* Console.log(`Drafted ${entry.kind}/${entry.id}; review before approval.`);
});

export const run = Effect.fn("decorate.run")(function* (
  root: string,
  flags: Options,
  config: DecorateConfig,
) {
  const entries = yield* selectedEntries(flags);
  if (flags.restamp || flags.approve) {
    for (const entry of entries)
      yield* review({ root, entry, restamp: flags.restamp !== undefined, config });
    return;
  }
  const bytes = yield* (yield* Registry).vocabulary;
  if (bytes === undefined)
    return yield* Effect.fail(new Error("Bundled search vocabulary is missing."));
  const vocabulary = yield* decodeVocabulary(bytes);
  const examples = yield* promptExamples();
  const references = recipeReferences(
    (yield* (yield* Registry).all).filter((entry): entry is Entry => !isRejected(entry)),
  );
  if (!flags.dryRun && !config.key)
    return yield* Effect.fail(new Error("Set OPENROUTER_API_KEY to draft search cards."));
  const budget: Budget = { total: 0, highest: 0, max: flags.maxUsd };
  for (const entry of entries) {
    const prompt = buildPrompt({ entry, vocabulary, examples, references });
    yield* draftEntry({ root, entry, prompt, config, flags, budget }).pipe(
      Effect.catch((error) =>
        Console.log(
          `Skipped ${entry.kind}/${entry.id}: ${error instanceof Error ? error.message : "could not write card"}`,
        ),
      ),
    );
  }
  yield* Console.log(`Total: $${budget.total.toFixed(6)}.`);
});
