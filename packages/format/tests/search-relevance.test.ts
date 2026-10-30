import { rank } from "@steamfield/stacks-format";
import { expect, test } from "vitest";
import { existingRepository, requestConstraints, stackMentions } from "../src/search/constraints";
import { hostingInput, relevanceInput } from "./helpers/search-relevance";

test("negators may have determiners before a facet", () => {
  const base = relevanceInput("").vocabulary;
  const vocabulary = {
    ...base,
    platforms: { ...base.platforms, server: ["api", "server", "backend"] },
  };
  const first = requestConstraints("an app, not an API", vocabulary);
  expect(first.positive).not.toMatch(/\bapi\b/i);
  expect(first.facets).toContainEqual(
    expect.objectContaining({ field: "platforms", matched: "server", from: "not an API" }),
  );
  const second = requestConstraints("without the backend in Python", vocabulary);
  expect(second.positive).not.toMatch(/\bbackend\b/i);
  expect(second.positive).toMatch(/Python/);
  expect(second.facets).toContainEqual(
    expect.objectContaining({ field: "platforms", matched: "server", from: "without the backend" }),
  );
});

const mentionVocabulary = {
  ...relevanceInput("").vocabulary,
  languages: { typescript: ["ts"] },
  platforms: { server: ["api", "backend"] },
};

test("stack mentions fold punctuation while vocabulary-word ids need exact id spelling", () => {
  const stacks = [
    { entry: { id: "nextjs", meta: { name: "Next.js starter" } } },
    { entry: { id: "sveltekit", meta: { name: "SvelteKit starter" } } },
    { entry: { id: "typescript-api", meta: { name: "TypeScript API" } } },
    { entry: { id: "astro-fullstack", meta: { name: "Astro Fullstack" } } },
  ];
  const mentions = (request: string) => stackMentions(request, stacks, mentionVocabulary);
  for (const spelling of ["next.js", "next js", "nextjs"])
    expect(mentions(`not ${spelling}`)).toContainEqual(
      expect.objectContaining({ id: "nextjs", negated: true }),
    );
  expect(mentions("svelte kit")).toContainEqual(
    expect.objectContaining({ id: "sveltekit", negated: false }),
  );
  expect(mentions("typescript api").some((mention) => mention.id === "typescript-api")).toBe(false);
  expect(mentions("typescript-api")).toContainEqual(
    expect.objectContaining({ id: "typescript-api" }),
  );
  // "astro" is no vocabulary word, so the plain words name the stack.
  expect(mentions("astro fullstack")).toContainEqual(
    expect.objectContaining({ id: "astro-fullstack" }),
  );
});

test("a leading prefix of a longer stack name is a mention", () => {
  const stacks = [{ entry: { id: "tauri-react", meta: { name: "Tauri desktop app with React" } } }];
  expect(stackMentions("Tauri desktop", stacks, mentionVocabulary)).toContainEqual(
    expect.objectContaining({ id: "tauri-react" }),
  );
});

test("generic name prefixes and single-word vocabulary ids do not name stacks", () => {
  const stacks = [
    { entry: { id: "python-react", meta: { name: "Python API + React SPA" } } },
    { entry: { id: "astro-fullstack", meta: { name: "Astro site + Effect API" } } },
    { entry: { id: "astro-blog", meta: { name: "Astro blog" } } },
    { entry: { id: "cli", meta: { name: "CLI starter" } } },
    { entry: { id: "go", meta: { name: "Go starter" } } },
    { entry: { id: "api", meta: { name: "API starter" } } },
  ];
  const vocabulary = {
    ...mentionVocabulary,
    languages: { ...mentionVocabulary.languages, python: ["python"], go: ["go"] },
    platforms: { ...mentionVocabulary.platforms, cli: ["cli"] },
  };
  expect(stackMentions("python api", stacks, vocabulary)).toEqual([]);
  expect(stackMentions("astro site with comments", stacks, vocabulary)).toEqual([]);
  expect(stackMentions("go cli api", stacks, vocabulary)).toEqual([]);
  expect(stackMentions("astro fullstack", stacks, vocabulary)).toContainEqual(
    expect.objectContaining({ id: "astro-fullstack" }),
  );
  const unique = [{ entry: { id: "acme-web", meta: { name: "Acme app" } } }];
  expect(stackMentions("Acme app", unique, vocabulary)).toContainEqual(
    expect.objectContaining({ id: "acme-web" }),
  );
});

