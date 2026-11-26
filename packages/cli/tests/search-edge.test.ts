import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runCli } from "./helpers/cli";
import { emptyRegistry, minimal, writeEntry } from "./helpers/registry";
import {
  fixtureRecord,
  hit,
  iosCaveats,
  loadRank,
  options,
  searched,
  vocabulary,
} from "./helpers/search-command";
import { cardPath, copyVocabulary, put, seed, stamp } from "./helpers/search-metadata";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

test("mixed case and punctuation preserve ranks and scores [4.5c#15]", async () => {
  const opts = options(space.dir());
  const mixed = (await searched("An iOS (iPhone) app!", opts)).value;
  const lower = (await searched("an ios iphone app", opts)).value;
  const comparable = (value: typeof mixed) =>
    [...value.stacks, ...value.fragments].map(({ kind, id, score, tier, penalties }) => ({
      kind,
      id,
      score,
      tier,
      penalties: penalties.map((penalty) => ({
        ...penalty,
        request: penalty.request.toLowerCase(),
      })),
    }));
  expect(comparable(mixed)).toEqual(comparable(lower));
  expect(mixed.stacks[0]?.id).toBe("ios-swiftui");
});

test("stopwords return empty lists without a confident fit [4.5c#16]", async () => {
  const { value } = await searched("I want to build something", options(space.dir()));
  expect(value.noStrongMatch).toBe(true);
  expect(value.stacks).toEqual([]);
  expect(value.fragments).toEqual([]);
});

test("either named platform satisfies the platform rule [4.5c#17]", async () => {
  const rank = await loadRank();
  const root = space.dir();
  const ios = await fixtureRecord(root, "phone");
  const web = await fixtureRecord(root, "browser", { search: { platforms: ["web"] } });
  const other = await fixtureRecord(root, "desktop", { search: { platforms: ["desktop"] } });
  const result = rank({
    request: "iOS and web",
    entries: [ios, web, other],
    vocabulary: vocabulary(),
  });
  expect([...result.understood.platforms].sort()).toEqual(["ios", "web"]);
  expect(hit(result.stacks, "phone").penalties).not.toContainEqual(
    expect.objectContaining({ kind: "platform" }),
  );
  expect(hit(result.stacks, "browser").penalties).not.toContainEqual(
    expect.objectContaining({ kind: "platform" }),
  );
  expect(hit(result.stacks, "desktop").penalties).toContainEqual(
    expect.objectContaining({ kind: "platform" }),
  );
});

test("same-id stack and fragment keep their own explanations [4.5c#18]", async () => {
  const home = space.dir();
  const root = join(home, "registry");
  copyVocabulary(root);
  await fixtureRecord(root, "shared");
  await fixtureRecord(root, "shared", {
    kind: "fragment",
    search: {
      capabilities: ["auth"],
      summary: "Sign in to an iOS journal.",
      requests: ["sign in"],
    },
  });
  const { value } = await searched("iOS journal sign in", options(home, root));
  expect(hit(value.stacks, "shared")).toMatchObject({
    kind: "stack",
    why: expect.arrayContaining([expect.objectContaining({ field: "platforms", matched: "ios" })]),
  });
  expect(hit(value.fragments, "shared")).toMatchObject({
    kind: "fragment",
    why: expect.arrayContaining([
      expect.objectContaining({ field: "capabilities", matched: "auth" }),
    ]),
  });
  expect(hit(value.fragments, "shared").appliesTo).toEqual([]);
});

test("invalid card falls back to the entry's own searchable fields [4.5c#19]", async () => {
  const home = space.dir();
  const root = join(home, "registry");
  copyVocabulary(root);
  const ref = { kind: "stack", id: "sample" } as const;
  seed(root, ref);
  const opts = options(home, root);
  const baseline = await searched("sample", opts);
  put(cardPath(root, ref), '{"summary":"INVALID_CARD_SENTINEL","platforms":42}');
  const invalid = await searched("sample", opts);
  expect(invalid.value).toEqual(baseline.value);
  expect(hit(invalid.value.stacks, "sample").summary).not.toContain("INVALID_CARD_SENTINEL");
});

