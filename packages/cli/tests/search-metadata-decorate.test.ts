import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import {
  card,
  cardPath,
  type DecorateWorkspace,
  decorate,
  decorateWorkspace,
  entryAt,
  openRouter,
  put,
  type Ref,
  readJson,
  searchFindings,
  sourceDigest,
  stamp,
  validateSearch,
} from "./helpers/search-metadata";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());
const mobile = { kind: "stack", id: "mobile-expo" } as const;
const sentinel = "test-openrouter-secret-4-5b-never-persist";
const model = "fixture/model";
function draftCard(ref: Ref) {
  return {
    ...card(ref),
    description: "Guidance and starter files for building the requested project.",
    seoDescription: "Build a project from the selected recipe.",
    projectExamples: [
      {
        title: "Illustrative project",
        description: "An illustrative project built from the selected recipe.",
      },
    ],
    plain: {
      whatItIs: "A starter for a project using the selected recipe.",
      goodAt: ["Building a small project"],
      notGoodAt: ["Shipping a finished product without further work"],
    },
  };
}
function setup() {
  const f = decorateWorkspace(space.dir());
  rmSync(cardPath(f.registry, mobile), { force: true });
  return f;
}
// Validates each named stack alone, so the cost doesn't grow with the bundled registry the
// workspace copies, and returns the ones whose card is stale.
async function staleStacks(f: DecorateWorkspace, ids: ReadonlyArray<string>) {
  const stale: string[] = [];
  for (const id of ids) {
    const report = await validateSearch(join(f.registry, "stacks", id), {
      home: join(f.root, "home"),
      registry: f.registry,
    });
    for (const { check, entry } of searchFindings(report))
      if (check === "search-stale" && entry !== undefined) stale.push(entry);
  }
  return stale;
}
function success(result: Awaited<ReturnType<typeof decorate>>) {
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).not.toMatch(/error|failed/i);
  expect(result.stdout.trim()).not.toBe("");
}
async function drafted(f: DecorateWorkspace, ref: Ref = mobile) {
  const { SearchMetadata } = await import("@steamfield/stacks-format");
  const value = Schema.decodeUnknownSync(SearchMetadata)(readJson(cardPath(f.registry, ref)));
  expect(value.source).toMatchObject({
    digest: await sourceDigest(f.registry, ref),
    by: "drafted",
    model,
    reviewedAt: null,
    promptVersion: 3,
  });
  expect(value.source.promptVersion).toBeGreaterThan(0);
  expect(value).toEqual({ ...draftCard(ref), source: value.source });
  return value;
}
function requestText(body: unknown) {
  const value = Schema.decodeUnknownSync(
    Schema.Struct({
      messages: Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.String })),
    }),
  )(body);
  return value.messages.map(({ content }) => content).join("\n");
}
async function assertPrompt(f: DecorateWorkspace, body: unknown) {
  const text = requestText(body);
  const entry = await entryAt(f.registry, mobile);
  for (const input of [
    entry.id,
    entry.meta.name,
    entry.meta.description,
    ...entry.meta.tags,
    ...Object.keys(entry.meta.deps),
  ])
    expect(text).toContain(input);
  expect(text.includes(entry.body) || text.includes(JSON.stringify(entry.body))).toBe(true);
  const { SearchMetadata, SearchVocabulary } = await import("@steamfield/stacks-format");
  const vocabulary = Schema.decodeUnknownSync(SearchVocabulary)(
    readJson(join(f.registry, "search/vocabulary.json")),
  );
  for (const category of [
    vocabulary.platforms,
    vocabulary.productKinds,
    vocabulary.languages,
    vocabulary.capabilities,
  ]) {
    for (const [name, aliases] of Object.entries(category)) {
      expect(text).toContain(name);
      for (const alias of Schema.decodeUnknownSync(Schema.Array(Schema.String))(aliases))
        expect(text).toContain(alias);
    }
  }
  const examples = files(join(f.registry, "search"))
    .filter((path) => !path.endsWith("/vocabulary.json"))
    .map((path) => Schema.decodeUnknownSync(SearchMetadata)(readJson(path)))
    .filter(({ source }) => source.reviewedAt !== null);
  const included = new Set(
    examples.filter(({ summary }) => text.includes(summary)).map(({ summary }) => summary),
  );
  expect(included.size).toBeGreaterThanOrEqual(2);
}
function files(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    if (["node_modules", ".git"].includes(name)) return [];
    const path = join(root, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

test("new drafts without plain copy are rejected after the correction retry [4.5f#1]", async () => {
  const f = setup();
  const { plain: _plain, ...withoutPlain } = draftCard(mobile);
  const response = { ...withoutPlain, source: card(mobile).source };
  const server = await openRouter([
    { content: JSON.stringify(response) },
    { content: JSON.stringify(response) },
  ]);
  try {
    const result = await decorate(f, [mobile.id, "--model", model], {
      env: { OPENROUTER_BASE_URL: server.url, OPENROUTER_API_KEY: sentinel },
    });
    success(result);
    expect(server.requests).toHaveLength(2);
    expect(existsSync(cardPath(f.registry, mobile))).toBe(false);
  } finally {
    await server.close();
  }
});

test("dry-run prints prompt sizes without contacting OpenRouter [4.5b#8]", async () => {
  const f = setup();
  const server = await openRouter([]);
  try {
    const result = await decorate(f, ["--dry-run", mobile.id], {
      env: { OPENROUTER_BASE_URL: server.url },
    });
    success(result);
    expect(result.stdout).toMatch(/mobile-expo/);
    expect(result.stdout).toMatch(/\d+\s*(tokens?|words?|bytes?|characters?)/i);
    expect(result.stdout).toMatch(/estimate|estimated|\$/i);
    expect(server.requests).toEqual([]);
    expect(existsSync(cardPath(f.registry, mobile))).toBe(false);
  } finally {
    await server.close();
  }
}, 30_000);

test("drafts through the real HTTP boundary and keeps credentials out of all writes [4.5b#8] [4.5b#12]", async () => {
  const f = setup();
  const response = {
    ...draftCard(mobile),
    source: { ...card(mobile).source, reviewedAt: "2020-01-01", by: "author" },
  };
  const server = await openRouter([{ content: JSON.stringify(response) }]);
  try {
    const result = await decorate(f, [mobile.id, "--model", model], {
      env: {
        OPENROUTER_BASE_URL: server.url,
        OPENROUTER_API_KEY: sentinel,
        STACKS_LOG_FILE: join(f.root, "requests.jsonl"),
      },
    });
    success(result);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      url: "/api/v1/chat/completions",
      authorization: `Bearer ${sentinel}`,
      body: { model, response_format: { type: "json_object" } },
    });
    await assertPrompt(f, server.requests[0]?.body);
    await drafted(f);
    for (const file of files(f.root))
      expect(readFileSync(file).includes(Buffer.from(sentinel)), file).toBe(false);
    expect(result.stdout + result.stderr).not.toContain(sentinel);
    expect(result.stdout + result.stderr).toMatch(/0\.001/);
  } finally {
    await server.close();
  }
}, 30_000);