test.each([
  "don't want",
  "do not use",
  "doesn't need",
  "won't use",
  "avoid",
  "instead of",
  "other than",
  "except",
  "rather than",
  "not using",
  "instead of using",
  "avoid using",
  "but not with",
  "anything but",
  "except for",
  "rather than using",
])("%s negates a named stack and a facet", (cue) => {
  const stacks = [{ entry: { id: "nextjs", meta: { name: "Next.js starter" } } }];
  const request = `${cue} next.js and ${cue} Python`;
  const vocabulary = { ...mentionVocabulary, languages: { python: ["python"] } };
  expect(stackMentions(request, stacks, vocabulary)).toContainEqual(
    expect.objectContaining({ id: "nextjs", negated: true }),
  );
  expect(requestConstraints(request, vocabulary).facets).toContainEqual(
    expect.objectContaining({ matched: "python", exclusive: false }),
  );
});

test("one generic leading name word does not name a stack", () => {
  const stacks = [
    {
      entry: {
        id: "cloudflare-react-router",
        meta: { name: "React Router on Cloudflare Workers" },
      },
    },
    { entry: { id: "nextjs", meta: { name: "Next.js starter" } } },
  ];
  expect(stackMentions("react app", stacks, mentionVocabulary)).toEqual([]);
  expect(stackMentions("next stage", stacks, mentionVocabulary)).toEqual([]);
});

test("a negated stack does not trigger a fragment exclusion", () => {
  const input = relevanceInput("not typed-api, deploy to Cloudflare Pages");
  const entries = input.entries.map((record) =>
    record.entry.id === "pages" && record.search?.kind === "fragment"
      ? { ...record, search: { ...record.search, notFor: ["typed-api"] } }
      : record,
  );
  const result = rank({ ...input, entries });
  expect(result.fragments.find((hit) => hit.id === "pages")?.penalties).not.toContainEqual(
    expect.objectContaining({ kind: "notFor", entry: "typed-api" }),
  );
});

test("a fragment that fits only an unnamed stack carries a fit penalty", () => {
  const input = relevanceInput("typed-api React dashboard deploy");
  const entries = input.entries.map((record) =>
    record.entry.id === "pages" && record.entry.meta.kind === "fragment"
      ? {
          ...record,
          entry: { ...record.entry, meta: { ...record.entry.meta, appliesTo: ["typed-web"] } },
        }
      : record,
  );
  const result = rank({ ...input, entries });
  expect(result.stacks.find((hit) => hit.id === "typed-api")?.tier).toBe("strong");
  expect(result.stacks.find((hit) => hit.id === "typed-web")?.tier).toBe("partial");
  expect(result.fragments.find((hit) => hit.id === "pages")?.penalties).toContainEqual(
    expect.objectContaining({ kind: "notFor", entry: "applies to typed-web" }),
  );
});

test("untrusted provenance does not dilute the first score penalty", () => {
  const input = relevanceInput("add TypeScript API");
  const entries = input.entries.filter((record) => record.entry.id === "typed-api");
  const trusted = rank({ ...input, entries }).stacks[0];
  const untrusted = rank({
    ...input,
    entries: entries.map((record) => ({ ...record, entry: { ...record.entry, trusted: false } })),
  }).stacks[0];
  expect(trusted?.score).toBeDefined();
  expect(untrusted?.score).toBe(trusted?.score);
});

test.each([
  "add authentication",
  "please add authentication",
  "i want to add authentication",
  "i'd like to add authentication",
])("an opening add request targets an existing project: %s", (request) =>
  expect(existingRepository(request)).toBe(true),
);

test.each(["ts api", "typescript api"])(
  "cached quality preserves a clear lexical lead for %s",
  (request) => {
    const input = relevanceInput(request);
    const plain = rank(input);
    expect(plain.stacks[0]?.id).toBe("typed-api");
    const result = rank({
      ...input,
      entries: input.entries.map((record) => ({
        ...record,
        evidence: {
          stats: {
            greenRateLower: record.entry.id === "typed-api" ? 0 : 1,
            projects: 100,
            sample: 100,
            window: 28,
          },
        },
      })),
    });
    expect(result.stacks[0]?.id).toBe("typed-api");
  },
);

