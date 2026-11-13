import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { LedgerLastRun } from "../src/schemas/ledger";
import {
  fixtureRecord,
  hit,
  loadRank,
  type RankRecord,
  records,
  vocabulary,
} from "./helpers/search-command";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());
const request = "an iOS workout journal";
const stats = (greenRateLower: number, projects = 100) => ({
  stats: { greenRateLower, projects, sample: 100, window: 28 as const },
});
const proof = (result: LedgerLastRun["result"]): LedgerLastRun => ({
  result,
  date: "2026-10-27",
  agent: "codex",
  preset: "default",
  fingerprint: `sha256:${"0".repeat(64)}`,
});

test("published cached evidence is optional context and does not change lexical fit [4.5c#6]", async () => {
  const rank = await loadRank();
  const entry = await fixtureRecord(space.dir(), "sample");
  const base = { request, vocabulary: vocabulary(), entries: [entry] };
  const without = rank(base);
  const cached = stats(0.86, 215);
  const withStats = rank({ ...base, entries: [{ ...entry, evidence: cached }] });
  expect(hit(withStats.stacks, "sample").evidence.stats).toEqual(cached.stats);
  expect(hit(without.stacks, "sample").evidence).not.toHaveProperty("stats");
  const removeStats = (rows: typeof withStats.stacks) =>
    rows.map(({ evidence, ...row }) => {
      const { stats: _stats, ...rest } = evidence;
      return { ...row, evidence: rest };
    });
  expect({ ...withStats, stacks: removeStats(withStats.stacks) }).toEqual({
    ...without,
    stacks: removeStats(without.stacks),
  });
});

test("quality settles ties, popularity cannot buy fit, evidence cannot change tiers [4.5c#7]", async () => {
  const rank = await loadRank();
  const root = space.dir();
  const a = await fixtureRecord(root, "a");
  const b = await fixtureRecord(root, "b");
  const entries = [a, b];
  const base = rank({ request, entries, vocabulary: vocabulary() });
  expect(hit(base.stacks, "a").score).toBe(hit(base.stacks, "b").score);
  const ranked = rank({
    request,
    vocabulary: vocabulary(),
    entries: [
      { ...a, evidence: stats(0.1, 1000) },
      { ...b, evidence: stats(0.9, 100) },
    ],
  });
  expect(ranked.stacks.map(({ id }) => id)).toEqual(["b", "a"]);
  const lower = await fixtureRecord(root, "lower", {
    search: { summary: "An iOS journal.", requests: [], useCases: [], synonyms: [], goodFor: [] },
  });
  const higher = await fixtureRecord(root, "higher", {
    search: {
      summary: "An iOS workout journal.",
      requests: ["workout journal"],
      useCases: ["workout journal"],
      synonyms: ["workout journal"],
    },
  });
  const lexical = rank({ request, vocabulary: vocabulary(), entries: [lower, higher] });
  expect(hit(lexical.stacks, "higher").score).toBeGreaterThan(
    hit(lexical.stacks, "lower").score * 1.11,
  );
  const popular = rank({
    request,
    vocabulary: vocabulary(),
    entries: [
      { ...lower, evidence: stats(0.99, 1000) },
      { ...higher, evidence: stats(0.01, 100) },
    ],
  });
  expect(popular.stacks.map(({ id }) => id)).toEqual(["higher", "lower"]);
  for (const row of popular.stacks) {
    expect(row.tier).toBe(hit(lexical.stacks, row.id).tier);
    expect(row.score).toBe(hit(lexical.stacks, row.id).score);
  }
  // Compare tier classification with and without the largest evidence adjustments.
  const tiers = await records();
  const baseline = rank({
    request: "an iOS health app",
    entries: tiers,
    vocabulary: vocabulary(),
    limit: 20,
  });
  expect(new Set(baseline.stacks.map(({ tier }) => tier)).size).toBeGreaterThan(1);
  for (const result of ["pass", "fail"] as const) {
    const changed = rank({
      request: "an iOS health app",
      vocabulary: vocabulary(),
      limit: 20,
      entries: tiers.map((row) => ({
        ...row,
        evidence: { ...stats(result === "pass" ? 1 : 0), lastRun: proof(result) },
      })),
    });
    for (const row of changed.stacks) expect(row.tier).toBe(hit(baseline.stacks, row.id).tier);
  }
});