test.each([
  {
    label: "malformed JSON",
    content: "{bad json",
    diagnostic: /json|parse|unexpected|syntax|property|position/i,
  },
  {
    label: "missing languages",
    content: JSON.stringify(
      Object.fromEntries(
        Object.entries(draftCard(mobile)).filter(([name]) => name !== "languages"),
      ),
    ),
    diagnostic: /languages/i,
  },
])(
  "invalid model output ($label) is retried once then skipped [4.5b#9]",
  async ({ content, diagnostic }) => {
    const f = setup();
    const server = await openRouter([{ content }, { content }]);
    try {
      const result = await decorate(f, [mobile.id], {
        env: { OPENROUTER_BASE_URL: server.url, OPENROUTER_API_KEY: sentinel },
      });
      expect(result.stdout + result.stderr).toMatch(/skip/i);
      expect(result.stdout + result.stderr).toContain(mobile.id);
      expect(result.stderr).not.toMatch(/Cannot find|Module not found|SyntaxError/);
      expect([0, 2]).toContain(result.status);
      expect(server.requests).toHaveLength(2);
      const initial = requestText(server.requests[0]?.body);
      const retry = requestText(server.requests[1]?.body);
      expect(retry).toContain(initial);
      expect(retry.replace(initial, "")).toMatch(diagnostic);
      expect(existsSync(cardPath(f.registry, mobile))).toBe(false);
    } finally {
      await server.close();
    }
  },
  30_000,
);

test("a schema decode retry can recover and write the corrected card [4.5b#9]", async () => {
  const f = setup();
  const invalid = { ...draftCard(mobile), languages: "typescript" };
  const server = await openRouter([
    { content: JSON.stringify(invalid) },
    { content: JSON.stringify(draftCard(mobile)) },
  ]);
  try {
    success(
      await decorate(f, [mobile.id, "--model", model], {
        env: { OPENROUTER_BASE_URL: server.url, OPENROUTER_API_KEY: sentinel },
      }),
    );
    expect(server.requests).toHaveLength(2);
    const initial = requestText(server.requests[0]?.body);
    const retry = requestText(server.requests[1]?.body);
    expect(retry).toContain(initial);
    expect(retry.replace(initial, "")).toMatch(/languages/i);
    await drafted(f);
  } finally {
    await server.close();
  }
}, 30_000);