test.each([
  "TypeScript only, no Python, for a server rendered React dashboard",
  "a React dashboard without Python",
  "a React dashboard, not Python",
  "a Python-free React dashboard",
  "only TypeScript for a React dashboard",
  "a React dashboard with no Python on the backend",
  "a React dashboard without Python on the backend",
  "a React dashboard with a backend without Python",
])("language constraints demote the mixed backend for %s", (request) => {
  const result = rank(relevanceInput(request));
  expect(result.stacks[0]).toMatchObject({ id: "typed-web", tier: "strong" });
  expect(result.stacks.find((hit) => hit.id === "mixed-web")?.tier).not.toBe("strong");
  expect(result.understood.languages).not.toContain("python");
});

test("TypeScript only on the frontend leaves a Python API eligible", () => {
  const result = rank(relevanceInput("Python API with TypeScript only on frontend"));
  expect(result.stacks[0]).toMatchObject({ id: "mixed-web", tier: "strong" });
});

test("not only is additive rather than an exclusive language constraint", () => {
  const result = rank(relevanceInput("a React dashboard with not only TypeScript but Python"));
  expect(result.stacks.find((hit) => hit.id === "mixed-web")).toMatchObject({
    tier: "strong",
    penalties: [],
  });
});

test("a negated platform demotes entries even when another platform matches", () => {
  const result = rank(relevanceInput("browser tests without server"));
  expect(result.understood.platforms).toEqual(["web"]);
  expect(result.understood.unmatched).not.toContain("server");
  expect(result.stacks.length).toBeGreaterThan(0);
  for (const hit of result.stacks) {
    expect(hit.tier).not.toBe("strong");
    expect(hit.why).toContainEqual(
      expect.objectContaining({ field: "constraint", from: "without server" }),
    );
  }
});

test("an unsupported hosting destination has no strong hit in either kind", () => {
  const result = rank(hostingInput("deploy my existing app to Fly.io"));
  expect(result.noStrongMatch).toBe(true);
  expect([...result.stacks, ...result.fragments].filter((hit) => hit.tier === "strong")).toEqual(
    [],
  );
  expect(result.fragments.find((hit) => hit.id === "pages")?.why).toContainEqual(
    expect.objectContaining({ field: "constraint", matched: expect.stringContaining("Fly.io") }),
  );
});

test.each([
  "migrate to Cloudflare Pages",
  "migrate from Fly.io to Cloudflare Pages",
  "how to migrate to Cloudflare Pages",
  "deploy to Cloudflare Pages today",
  "how to deploy to Cloudflare Pages today",
])("the destination wins over the source for %s", (request) => {
  const result = rank(relevanceInput(request));
  expect(result.fragments[0]).toMatchObject({ id: "pages", tier: "strong" });
  expect(result.noStrongMatch).toBe(false);
});

test.each([
  "add e2e browser tests to my existing React repo",
  "browser tests for my repo",
  "add browser tests to a React repository",
  "add e2e browser tests to my React app",
  "add browser tests to our TypeScript project",
])("scaffolds cannot strongly satisfy an existing repository addition: %s", (request) => {
  const result = rank(relevanceInput(request));
  expect(result.noStrongMatch).toBe(true);
  expect(result.stacks.length).toBeGreaterThan(0);
  expect(result.stacks.every((hit) => hit.tier !== "strong")).toBe(true);
  expect(result.stacks[0]?.why).toContainEqual(
    expect.objectContaining({
      field: "constraint",
      matched: expect.stringContaining("existing repository"),
    }),
  );
});

test("a new dashboard for an existing business remains a scaffold request", () => {
  const result = rank(relevanceInput("new React dashboard for my existing business"));
  expect(result.stacks[0]).toMatchObject({ id: "typed-web", tier: "strong", penalties: [] });
  expect(result.noStrongMatch).toBe(false);
});

test.each([undefined, "stack", "fragment"] as const)(
  "noStrongMatch describes only returned kinds (%s)",
  (kind) => {
    for (const request of ["migrate to Cloudflare Pages", "React dashboard"]) {
      const result = rank({ ...relevanceInput(request), kind });
      expect(result.noStrongMatch).toBe(
        ![...result.stacks, ...result.fragments].some((hit) => hit.tier === "strong"),
      );
    }
  },
);