test("ledger pass and fail break equal-fit ties; projects break remaining ties then id [4.5c#7]", async () => {
  const rank = await loadRank();
  const root = space.dir();
  const a = await fixtureRecord(root, "a");
  const b = await fixtureRecord(root, "b");
  const run = (entries: RankRecord[]) => rank({ request, entries, vocabulary: vocabulary() });
  const plain = run([b, a]);
  expect(hit(plain.stacks, "a").score).toBe(hit(plain.stacks, "b").score);
  expect(plain.stacks.map(({ id }) => id)).toEqual(["a", "b"]);
  expect(
    run([
      { ...a, evidence: { lastRun: proof("fail") } },
      { ...b, evidence: { lastRun: proof("pass") } },
    ]).stacks.map(({ id }) => id),
  ).toEqual(["b", "a"]);
  expect(
    run([
      { ...a, evidence: stats(0.5, 10) },
      { ...b, evidence: stats(0.5, 100) },
    ]).stacks.map(({ id }) => id),
  ).toEqual(["b", "a"]);
});

test("known incompatible platforms are penalized while absent cards remain unknown [4.5c#8]", async () => {
  const rank = await loadRank();
  const root = space.dir();
  const desktop = await fixtureRecord(root, "desktop", { search: { platforms: ["desktop"] } });
  const unknown = await fixtureRecord(root, "unknown", { entry: { origin: "user" } });
  const result = rank({
    request,
    vocabulary: vocabulary(),
    entries: [
      desktop,
      {
        entry: {
          ...unknown.entry,
          meta: { ...unknown.entry.meta, description: "A workout journal." },
        },
      },
    ],
  });
  expect(hit(result.stacks, "desktop").penalties).toContainEqual(
    expect.objectContaining({ kind: "platform" }),
  );
  expect(hit(result.stacks, "desktop").tier).not.toBe("strong");
  expect(hit(result.stacks, "unknown").penalties).not.toContainEqual(
    expect.objectContaining({ kind: "platform" }),
  );
});

test("untrusted fits are capped at partial, trusted partial fits precede them [4.5c#9]", async () => {
  const rank = await loadRank();
  const root = space.dir();
  const perfect = await fixtureRecord(root, "perfect");
  const confident = rank({ request, entries: [perfect], vocabulary: vocabulary() });
  expect(hit(confident.stacks, "perfect").tier).toBe("strong");
  const untrusted = {
    ...perfect,
    entry: { ...perfect.entry, origin: "project" as const, trusted: false },
  };
  const alone = rank({ request, entries: [untrusted], vocabulary: vocabulary() });
  expect(alone.noStrongMatch).toBe(true);
  expect(hit(alone.stacks, "perfect")).toMatchObject({
    tier: "partial",
    penalties: expect.arrayContaining([expect.objectContaining({ kind: "untrusted" })]),
  });
  const partial = await fixtureRecord(root, "trusted", { search: { notFor: ["workout journal"] } });
  const together = rank({ request, entries: [untrusted, partial], vocabulary: vocabulary() });
  expect(hit(together.stacks, "trusted").tier).toBe("partial");
  expect(together.stacks.map(({ id }) => id)).toEqual(["trusted", "perfect"]);
});

test("body-only health never enters coverage but a summary health match does [4.5c#14a]", async () => {
  const rank = await loadRank();
  const entries = await records();
  const input = { request: "an iOS health app", entries, vocabulary: vocabulary(), limit: 20 };
  const before = rank(input);
  expect(hit(before.stacks, "mobile-expo").coverage).toBe(1);
  expect(before.understood.unmatched).toEqual(["health"]);
  const health = await fixtureRecord(join(space.dir(), "registry"), "neutral", {
    search: {
      platforms: ["desktop"],
      summary: "Health.",
      requests: [],
      synonyms: [],
      useCases: [],
      goodFor: [],
    },
  });
  const after = rank({ ...input, entries: [...entries, health] });
  expect(hit(after.stacks, "mobile-expo").coverage).toBe(0.5);
  expect(after.understood.unmatched).not.toContain("health");
});