test("429 retries the same entry and writes exactly one draft [4.5b#9]", async () => {
  const f = setup();
  const server = await openRouter([
    { status: 429, content: "rate limit" },
    { content: JSON.stringify(draftCard(mobile)) },
  ]);
  try {
    const result = await decorate(f, [mobile.id, "--model", model], {
      env: { OPENROUTER_BASE_URL: server.url, OPENROUTER_API_KEY: sentinel },
    });
    success(result);
    expect(server.requests).toHaveLength(2);
    await drafted(f);
  } finally {
    await server.close();
  }
}, 30_000);

test("a cap prevents the next paid request and reports the actual total [4.5b#10]", async () => {
  const f = setup();
  const second = { kind: "stack", id: "second" } as const;
  rmSync(cardPath(f.registry, second), { force: true });
  put(
    join(f.registry, "stacks/second/STACK.md"),
    readFileSync(join(f.registry, "stacks/mobile-expo/STACK.md"), "utf8").replace(
      /^id: mobile-expo$/m,
      "id: second",
    ),
  );
  // At 0.006 per request a similarly sized prompt exceeds the remaining 0.004 budget.
  const server = await openRouter([{ content: JSON.stringify(draftCard(mobile)), cost: 0.006 }]);
  try {
    const result = await decorate(
      f,
      [mobile.id, second.id, "--model", model, "--max-usd", "0.01"],
      { env: { OPENROUTER_BASE_URL: server.url, OPENROUTER_API_KEY: sentinel } },
    );
    expect([0, 2]).toContain(result.status);
    expect(result.stderr).not.toMatch(/Cannot find|Module not found|SyntaxError/);
    expect(result.stdout + result.stderr).toMatch(/budget|cap|limit/i);
    expect(result.stdout + result.stderr).toMatch(/0\.006/);
    expect(server.requests).toHaveLength(1);
    await drafted(f);
    expect(existsSync(cardPath(f.registry, second))).toBe(false);
  } finally {
    await server.close();
  }
}, 30_000);

test("a sufficient budget drafts both selected entries and totals their cost [4.5b#10]", async () => {
  const f = setup();
  const second = { kind: "stack", id: "second" } as const;
  const server = await openRouter([
    { content: JSON.stringify(draftCard(mobile)), cost: 0.002 },
    { content: JSON.stringify(draftCard(second)), cost: 0.003 },
  ]);
  try {
    const result = await decorate(
      f,
      [mobile.id, second.id, "--model", model, "--max-usd", "1.00"],
      { env: { OPENROUTER_BASE_URL: server.url, OPENROUTER_API_KEY: sentinel } },
    );
    success(result);
    expect(server.requests).toHaveLength(2);
    await drafted(f);
    await drafted(f, second);
    expect(result.stdout + result.stderr).toMatch(/0\.005/);
  } finally {
    await server.close();
  }
}, 30_000);

test.each([
  { env: { CLAUDECODE: "1" }, tty: true, reason: "agent" },
  { env: {}, tty: false, reason: "no-tty" },
])(
  "approval refuses $reason and preserves an unreviewed card [4.5b#11]",
  async ({ env, tty, reason }) => {
    const f = setup();
    const value = {
      ...card(mobile),
      source: { ...card(mobile).source, by: "drafted", model, promptVersion: 1, reviewedAt: null },
    };
    put(cardPath(f.registry, mobile), JSON.stringify(value));
    const before = readFileSync(cardPath(f.registry, mobile), "utf8");
    const result = await decorate(f, ["--approve", mobile.id], { env, tty });
    expect(result.status, result.stdout + result.stderr).toBe(6);
    if (!tty) expect(result.stdout).toBe("");
    expect(result.stdout + result.stderr).toContain("PermissionDenied");
    expect(result.stdout + result.stderr).toContain(reason);
    expect(readFileSync(cardPath(f.registry, mobile), "utf8")).toBe(before);
  },
  30_000,
);

test("a rejected argument prints the parser's reason, not a generic failure", async () => {
  const f = setup();
  const result = await decorate(f, ["--approve", mobile.id, "extra-id"], { tty: false });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim()).toBe(
    "Review one id with --restamp or --approve, without drafting flags.",
  );
}, 30_000);

