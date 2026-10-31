import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import {
  canonicalBundle,
  type IndexEntry,
  SearchIndex,
  SearchMetadata,
} from "@steamfield/stacks-format";
import { Effect, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { EXAMPLE_CARDS, PROMPT_VERSION } from "../scripts/decorate/prompt";
import { indexSearch } from "../scripts/index/search";
import { decodeSidecar } from "../src/core/search/sidecar";
import { quiet, runCli } from "./helpers/cli";
import { copyEntry, emptyRegistry, minimal, writeEntry } from "./helpers/registry";
import {
  card,
  cardPath,
  copyVocabulary,
  type DecorateWorkspace,
  decorate,
  decorateWorkspace,
  openRouter,
  put,
  readJson,
  searchFindings,
  seed,
  sourceDigest,
  stamp,
  validateSearch,
} from "./helpers/search-metadata";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

test("editorial descriptions and project ideas do not change lexical ranking", async () => {
  const { fixtureRecord, loadRank, vocabulary } = await import("./helpers/search-command");
  const rank = await loadRank();
  const record = await fixtureRecord(space.dir(), "editorial-only");
  if (!record.search) throw new Error("fixture needs search metadata");
  const options = { request: "quartz workbench", vocabulary: vocabulary(), entries: [record] };
  const enriched = {
    ...record,
    search: {
      ...record.search,
      description: "Quartz workbench. ".repeat(10),
      seoDescription: "Build a quartz workbench.",
      projectExamples: [
        { title: "Quartz workbench", description: "An illustrative quartz workbench." },
      ],
    },
  };
  expect(rank({ ...options, entries: [enriched] })).toEqual(rank(options));
});

const stack = { kind: "stack", id: "sample" } as const;
const fragment = { kind: "fragment", id: "tools" } as const;
const example = {
  title: "Archive inspector",
  description: "An illustrative utility for inspecting local archives.",
};
const editorial = {
  description:
    "Build a command with structured output and configuration overrides for local automation.",
  seoDescription: "Build a configurable command for local automation with structured output.",
  projectExamples: [example],
  plain: {
    whatItIs: "A starter for a command line utility.",
    goodAt: ["Automating repeated local tasks"],
    notGoodAt: ["Hosting a public website"],
  },
};
const decode = (value: unknown) =>
  Effect.runPromise(decodeSidecar(new TextEncoder().encode(JSON.stringify(value))));
const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

async function setup() {
  const home = space.dir();
  const root = join(home, "registry");
  seed(root, stack);
  const value = await stamp(root, stack);
  // These fixtures are self-contained; only the canonical vocabulary comes from bundled data.
  return { home, root, value, registry: emptyRegistry };
}

test.each([stack, fragment])(
  "legacy $kind cards decode unchanged and rich fields roundtrip [4.5b#21]",
  async (ref) => {
    const legacy = card(ref);
    expect(await decode(legacy)).toEqual(legacy);
    const rich = {
      ...legacy,
      ...editorial,
      projectExamples: [{ ...example, stack: stack.id, withFragments: ["extra"] }],
    };
    const decoded = await decode(rich);
    expect(decoded).toEqual(rich);
    expect(Schema.encodeSync(SearchMetadata)(decoded)).toEqual(rich);
    expect(
      Schema.decodeUnknownSync(SearchIndex)(
        {
          formatVersion: 1,
          entries: [rich],
          vocabulary: {
            schemaVersion: 1,
            platforms: {},
            productKinds: {},
            languages: {},
            capabilities: {},
          },
        },
        { onExcessProperty: "error" },
      ).entries,
    ).toEqual([rich]);
  },
);

test.each([
  { description: " \n\t" },
  { seoDescription: " " },
  { projectExamples: [{ ...example, title: " " }] },
  { projectExamples: [{ ...example, description: "\n" }] },
  { projectExamples: [{ ...example, extra: "unknown" }] },
  { projectExamples: [{ title: "Missing description" }] },
  { projectExamples: [{ ...example, stack: "Bad Host" }] },
  { projectExamples: [{ ...example, withFragments: ["bad_id"] }] },
  { projectExamples: [{ ...example, withFragments: ["tools", "tools"] }] },
  { projectExamples: "invalid" },
])("invalid editorial structure is a search-invalid error: %j [4.5b#21]", async (change) => {
  const f = await setup();
  expect(await decode({ ...f.value, ...editorial })).toEqual({ ...f.value, ...editorial });
  put(cardPath(f.root, stack), JSON.stringify({ ...f.value, ...change }));
  const findings = searchFindings(await validateSearch(f.root, f));
  expect(findings).toEqual([
    expect.objectContaining({ check: "search-invalid", severity: "error" }),
  ]);
});

test.each([
  { change: { description: words(121) }, message: "description: at most 120 words" },
  {
    change: { seoDescription: "🧰".repeat(161) },
    message: "seoDescription: at most 160 Unicode code points",
  },
  { change: { projectExamples: [] }, message: "projectExamples: 1 to 3 items" },
  {
    change: { projectExamples: Array.from({ length: 4 }, () => example) },
    message: "projectExamples: 1 to 3 items",
  },
  {
    change: { projectExamples: [{ ...example, title: words(9) }] },
    message: "projectExamples[1].title: at most 8 words",
  },
  {
    change: { projectExamples: [{ ...example, description: words(36) }] },
    message: "projectExamples[1].description: at most 35 words",
  },
  {
    change: { projectExamples: [{ ...example, withFragments: ["one", "two", "three", "four"] }] },
    message: "projectExamples[1].withFragments: at most 3 items",
  },
])("editorial caps warn without rejecting: $message [4.5b#21]", async ({ change, message }) => {
  const f = await setup();
  for (const id of ["one", "two", "three", "four"]) {
    seed(f.root, { kind: "fragment", id });
    await stamp(f.root, { kind: "fragment", id });
  }
  const rich = { ...f.value, ...editorial, ...change };
  expect(await decode(rich)).toEqual(rich);
  put(cardPath(f.root, stack), JSON.stringify(rich));
  expect(searchFindings(await validateSearch(f.root, f))).toEqual([
    expect.objectContaining({ check: "search-size", severity: "warning", message }),
  ]);
});

test("editorial budgets are independent of the legacy text budget and count Unicode code points [4.5b#21]", async () => {
  const f = await setup();
  put(
    cardPath(f.root, stack),
    JSON.stringify({
      ...f.value,
      ...editorial,
      description: words(120),
      seoDescription: "🧰".repeat(160),
      projectExamples: Array.from({ length: 3 }, () => ({
        title: words(8),
        description: words(35),
      })),
    }),
  );
  expect(searchFindings(await validateSearch(f.root, f))).toEqual([]);
});

async function selectionFixture() {
  const f = await setup();
  const stackFile = join(f.root, "stacks/sample/STACK.md");
  put(
    stackFile,
    readFileSync(stackFile, "utf8").replace(
      "tags: [scripts]",
      "tags: [scripts]\nfragments:\n  optional: [extra, first-app, second-app]",
    ),
  );
  await stamp(f.root, stack);
  for (const [id, extra] of [
    ["tools", "applies_to: [scripts]"],
    ["extra", "applies_to: [sample]"],
    ["misfit", "applies_to: [other]"],
    ["broken-dependency", "requires: [absent]"],
    ["conflict", "conflicts: [tools]"],
  ]) {
    if (id === undefined) throw new Error("Missing fixture id");
    writeEntry({
      root: f.root,
      kind: "fragment",
      dir: id,
      frontmatter: minimal("fragment", id, extra),
    });
    await stamp(f.root, { kind: "fragment", id });
  }
  for (const id of ["first-app", "second-app"]) {
    writeEntry({
      root: f.root,
      kind: "fragment",
      dir: id,
      frontmatter: minimal("fragment", id).replace(
        "category: tooling",
        "category: app\napplies_to: [scripts]",
      ),
    });
    await stamp(f.root, { kind: "fragment", id });
  }
  return f;
}

test.each([
  { ref: stack, selector: {}, bad: undefined },
  {
    ref: stack,
    selector: { stack: "sample", withFragments: ["extra", "first-app"] },
    bad: undefined,
  },
  {
    ref: fragment,
    selector: { stack: "sample", withFragments: ["extra", "first-app"] },
    bad: undefined,
  },
  { ref: fragment, selector: {}, bad: "stack" },
  { ref: stack, selector: { stack: "another" }, bad: "another" },
  { ref: fragment, selector: { stack: "absent" }, bad: "absent" },
  { ref: fragment, selector: { stack: "extra" }, bad: "extra" },
  { ref: fragment, selector: { stack: "sample", withFragments: ["absent"] }, bad: "absent" },
  { ref: stack, selector: { withFragments: ["sample"] }, bad: "sample" },
  { ref: fragment, selector: { stack: "sample", withFragments: ["misfit"] }, bad: "misfit" },
  {
    ref: { kind: "fragment", id: "misfit" } as const,
    selector: { stack: "sample" },
    bad: "misfit",
  },
  {
    ref: fragment,
    selector: { stack: "sample", withFragments: ["broken-dependency"] },
    bad: "absent",
  },
  { ref: fragment, selector: { stack: "sample", withFragments: ["conflict"] }, bad: "conflict" },
  {
    ref: fragment,
    selector: { stack: "sample", withFragments: ["first-app", "second-app"] },
    bad: "app_count",
  },
])(
  "example selectors use real composition: $ref.kind $selector [4.5b#21]",
  async ({ ref, selector, bad }) => {
    const f = await selectionFixture();
    const value = await stamp(f.root, ref);
    put(
      cardPath(f.root, ref),
      JSON.stringify({ ...value, ...editorial, projectExamples: [{ ...example, ...selector }] }),
    );
    const findings = searchFindings(await validateSearch(f.root, f));
    if (bad === undefined) expect(findings).toEqual([]);
    else {
      expect(findings).toEqual([
        expect.objectContaining({ check: "search-invalid", severity: "error", entry: ref.id }),
      ]);
      expect(findings[0]?.message).toContain("projectExamples[1]");
      expect(findings[0]?.message).toContain(bad);
    }
  },
);

test("an invalid example host reports the example position and reference [4.5b#21]", async () => {
  const f = await selectionFixture();
  put(join(f.root, "stacks/broken/STACK.md"), "---\nschema_version: 99\n---\n");
  const value = await stamp(f.root, fragment);
  put(
    cardPath(f.root, fragment),
    JSON.stringify({ ...value, ...editorial, projectExamples: [{ ...example, stack: "broken" }] }),
  );
  expect(searchFindings(await validateSearch(f.root, f))).toEqual([
    expect.objectContaining({
      check: "search-invalid",
      severity: "error",
      message: expect.stringMatching(/projectExamples\[1\].*broken.*invalid/),
    }),
  ]);
});

test("examples preserve default selections and reject a second app alongside the default app [4.5b#21]", async () => {
  const f = await selectionFixture();
  const file = join(f.root, "stacks/sample/STACK.md");
  put(
    file,
    readFileSync(file, "utf8").replace(
      "fragments:\n",
      "fragments:\n  default: [tools, first-app]\n",
    ),
  );
  const value = await stamp(f.root, stack);
  put(cardPath(f.root, stack), JSON.stringify({ ...value, ...editorial }));
  expect(searchFindings(await validateSearch(f.root, f))).toEqual([]);
  put(
    cardPath(f.root, stack),
    JSON.stringify({
      ...value,
      ...editorial,
      projectExamples: [{ ...example, withFragments: ["second-app"] }],
    }),
  );
  expect(searchFindings(await validateSearch(f.root, f))).toEqual([
    expect.objectContaining({
      check: "search-invalid",
      severity: "error",
      message: expect.stringMatching(/projectExamples\[1\].*app_count.*first-app, second-app/),
    }),
  ]);
});

test("editorial selectors accept metadata-compatible entries whose source files collide [4.5b#21]", async () => {
  const f = await setup();
  const fixtures = join(import.meta.dirname, "fixtures/registry-add");
  for (const id of ["park-a", "park-b"]) {
    copyEntry(fixtures, f.root, "fragments", id);
    await stamp(f.root, { kind: "fragment", id });
  }
  const file = join(f.root, "stacks/sample/STACK.md");
  put(
    file,
    readFileSync(file, "utf8").replace(
      "tags: [scripts]",
      "tags: [scripts]\nfragments:\n  default: [park-a]\n  optional: [park-b]",
    ),
  );
  const value = await stamp(f.root, stack);
  put(
    cardPath(f.root, stack),
    JSON.stringify({
      ...value,
      ...editorial,
      projectExamples: [{ ...example, withFragments: ["park-b"] }],
    }),
  );
  const report = await validateSearch(f.root, f);
  expect(searchFindings(report)).toEqual([]);
  expect(report.findings).toContainEqual(
    expect.objectContaining({
      check: "compose",
      severity: "error",
      message: expect.stringMatching(/file_owner.*park-a, park-b/),
    }),
  );
});

test.each(["legacy", "enriched"])(
  "index assembly preserves %s cards and recalculates stale against the selected bundle [4.5b#21]",
  async (shape) => {
    const f = await setup();
    copyVocabulary(f.root);
    const rich = shape === "legacy" ? f.value : { ...f.value, ...editorial };
    put(cardPath(f.root, stack), JSON.stringify(rich));
    const ref: IndexEntry = {
      ...stack,
      schemaVersion: 1,
      name: "Sample",
      description: "Sample",
      tags: [],
      digest: `sha256:${"a".repeat(64)}`,
      composition: {},
    };
    const file = readFileSync(join(f.root, "stacks/sample/STACK.md"), "utf8");
    const publish = (content: string, previous: SearchIndex | null = null) =>
      Effect.runPromise(
        indexSearch({
          root: f.root,
          entries: [ref],
          previous,
          bundles: new Map([
            [
              `v1/entries/stack/sample/${ref.digest}.json`,
              canonicalBundle({
                ...stack,
                files: [{ path: "STACK.md", encoding: "utf8", executable: false, content }],
              }),
            ],
          ]),
        }).pipe(Effect.provide(NodeServices.layer)),
      );
    const current = await publish(file);
    expect(current.entries).toEqual([rich]);
    const stale = await publish(`${file}\nOlder bundle guidance.\n`);
    expect(stale.entries).toEqual([{ ...rich, stale: true }]);
    rmSync(cardPath(f.root, stack));
    expect((await publish(file, stale)).entries).toEqual([rich]);
  },
);

test.each([
  ["missing", null],
  ["malformed", '{"schemaVersion":1}'],
])("index assembly rejects a %s vocabulary with its path [4.5e#13]", async (_state, contents) => {
  const root = space.dir();
  if (contents !== null) put(join(root, "search/vocabulary.json"), contents);
  await expect(
    Effect.runPromise(
      indexSearch({ root, entries: [], bundles: new Map(), previous: null }).pipe(
        Effect.provide(NodeServices.layer),
      ),
    ),
  ).rejects.toThrow("search/vocabulary.json");
});

test.each(["legacy", "enriched"])(
  "create copies %s bytes and preserves source and stale semantics [4.5b#21]",
  async (shape) => {
    const f = await setup();
    const rich = shape === "legacy" ? f.value : { ...f.value, ...editorial };
    const bytes = `${JSON.stringify(rich, null, 2)}\n`;
    put(cardPath(f.root, stack), bytes);
    const result = await runCli(["create", "stack", stack.id, "--from", "bundled", "--json"], {
      home: f.home,
      env: quiet,
      host: { registry: f.root },
    });
    expect(result.status, result.stderr).toBe(0);
    const copied = join(f.home, "config/stacks");
    expect(readFileSync(cardPath(copied, stack), "utf8")).toBe(bytes);
    expect(searchFindings(await validateSearch(copied, f))).toEqual([]);
    const file = join(copied, "stacks/sample/STACK.md");
    put(file, `${readFileSync(file, "utf8")}\nChanged guidance.\n`);
    expect(searchFindings(await validateSearch(copied, f))).toEqual([
      expect.objectContaining({ check: "search-stale", severity: "warning" }),
    ]);
    expect(readJson(cardPath(copied, stack))).toEqual(rich);
  },
);

function newDraftFixture() {
  const f = decorateWorkspace(space.dir());
  seed(f.registry, stack);
  return f;
}

function requestPrompt(body: unknown) {
  const request = Schema.decodeUnknownSync(
    Schema.Struct({ messages: Schema.Array(Schema.Struct({ content: Schema.String })) }),
  )(body);
  return request.messages[0]?.content ?? "";
}

async function expectCompleteDraft(f: DecorateWorkspace, complete: unknown) {
  const decoded = await decode(complete);
  expect(readJson(cardPath(f.registry, stack))).toEqual({
    ...decoded,
    source: {
      digest: await sourceDigest(f.registry, stack),
      by: "drafted",
      model: "codex/gpt-6.1-sol",
      promptVersion: 3,
      reviewedAt: null,
    },
  });
}

const draftCredential = "draft-test-credential";
const completeReply = { ...card(stack), ...editorial, summary: "Corrected complete draft." };
const omitted = (fields: ReadonlyArray<string>) =>
  Object.fromEntries(Object.entries(completeReply).filter(([key]) => !fields.includes(key)));

test.each([
  { label: "missing description", reply: omitted(["description"]), fields: ["description"] },
  { label: "missing SEO", reply: omitted(["seoDescription"]), fields: ["seoDescription"] },
  { label: "missing examples", reply: omitted(["projectExamples"]), fields: ["projectExamples"] },
  {
    label: "legacy-shaped response",
    reply: card(stack),
    fields: ["description", "seoDescription", "projectExamples", "plain"],
  },
  {
    label: "blank description",
    reply: { ...completeReply, description: " \n\t" },
    fields: ["description"],
  },
  {
    label: "blank SEO",
    reply: { ...completeReply, seoDescription: " " },
    fields: ["seoDescription"],
  },
  {
    label: "blank example title",
    reply: { ...completeReply, projectExamples: [{ ...example, title: " " }] },
    fields: ["projectExamples"],
  },
  {
    label: "blank example description",
    reply: { ...completeReply, projectExamples: [{ ...example, description: "\n" }] },
    fields: ["projectExamples"],
  },
  {
    label: "empty example object",
    reply: { ...completeReply, projectExamples: [{}] },
    fields: ["projectExamples"],
  },
  {
    label: "empty examples",
    reply: { ...completeReply, projectExamples: [] },
    fields: ["projectExamples"],
  },
])("new drafts correct $label before writing [4.5b#22]", async ({ reply, fields }) => {
  const f = newDraftFixture();
  const server = await openRouter([
    { content: JSON.stringify(reply), cost: 0.002 },
    { content: JSON.stringify(completeReply), cost: 0.003 },
  ]);
  try {
    const result = await decorate(f, [stack.id, "--model", "codex/gpt-6.1-sol"], {
      env: { OPENROUTER_BASE_URL: server.url, OPENROUTER_API_KEY: draftCredential },
    });
    expect(result.status, result.stderr).toBe(0);
    await expectCompleteDraft(f, completeReply);
    expect(server.requests).toHaveLength(2);
    const initial = requestPrompt(server.requests[0]?.body);
    const retry = requestPrompt(server.requests[1]?.body);
    expect(retry.startsWith(initial)).toBe(true);
    const diagnostic = retry.slice(initial.length);
    for (const field of fields) expect(diagnostic).toContain(field);
    expect(diagnostic).not.toContain(draftCredential);
    expect(result.stdout).toContain("Total: $0.005000.");
    expect(result.stdout.match(/Drafted stack\/sample;/g)).toHaveLength(1);
  } finally {
    await server.close();
  }
});

test.each([false, true])(
  "two invalid new replies preserve existing card=%s and stop after one correction [4.5b#22]",
  async (existing) => {
    const f = newDraftFixture();
    const target = cardPath(f.registry, stack);
    const before = existing
      ? `${JSON.stringify(await stamp(f.registry, stack), null, 4)}\n`
      : undefined;
    if (before !== undefined) put(target, before);
    const content = JSON.stringify(card(stack));
    const server = await openRouter([
      { content, cost: 0.002 },
      { content, cost: 0.003 },
    ]);
    try {
      const result = await decorate(f, [stack.id], {
        env: { OPENROUTER_BASE_URL: server.url, OPENROUTER_API_KEY: draftCredential },
      });
      expect(result.status, result.stderr).toBe(0);
      if (before === undefined) expect(existsSync(target)).toBe(false);
      else expect(readFileSync(target, "utf8")).toBe(before);
      expect(server.requests).toHaveLength(2);
      expect(result.stdout).toContain("invalid JSON/schema after one correction retry");
      expect(result.stdout).toContain("Total: $0.005000.");
      expect(result.stdout).not.toContain("Drafted stack/sample;");
    } finally {
      await server.close();
    }
  },
);

test.each(["malformed JSON", "unknown property"])(
  "new draft %s correction diagnostics never echo provider content [4.5b#22]",
  async (kind) => {
    const f = newDraftFixture();
    const privateContent = `provider-private-content-${draftCredential}`;
    const content =
      kind === "malformed JSON"
        ? `{"${privateContent}`
        : JSON.stringify({ ...completeReply, [privateContent]: "private value" });
    const server = await openRouter([{ content }, { content: JSON.stringify(completeReply) }]);
    try {
      const result = await decorate(f, [stack.id, "--model", "codex/gpt-6.1-sol"], {
        env: { OPENROUTER_BASE_URL: server.url, OPENROUTER_API_KEY: draftCredential },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(server.requests).toHaveLength(2);
      const initial = requestPrompt(server.requests[0]?.body);
      const diagnostic = requestPrompt(server.requests[1]?.body).slice(initial.length);
      expect(diagnostic).toMatch(/JSON\/schema/);
      expect(diagnostic).not.toContain("provider-private-content");
      expect(diagnostic).not.toContain(draftCredential);
      expect(result.stdout + result.stderr).not.toContain("provider-private-content");
      expect(result.stdout + result.stderr).not.toContain(draftCredential);
      await expectCompleteDraft(f, completeReply);
    } finally {
      await server.close();
    }
  },
);

test("prompt v3 supplies recipe references and honest editorial instructions through the draft boundary [4.5b#22]", async () => {
  expect(PROMPT_VERSION).toBe(3);
  for (const value of EXAMPLE_CARDS) {
    expect(await decode(value)).toMatchObject({
      description: expect.any(String),
      seoDescription: expect.any(String),
      projectExamples: expect.any(Array),
    });
  }
  const f = decorateWorkspace(space.dir());
  const value = { ...card(stack), ...editorial };
  seed(f.registry, stack);
  writeEntry({
    root: f.registry,
    kind: "fragment",
    dir: "example-only",
    frontmatter: minimal(
      "fragment",
      "example-only",
      "applies_to: [sample]\nrequires: [git-hooks]\nconflicts: [rr]",
    ),
  });
  const server = await openRouter([{ content: JSON.stringify(value) }]);
  try {
    const result = await decorate(f, [stack.id, "--model", "codex/gpt-6.1-sol"], {
      env: { OPENROUTER_BASE_URL: server.url, OPENROUTER_API_KEY: "fixture-only" },
    });
    expect(result.status, result.stderr).toBe(0);
    const request = Schema.decodeUnknownSync(
      Schema.Struct({ messages: Schema.Array(Schema.Struct({ content: Schema.String })) }),
    )(server.requests[0]?.body);
    const prompt = request.messages[0]?.content ?? "";
    const referenceLine =
      prompt
        .split("Allowed recipe references (identity and compatibility only):\n")[1]
        ?.split("\n")[0] ?? "";
    const references = Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({
          stacks: Schema.Array(
            Schema.Struct({
              id: Schema.String,
              tags: Schema.Array(Schema.String),
              fragments: Schema.Unknown,
            }),
          ),
          fragments: Schema.Array(
            Schema.Struct({
              id: Schema.String,
              category: Schema.String,
              appliesTo: Schema.Array(Schema.String),
              requires: Schema.Array(Schema.String),
              conflicts: Schema.Array(Schema.String),
            }),
          ),
        }),
      ),
    )(referenceLine, { onExcessProperty: "error" });
    expect(references.stacks.find(({ id }) => id === stack.id)).toEqual({
      id: stack.id,
      tags: ["scripts"],
      fragments: { required: [], default: [], optional: [] },
    });
    expect(references.fragments.find(({ id }) => id === "example-only")).toEqual({
      id: "example-only",
      category: "tooling",
      appliesTo: ["sample"],
      requires: ["git-hooks"],
      conflicts: ["rr"],
    });
    for (const phrase of [
      "description",
      "120 words",
      "seoDescription",
      "160 Unicode code points",
      "display only",
      "description, seoDescription, projectExamples and plain are display only, unscored and unembedded",
      "material platform and operating limits",
      "memory-only history",
      "URL-based access",
      "signing",
      "Entry frontmatter description",
      "sidecar display description",
      "guidance and starter files",
      "finished product",
      "projectExamples",
      "illustrative",
      "withFragments",
      "fragment",
      "host stack",
      "150 words",
      "compliance",
      "readiness",
      "timing",
      "domain",
      "appliesTo",
      "required",
      "conflicts",
      "go-cli",
    ])
      expect(prompt).toContain(phrase);
    expect(readJson(cardPath(f.registry, stack))).toEqual({
      ...value,
      source: {
        digest: expect.stringMatching(/^sha256:/),
        by: "drafted",
        model: "codex/gpt-6.1-sol",
        promptVersion: 3,
        reviewedAt: null,
      },
    });
  } finally {
    await server.close();
  }
});