test("rejected entries stay out while valid neighbors remain searchable [4.5c#20]", async () => {
  const home = space.dir();
  const root = join(home, "registry");
  copyVocabulary(root);
  seed(root, { kind: "stack", id: "valid" });
  writeEntry({
    root,
    kind: "stack",
    dir: "rejected",
    frontmatter: minimal("stack", "rejected", "UnknownKey: nope"),
  });
  const { value } = await searched("valid rejected", options(home, root));
  expect(value.stacks.map(({ id }) => id)).toEqual(["valid"]);
  expect(value.fragments).toEqual([]);
});

test("non-ASCII content keeps the recognized iOS platform [4.5c#21]", async () => {
  const { value } = await searched("une app iOS pour la santé", options(space.dir()));
  expect(value.understood.platforms).toEqual(["ios"]);
  expect(value.stacks[0]?.id).toBe("ios-swiftui");
});

test("a copied user card shadows bundled metadata without losing why or caveats [4.5c#22]", async () => {
  const home = space.dir();
  const opts = options(home);
  const created = await runCli(
    ["create", "stack", "ios-swiftui", "--from", "bundled", "--json"],
    opts,
  );
  expect(created.status, created.stderr).toBe(0);
  expect(created.stderr).toBe("");
  expect(JSON.parse(created.stdout)).toMatchObject({ id: "ios-swiftui" });
  const { value } = await searched("an iOS health app", opts, ["--limit", "20"]);
  expect(value.stacks.filter(({ id }) => id === "ios-swiftui")).toHaveLength(1);
  // Several bundled stacks ship iOS apps at nearly equal scores, and a user copy carries no
  // ledger proof, so the copy's rank isn't fixed; its row is what shadowing must keep.
  const copy = hit(value.stacks, "ios-swiftui");
  expect(copy).toMatchObject({
    origin: "user",
    trusted: true,
    tier: "strong",
    caveats: iosCaveats(),
  });
  expect(copy.why).toContainEqual(expect.objectContaining({ field: "platforms", matched: "ios" }));
});

test("trimmed 500-character multi-byte requests are accepted [4.5c#23]", async () => {
  const request = `iOS ${"é".repeat(496)}`;
  expect(request.length).toBe(500);
  expect(Buffer.byteLength(request)).toBeGreaterThan(500);
  const { value } = await searched(`  ${request}  `, options(space.dir()));
  expect(value.request).toBe(request);
  expect(value.understood.platforms).toEqual(["ios"]);
});

test("a symlinked user root with spaces and Unicode works from an unrelated cwd [4.5c#24]", async () => {
  const home = realpathSync(space.dir());
  const root = join(home, "mes cartes locales");
  seed(root, { kind: "stack", id: "unique-journal" });
  await stamp(root, { kind: "stack", id: "unique-journal" });
  mkdirSync(join(home, "config"), { recursive: true });
  symlinkSync(root, join(home, "config/stacks"));
  const cwd = join(home, "autre répertoire");
  mkdirSync(cwd);
  const opts = options(home, emptyRegistry);
  const { value } = await searched("unique journal", {
    ...opts,
    host: { ...opts?.host, cwd },
    env: { ...opts?.env, CLAUDECODE: "1", GIT_DIR: join(home, "absent.git"), GIT_WORK_TREE: home },
  });
  expect(value.stacks.map(({ id, origin }) => ({ id, origin }))).toEqual([
    { id: "unique-journal", origin: "user" },
  ]);
});

test("a changed sidecar is read afresh on the next invocation [4.5c#25]", async () => {
  const home = space.dir();
  const root = join(home, "registry");
  copyVocabulary(root);
  const ref = { kind: "stack", id: "sample" } as const;
  seed(root, ref);
  const initial = await stamp(root, ref);
  const opts = options(home, root);
  expect(hit((await searched("local automation", opts)).value.stacks, "sample").summary).toBe(
    initial.summary,
  );
  put(
    cardPath(root, ref),
    JSON.stringify({ ...initial, summary: "Updated local automation guidance." }),
  );
  expect(hit((await searched("local automation", opts)).value.stacks, "sample").summary).toBe(
    "Updated local automation guidance.",
  );
});