test("a person with terminal stdin can approve without drafting [4.5b#11]", async () => {
  const f = setup();
  const value = {
    ...card(mobile),
    source: { ...card(mobile).source, by: "drafted", model, promptVersion: 1, reviewedAt: null },
  };
  put(cardPath(f.registry, mobile), JSON.stringify(value));
  const before = new Date().toISOString().slice(0, 10);
  const result = await decorate(f, ["--approve", mobile.id], { tty: true });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  const { SearchMetadata } = await import("@steamfield/stacks-format");
  const approved = Schema.decodeUnknownSync(SearchMetadata)(readJson(cardPath(f.registry, mobile)));
  expect([before, new Date().toISOString().slice(0, 10)]).toContain(approved.source.reviewedAt);
  // Approval also stamps the card against the entry as it stands, so one command clears a draft.
  expect(approved).toEqual({
    ...value,
    source: {
      ...value.source,
      reviewedAt: approved.source.reviewedAt,
      digest: await sourceDigest(f.registry, mobile),
    },
  });
  expect(result.stdout).toContain(`Approved and restamped stack/${mobile.id}.`);
  expect(result.stdout).not.toContain("changed since");
}, 30_000);

test("approving a model draft stamped against the current entry keeps its digest and says nothing more", async () => {
  const f = setup();
  const stamped = await stamp(f.registry, mobile);
  put(
    cardPath(f.registry, mobile),
    JSON.stringify({
      ...stamped,
      source: { ...stamped.source, by: "drafted", model, promptVersion: 3, reviewedAt: null },
    }),
  );
  const result = await decorate(f, ["--approve", mobile.id], { tty: true });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain(`Approved and restamped stack/${mobile.id}.`);
  expect(result.stdout).not.toContain("changed since");
  const { SearchMetadata } = await import("@steamfield/stacks-format");
  const approved = Schema.decodeUnknownSync(SearchMetadata)(readJson(cardPath(f.registry, mobile)));
  expect(approved.source.digest).toBe(stamped.source.digest);
}, 30_000);

test("approving a model draft whose entry changed since says so and leaves nothing stale", async () => {
  const f = setup();
  const stamped = await stamp(f.registry, mobile);
  put(
    cardPath(f.registry, mobile),
    JSON.stringify({
      ...stamped,
      source: { ...stamped.source, by: "drafted", model, promptVersion: 3, reviewedAt: null },
    }),
  );
  const entry = join(f.registry, "stacks/mobile-expo/STACK.md");
  put(entry, `${readFileSync(entry, "utf8")}\nClarification.\n`);
  const result = await decorate(f, ["--approve", mobile.id], { tty: true });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  // The terminal stdin is a pseudo-terminal, which echoes into stdout; check the lines we print.
  const note = `stack/${mobile.id}: the entry changed since this card was stamped; approval stamps it against the current entry.`;
  const done = `Approved and restamped stack/${mobile.id}.`;
  expect(result.stdout).toContain(note);
  expect(result.stdout.indexOf(note)).toBeLessThan(result.stdout.indexOf(done));
  expect(await staleStacks(f, [mobile.id])).toEqual([]);
}, 30_000);

test("changing body text stales only its card and restamp changes only the review baseline [4.5b#2]", async () => {
  const f = setup();
  const original = await stamp(f.registry, mobile);
  const second = { kind: "stack", id: "second" } as const;
  await stamp(f.registry, second);
  const entry = join(f.registry, "stacks/mobile-expo/STACK.md");
  put(entry, `${readFileSync(entry, "utf8")}\nClarification.\n`);
  // The changed stack and the stamped control beside it.
  expect(await staleStacks(f, [mobile.id, second.id])).toEqual([mobile.id]);
  const before = new Date().toISOString().slice(0, 10);
  success(await decorate(f, ["--restamp", mobile.id]));
  const { SearchMetadata } = await import("@steamfield/stacks-format");
  const restamped = Schema.decodeUnknownSync(SearchMetadata)(
    readJson(cardPath(f.registry, mobile)),
  );
  expect(restamped.source.digest).not.toBe(original.source.digest);
  expect([before, new Date().toISOString().slice(0, 10)]).toContain(restamped.source.reviewedAt);
  expect(restamped).toEqual({
    ...original,
    source: {
      ...original.source,
      digest: restamped.source.digest,
      reviewedAt: restamped.source.reviewedAt,
    },
  });
  expect(await staleStacks(f, [mobile.id, second.id])).toEqual([]);
}, 30_000);
