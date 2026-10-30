import { rank } from "@steamfield/stacks-format";
import { expect, test } from "vitest";
import { records, vocabulary } from "./helpers/search-command";

test.each(["machine learning pipeline", "a chrome extension"])(
  "unmatched intent has no strong hit: %s",
  async (request) => {
    const result = rank({ request, entries: await records(), vocabulary: vocabulary(), limit: 20 });
    expect([...result.stacks, ...result.fragments].filter((hit) => hit.tier === "strong")).toEqual(
      [],
    );
  },
);

test("a language mismatch cannot remain a strong or high scoring stack", async () => {
  const result = rank({
    request: "rust web server",
    entries: await records(),
    vocabulary: vocabulary(),
    limit: 20,
  });
  for (const hit of result.stacks.filter((row) =>
    row.penalties.some((penalty) => penalty.kind === "language"),
  )) {
    expect(hit.tier).not.toBe("strong");
    expect(hit.score).toBeLessThan(0.5);
  }
});

test("determiners after negators exclude a backend", async () => {
  const result = rank({
    request: "a react app without a backend",
    entries: await records(),
    vocabulary: vocabulary(),
    limit: 20,
  });
  expect(result.understood.platforms).not.toContain("server");
  for (const hit of result.stacks.filter(
    (row) => row.id === "typescript-api" || row.id === "python-api",
  ))
    expect(hit.tier).not.toBe("strong");
});

test("a named exclusion demotes Next.js", async () => {
  const result = rank({
    request: "not next.js, a react spa with vite",
    entries: await records(),
    vocabulary: vocabulary(),
    limit: 20,
  });
  expect(result.stacks[0]?.id).not.toBe("nextjs");
  expect(result.stacks.find((hit) => hit.id === "nextjs")?.penalties).toContainEqual(
    expect.objectContaining({
      kind: "notFor",
      request: "next.js",
      entry: "excluded by name in the request",
    }),
  );
  expect(result.understood.unmatched).not.toContain("js");
});

test("a negated named stack stays out of the strong matches", async () => {
  const result = rank({
    request: "I don't want next.js, a react spa",
    entries: await records(),
    vocabulary: vocabulary(),
    limit: 20,
  });
  expect(result.stacks.find((hit) => hit.id === "nextjs")?.penalties).toContainEqual(
    expect.objectContaining({ entry: "excluded by name in the request" }),
  );
  expect(result.stacks.find((hit) => hit.id === "nextjs")?.tier).not.toBe("strong");
});

test.each([
  "a react spa instead of using next.js",
  "react web app, avoid using next.js",
  "react web app but not with next.js",
  "react web app, anything but next.js",
  "react web app except for next.js",
])("an excluded stack is never the strong match: %s", async (request) => {
  const result = rank({ request, entries: await records(), vocabulary: vocabulary(), limit: 20 });
  const nextjs = result.stacks.find((hit) => hit.id === "nextjs");
  expect(nextjs?.tier).not.toBe("strong");
  expect(nextjs?.penalties).toContainEqual(
    expect.objectContaining({ entry: "excluded by name in the request" }),
  );
});

test("a fragment that doesn't apply to the named stack carries a fit penalty", async () => {
  const result = rank({
    request: "next.js web app with posthog analytics",
    entries: await records(),
    vocabulary: vocabulary(),
    limit: 20,
  });
  const posthog = result.fragments.find((hit) => hit.id === "posthog");
  expect(posthog?.penalties).toContainEqual(
    expect.objectContaining({ kind: "notFor", request: "next.js" }),
  );
  expect(posthog?.tier).not.toBe("strong");
});

test("only explicitly named stacks can be strong", async () => {
  const result = rank({
    request: "next.js saas with auth and stripe payments",
    entries: await records(),
    vocabulary: vocabulary(),
    limit: 20,
  });
  expect(result.stacks[0]).toMatchObject({ id: "nextjs", tier: "strong" });
  expect(result.stacks.filter((hit) => hit.tier === "strong").map((hit) => hit.id)).toEqual([
    "nextjs",
  ]);
});

test("generic stack names do not add fragment fit penalties", async () => {
  const entries = await records();
  for (const request of ["python api", "astro site with comments"]) {
    const result = rank({ request, entries, vocabulary: vocabulary(), limit: 20 });
    expect(
      result.fragments
        .flatMap((hit) => hit.penalties)
        .filter((penalty) => penalty.entry.startsWith("applies to")),
      request,
    ).toEqual([]);
  }
});