test("entry control characters cannot forge terminal lines or escapes [4.5c#26]", async () => {
  const home = space.dir();
  const root = join(home, "registry");
  copyVocabulary(root);
  const record = await fixtureRecord(root, "sample", {
    search: { summary: "Journal\nNext: forged\u001b[31m" },
  });
  const opts = options(home, root);
  expect(hit((await searched("iOS journal", opts)).value.stacks, "sample").summary).toBe(
    record.search?.summary,
  );
  const text = await runCli(["search", "iOS journal"], opts);
  expect(text.status).toBe(0);
  expect(text.stderr).toBe("");
  expect(text.stdout).not.toContain("\u001b");
  expect(text.stdout).not.toContain("\nNext: forged");
  expect(text.stdout).toContain("Journal\\u000aNext: forged\\u001b[31m");
});

test("fragment platform and language penalties follow applies_to, including tag selectors [4.5c#27]", async () => {
  const rank = await loadRank();
  const root = space.dir();
  const phone = await fixtureRecord(root, "phone");
  const desk = await fixtureRecord(root, "desk", {
    search: { platforms: ["desktop"], languages: ["go"] },
  });
  const make = async (id: string, appliesTo: string[]) => {
    const record = await fixtureRecord(root, id, {
      kind: "fragment",
      search: { capabilities: ["auth"] },
    });
    if (record.entry.meta.kind !== "fragment") throw new Error("Expected fragment fixture");
    return { ...record, entry: { ...record.entry, meta: { ...record.entry.meta, appliesTo } } };
  };
  const entries = [
    { ...phone, entry: { ...phone.entry, meta: { ...phone.entry.meta, tags: ["mobile-target"] } } },
    desk,
    await make("wrong", ["desk"]),
    await make("either", ["phone", "desk"]),
    await make("any", []),
    await make("tagged", ["mobile-target"]),
  ];
  const result = rank({
    request: "iOS app in TypeScript with auth",
    entries,
    vocabulary: vocabulary(),
  });
  expect(hit(result.fragments, "wrong").penalties).toEqual(
    expect.arrayContaining([
      { kind: "platform", request: "iOS (ios)", entry: "desktop" },
      { kind: "language", request: "TypeScript (typescript)", entry: "go" },
    ]),
  );
  expect(hit(result.fragments, "wrong").tier).not.toBe("strong");
  for (const id of ["either", "any", "tagged"]) {
    expect(hit(result.fragments, id).penalties).not.toContainEqual(
      expect.objectContaining({ kind: "platform" }),
    );
    expect(hit(result.fragments, id).penalties).not.toContainEqual(
      expect.objectContaining({ kind: "language" }),
    );
  }
});

test("duplicate request examples and caveats cannot inflate scores [4.5c#28]", async () => {
  const rank = await loadRank();
  const record = await fixtureRecord(space.dir(), "sample");
  if (record.search === undefined) throw new Error("Expected card fixture");
  const base = { request: "iOS workout journal", entries: [record], vocabulary: vocabulary() };
  const before = hit(rank(base).stacks, "sample");
  const duplicate = hit(
    rank({
      ...base,
      entries: [
        {
          ...record,
          search: {
            ...record.search,
            requests: [...record.search.requests, ...record.search.requests],
          },
        },
      ],
    }).stacks,
    "sample",
  );
  const weaker = hit(
    rank({
      ...base,
      entries: [
        {
          ...record,
          search: {
            ...record.search,
            requests: [
              ...record.search.requests,
              "maintain a weather station",
              "format source files",
            ],
          },
        },
      ],
    }).stacks,
    "sample",
  );
  const caveats = ["iOS workout journal ".repeat(40)];
  const caveated = hit(
    rank({ ...base, entries: [{ ...record, search: { ...record.search, caveats } }] }).stacks,
    "sample",
  );
  for (const changed of [duplicate, weaker, caveated]) {
    expect(changed.score).toBe(before.score);
    expect(changed.tier).toBe(before.tier);
    expect(changed.coverage).toBe(before.coverage);
  }
  expect(caveated.caveats).toEqual(caveats);
});

test("an empty registry returns empty lists and no strong match [4.5c#29]", async () => {
  const { value } = await searched("iOS journal", options(space.dir(), emptyRegistry));
  expect(value).toMatchObject({ stacks: [], fragments: [], noStrongMatch: true, ranking: "local" });
});