test("a fit penalty names each requested stack once", async () => {
  const result = rank({
    request: "react router app with auth",
    entries: await records(),
    vocabulary: vocabulary(),
    limit: 20,
  });
  const penalty = result.fragments
    .find((hit) => hit.id === "clerk")
    ?.penalties.find((item) => item.entry.startsWith("applies to"));
  expect(penalty?.request).toBe("react router");
});

test("fit-penalty mention text dedupes casing", async () => {
  const entries = (await records()).map((record) =>
    record.entry.id === "clerk" && record.entry.meta.kind === "fragment"
      ? {
          ...record,
          entry: { ...record.entry, meta: { ...record.entry.meta, appliesTo: ["unrepresented"] } },
        }
      : record,
  );
  const result = rank({
    request: "Next.js and next.js auth",
    entries,
    vocabulary: vocabulary(),
    limit: 20,
  });
  const penalty = result.fragments
    .flatMap((hit) => hit.penalties)
    .find((item) => item.entry.startsWith("applies to"));
  expect(penalty?.request).toBe("Next.js");
});

test("a TypeScript CLI published to npm remains strong", async () => {
  const result = rank({
    request: "typescript cli published to npm",
    entries: await records(),
    vocabulary: vocabulary(),
  });
  expect(result.stacks[0]).toMatchObject({ id: "typescript-cli", tier: "strong" });
});

test("fragment fit follows explicitly named stacks", async () => {
  const entries = await records();
  const result = rank({
    request: "next.js saas with auth and stripe payments",
    entries,
    vocabulary: vocabulary(),
    limit: 20,
  });
  expect(result.fragments.find((hit) => hit.id === "clerk")?.penalties).toContainEqual(
    expect.objectContaining({ kind: "notFor", entry: "applies to mobile-expo" }),
  );
  expect(
    result.fragments
      .find((hit) => hit.id === "drizzle-postgres")
      ?.penalties.some((penalty) => penalty.entry.startsWith("applies to")),
  ).toBe(false);
  const generic = rank({ request: "typescript api", entries, vocabulary: vocabulary(), limit: 20 });
  expect(
    generic.fragments
      .flatMap((hit) => hit.penalties)
      .filter((penalty) => penalty.entry.startsWith("applies to")),
  ).toEqual([]);
  const multiple = rank({
    request: "next.js and mobile-expo with auth",
    entries,
    vocabulary: vocabulary(),
    limit: 20,
  });
  expect(
    multiple.fragments
      .find((hit) => hit.id === "clerk")
      ?.penalties.some((penalty) => penalty.entry.startsWith("applies to")),
  ).toBe(false);
});

test.each(["react app with postgres", "next stage with auth"])(
  "a generic leading word does not penalize fragments: %s",
  async (request) => {
    const result = rank({ request, entries: await records(), vocabulary: vocabulary(), limit: 30 });
    expect(
      result.fragments
        .flatMap((hit) => hit.penalties)
        .filter((penalty) => penalty.entry.startsWith("applies to")),
    ).toEqual([]);
  },
);

test("add requests describe an existing project", async () => {
  const result = rank({
    request: "add authentication",
    entries: await records(),
    vocabulary: vocabulary(),
    limit: 20,
  });
  expect(result.stacks).toEqual([]);
  const existing = rank({
    request: "add browser tests to my React app",
    entries: await records(),
    vocabulary: vocabulary(),
    limit: 20,
  });
  expect(existing.stacks.length).toBeGreaterThan(0);
  for (const hit of existing.stacks) {
    expect(hit.tier).not.toBe("strong");
    expect(hit.why).toContainEqual(
      expect.objectContaining({
        field: "constraint",
        matched: expect.stringContaining("existing repository"),
      }),
    );
  }
});

test.each([
  ["go cli", "go-cli"],
  ["a blog", "astro-blog"],
  ["desktop app", "tauri-react"],
  ["rest api in python with postgres", "python-api"],
])("clear intent remains strong for %s", async (request, first) => {
  const result = rank({ request, entries: await records(), vocabulary: vocabulary() });
  expect(result.stacks[0]).toMatchObject({ id: first, tier: "strong" });
});

test.each(["ts api", "typescript api"])(
  "bundled %s keeps TypeScript first with and without cached quality",
  async (request) => {
    const entries = await records();
    for (const cached of [false, true]) {
      const result = rank({
        request,
        vocabulary: vocabulary(),
        entries: entries.map((record) => ({
          ...record,
          ...(cached && record.entry.id === "python-react"
            ? {
                evidence: {
                  stats: { greenRateLower: 0.75, projects: 70, sample: 60, window: 28 as const },
                },
              }
            : {}),
        })),
      });
      expect(result.stacks[0], `cached: ${cached}`).toMatchObject({
        id: "typescript-api",
        tier: "strong",
      });
    }
  },
);
