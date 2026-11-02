import { readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import {
  bundleDigest,
  canonicalBundle,
  DependencyAllowlist,
  IndexEntry,
  SearchIndex,
  SearchMetadata,
} from "@steamfield/stacks-format";
import { Effect, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { goAllowlistKey } from "../src/core/deps";
import { ShowReport } from "../src/schemas/show";
import { ValidateReport } from "../src/schemas/validate";
import { rawBundle } from "./fixtures/index/harness";
import { quiet, runCli, terminal } from "./helpers/cli";
import { cardPath, copyVocabulary, put, readJson, seed, stamp } from "./helpers/search-metadata";
import { fingerprintFor, stack } from "./helpers/show-preview";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());
const ref = { kind: "stack", id: "sample" } as const;
const plain = {
  whatItIs: "A starting point for small command line tools.",
  goodAt: ["Automating repeated local work"],
  notGoodAt: ["Hosting public websites"],
};
const dependency = (
  whatItIs = "A small web framework.",
  reviewedAt: string | null = new Date().toISOString().slice(0, 10),
) => ({
  whatItIs,
  source: { by: "author", reviewedAt },
});
function setup(extra = "") {
  const home = realpathSync(space.dir());
  const root = join(home, "bundled fixture café");
  seed(root, ref);
  if (extra) stack(root, ref.id, extra);
  return { home, root };
}
async function sidecar(root: string, change: Record<string, unknown> = {}) {
  const card = await stamp(root, ref);
  put(cardPath(root, ref), JSON.stringify({ ...card, plain, ...change }));
  return { ...card, plain, ...change };
}
function allowlist(
  root: string,
  names: Partial<Record<"npm" | "pypi" | "go" | "crates", string[]>>,
) {
  put(
    join(root, "allowlist.json"),
    JSON.stringify({
      formatVersion: 1,
      generatedAt: "2026-10-28T00:00:00Z",
      names: { npm: [], pypi: [], go: [], crates: [], ...names },
    }),
  );
  copyVocabulary(root);
}
function cards(
  root: string,
  ecosystem: "npm" | "pypi" | "go" | "crates",
  values: Record<string, unknown>,
) {
  put(join(root, "deps", `${ecosystem}.json`), JSON.stringify({ formatVersion: 1, cards: values }));
}
async function validate(home: string, root: string, bundled = true) {
  const result = await runCli(["validate", ...(bundled ? [] : [root]), "--json"], {
    home,
    env: quiet,
    host: { registry: bundled ? root : join(home, "separate bundled") },
  });
  expect(result.stdout, result.stderr).not.toBe("");
  const report = Schema.decodeUnknownSync(ValidateReport)(JSON.parse(result.stdout));
  expect(result.status).toBe(
    report.findings.some((finding) => finding.severity === "error") ? 2 : 0,
  );
  if (result.status === 0) expect(result.stderr).toBe("");
  else {
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { tag: "ValidationFailed" } });
  }
  return report;
}
function selected(report: ValidateReport) {
  return report.findings.filter(
    ({ check }) =>
      check.startsWith("deps-") ||
      check === "plain-versioned" ||
      check === "search-invalid" ||
      check === "search-size",
  );
}
async function show(home: string, root: string, args: string[] = [], human = false) {
  const result = await runCli(["show", "sample", ...args], {
    home,
    env: quiet,
    host: { registry: root, ...(human ? terminal : {}) },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  return result.stdout;
}

test("plain survives create copy and index assembly byte for byte [4.5f#1]", async () => {
  const { home, root } = setup();
  const value = await sidecar(root);
  const copied = await runCli(["create", "stack", "sample", "--from", "bundled", "--json"], {
    home,
    env: quiet,
    host: { registry: root },
  });
  expect(copied.status, copied.stderr).toBe(0);
  expect(copied.stderr).toBe("");
  expect(readFileSync(cardPath(join(home, "config/stacks"), ref), "utf8")).toBe(
    readFileSync(cardPath(root, ref), "utf8"),
  );
  const { indexSearch } = await import("../scripts/index/search");
  const bundle = rawBundle(root, "stack", "sample");
  const digest = await Effect.runPromise(bundleDigest(bundle));
  const entry = Schema.decodeUnknownSync(IndexEntry)({
    kind: "stack",
    id: "sample",
    digest,
    name: "Sample",
    description: "A sample.",
    tags: [],
    schemaVersion: 1,
    composition: {},
  });
  copyVocabulary(root);
  const index = await Effect.runPromise(
    indexSearch({
      root,
      entries: [entry],
      bundles: new Map([[`v1/entries/stack/sample/${digest}.json`, canonicalBundle(bundle)]]),
      previous: null,
    }).pipe(Effect.provide(NodeServices.layer)),
  );
  expect(Schema.decodeUnknownSync(SearchIndex)(index).entries[0]?.plain).toEqual(value.plain);
});

test.each([
  { label: "empty goodAt", change: { goodAt: [] } },
  { label: "blank whatItIs", change: { whatItIs: " \n " } },
  { label: "extra key", change: { unexpected: true } },
])("invalid plain structure is search-invalid: $label [4.5f#2]", async ({ change }) => {
  const { home, root } = setup();
  const valid = await sidecar(root);
  expect(Schema.decodeUnknownSync(SearchMetadata)(valid).plain).toEqual(plain);
  await sidecar(root, { plain: { ...plain, ...change } });
  expect(
    selected(await validate(home, root)).map(({ check, severity }) => ({ check, severity })),
  ).toEqual([{ check: "search-invalid", severity: "error" }]);
});

test.each([
  {
    label: "31 word definition",
    change: { whatItIs: Array.from({ length: 31 }, () => "word").join(" ") },
    code: "search-size",
  },
  {
    label: "16 word benefit",
    change: { goodAt: [Array.from({ length: 16 }, () => "word").join(" ")] },
    code: "search-size",
  },
  {
    label: "four limits",
    change: { notGoodAt: ["one", "two", "three", "four"] },
    code: "search-size",
  },
  {
    label: "numeric version",
    change: { whatItIs: "Uses React 19.1 for views." },
    code: "plain-versioned",
  },
  { label: "x version", change: { goodAt: ["Works with v4.x projects"] }, code: "plain-versioned" },
  {
    label: "version in a limitation",
    change: { notGoodAt: ["Projects using React 19.1"] },
    code: "plain-versioned",
  },
])("plain limits report $code: $label [4.5f#3]", async ({ change, code }) => {
  const { home, root } = setup();
  await sidecar(root, { plain: { ...plain, ...change } });
  expect(
    selected(await validate(home, root)).map(({ check, severity }) => ({ check, severity })),
  ).toEqual([{ check: code, severity: "warning" }]);
});

test("long dependency examples use the existing size warning [4.5f#3]", async () => {
  const { home, root } = setup();
  await stamp(root, ref);
  allowlist(root, { npm: ["hono"] });
  cards(root, "npm", {
    hono: { ...dependency(), example: Array.from({ length: 41 }, () => "word").join(" ") },
  });
  expect(
    selected(await validate(home, root)).map(({ check, severity }) => ({ check, severity })),
  ).toEqual([{ check: "search-size", severity: "warning" }]);
});

test("editing plain leaves content digests and lexical ranking unchanged [4.5f#4]", async () => {
  const { root } = setup();
  const original = await sidecar(root);
  expect(Schema.decodeUnknownSync(SearchMetadata)(original).plain).toEqual(plain);
  const fingerprint = await fingerprintFor(root);
  const bundle = await Effect.runPromise(bundleDigest(rawBundle(root, "stack", "sample")));
  put(
    cardPath(root, ref),
    JSON.stringify({
      ...original,
      plain: { ...plain, whatItIs: "A different explanation containing nebula pulsar quasar." },
    }),
  );
  expect(await fingerprintFor(root)).toBe(fingerprint);
  expect(await Effect.runPromise(bundleDigest(rawBundle(root, "stack", "sample")))).toBe(bundle);
  const { fixtureRecord, loadRank, vocabulary } = await import("./helpers/search-command");
  const ranked = await loadRank();
  const record = await fixtureRecord(space.dir(), "plain-only");
  if (!record.search) throw new Error("Ranking fixture requires a sidecar");
  const input = { request: "nebula pulsar quasar", vocabulary: vocabulary(), entries: [record] };
  expect(
    ranked({ ...input, entries: [{ ...record, search: { ...record.search, plain } }] }),
  ).toEqual(ranked(input));
});

test("bad or unknown dependency cards are errors [4.5f#7]", async () => {
  const { home, root } = setup();
  await stamp(root, ref);
  allowlist(root, { npm: ["hono"] });
  cards(root, "npm", { unknown: dependency() });
  expect(
    selected(await validate(home, root)).map(({ check, severity }) => ({ check, severity })),
  ).toEqual([{ check: "deps-invalid", severity: "error" }]);
  put(join(root, "deps/npm.json"), "{ broken json");
  expect(
    selected(await validate(home, root)).map(({ check, severity }) => ({ check, severity })),
  ).toEqual([{ check: "deps-invalid", severity: "error" }]);
});

test("one dependency name in two ecosystems is ambiguous [4.5f#8]", async () => {
  const { home, root } = setup();
  await stamp(root, ref);
  allowlist(root, { npm: ["shared"], pypi: ["shared"] });
  expect(
    selected(await validate(home, root)).map(({ check, severity }) => ({ check, severity })),
  ).toEqual([{ check: "deps-ambiguous", severity: "error" }]);
});

test("a used bundled dependency needs a card and clears when one is added [4.5f#9]", async () => {
  const { home, root } = setup("deps:\n  app: [hono]");
  await stamp(root, ref);
  allowlist(root, { npm: ["hono"] });
  const missing = selected(await validate(home, root));
  expect(missing.map(({ check, severity }) => ({ check, severity }))).toEqual([
    { check: "deps-missing", severity: "warning" },
  ]);
  expect(missing[0]?.message).toContain("npm/hono");
  cards(root, "npm", { hono: dependency() });
  expect(selected(await validate(home, root))).toEqual([]);
});

test("Go import suffixes resolve to dependency cards by their allowlist key", async () => {
  const { home, root } = setup("deps:\n  app: [example.com/mod/v2]");
  await stamp(root, ref);
  allowlist(root, { go: ["example.com/mod"] });
  const missing = selected(await validate(home, root));
  expect(missing.map(({ check, severity, message }) => ({ check, severity, message }))).toEqual([
    {
      check: "deps-missing",
      severity: "warning",
      message: "go/example.com/mod has no dependency card.",
    },
  ]);
  cards(root, "go", { "example.com/mod": dependency() });
  expect(selected(await validate(home, root))).toEqual([]);
});

test("a non-Go dependency keeps its trailing version-like path", async () => {
  const { home, root } = setup("deps:\n  app: [example.com/mod/v2]");
  await stamp(root, ref);
  allowlist(root, { npm: ["example.com/mod/v2"], go: ["example.com/mod"] });
  cards(root, "npm", { "example.com/mod/v2": dependency() });
  expect(selected(await validate(home, root))).toEqual([]);
});

test("old reviews are notes and drafts are warnings [4.5f#10]", async () => {
  const { home, root } = setup();
  await stamp(root, ref);
  allowlist(root, { npm: ["hono"] });
  const old = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  cards(root, "npm", { hono: dependency("A web framework.", old) });
  expect(
    selected(await validate(home, root)).map(({ check, severity }) => ({ check, severity })),
  ).toEqual([{ check: "deps-review-due", severity: "note" }]);
  cards(root, "npm", { hono: dependency("A web framework.", null) });
  expect(
    selected(await validate(home, root)).map(({ check, severity }) => ({ check, severity })),
  ).toEqual([{ check: "deps-unreviewed", severity: "warning" }]);
});

test("personal registries without allowlists report no dependency findings [4.5f#11]", async () => {
  const { home, root } = setup("deps:\n  app: [hono]");
  await stamp(root, ref);
  expect(selected(await validate(home, root, false))).toEqual([]);
});

test("show JSON exposes plain and card copy, and keeps cards without plain [4.5f#12]", async () => {
  const { home, root } = setup("deps:\n  app: [hono]");
  await sidecar(root, {
    projectExamples: [
      { title: "Task board", description: "A board for a small team." },
      { title: "Issue tracker", description: "A different illustrative project." },
    ],
  });
  allowlist(root, { npm: ["hono"] });
  cards(root, "npm", { hono: dependency() });
  const report = Schema.decodeUnknownSync(ShowReport)(
    JSON.parse(await show(home, root, ["--json"])),
  );
  expect(report.plain).toEqual({
    ...plain,
    example: { title: "Task board", description: "A board for a small team." },
  });
  expect(report.dependencyCards).toEqual({ "npm/hono": dependency() });
  put(cardPath(root, ref), JSON.stringify({ ...(await stamp(root, ref)) }));
  const old = Schema.decodeUnknownSync(ShowReport)(JSON.parse(await show(home, root, ["--json"])));
  expect(old).not.toHaveProperty("plain");
  expect(old.dependencyCards).toEqual({ "npm/hono": dependency() });
  unlinkSync(cardPath(root, ref));
  const absent = Schema.decodeUnknownSync(ShowReport)(
    JSON.parse(await show(home, root, ["--json"])),
  );
  expect(absent).not.toHaveProperty("plain");
  expect(absent.dependencyCards).toEqual({ "npm/hono": dependency() });
  cards(root, "npm", {});
  const uncarded = Schema.decodeUnknownSync(ShowReport)(
    JSON.parse(await show(home, root, ["--json"])),
  );
  expect(uncarded).not.toHaveProperty("dependencyCards");
});

test("agent show places plain copy before description and keeps app dependencies compact [4.5f#13]", async () => {
  const { home, root } = setup("deps:\n  app: [hono, zod]");
  await sidecar(root, {
    projectExamples: [{ title: "Task board", description: "A board for a small team." }],
  });
  allowlist(root, { npm: ["hono", "zod"] });
  cards(root, "npm", { hono: dependency(), zod: dependency("A schema library.") });
  const output = await show(home, root);
  const order = [
    "A starting point for small command line tools.",
    "Good at:",
    "Example:",
    "Not good at:",
    "sample description.",
  ];
  let previous = -1;
  for (const part of order) {
    const position = output.indexOf(part);
    expect(position).toBeGreaterThan(previous);
    previous = position;
  }
  expect(output).toMatch(/^Dependencies \(app\): hono, zod$/m);
  expect(output).not.toContain("A small web framework.");
});

test("human show gives each app dependency its own definition and keeps dev compact [4.5f#14]", async () => {
  const { home, root } = setup("deps:\n  app: [hono, zod]\n  dev: [vitest, typescript]");
  await sidecar(root);
  allowlist(root, { npm: ["hono", "zod", "vitest", "typescript"] });
  cards(root, "npm", { hono: dependency(), zod: dependency("A schema library.") });
  const output = await show(home, root, [], true);
  const lines = output.split("\n");
  const honoLine = lines.find(
    (line) => line.includes("hono") && line.includes("A small web framework."),
  );
  const zodLine = lines.find((line) => line.includes("zod") && line.includes("A schema library."));
  expect(honoLine).toBeDefined();
  expect(zodLine).toBeDefined();
  expect(honoLine).not.toBe(zodLine);
  expect(output).toMatch(/^Dependencies \(dev\): vitest, typescript$/m);
  expect(output).not.toMatch(/^Dependencies \(app\): hono, zod$/m);
});

test("stale, untrusted and escaped plain copy are labelled safely [4.5f#15]", async () => {
  const { home, root } = setup();
  await sidecar(root, {
    plain: { ...plain, whatItIs: "A tool with \u001b[31mred\u001b[0m output." },
  });
  const escaped = await show(home, root);
  expect(escaped).not.toContain("\u001b");
  expect(escaped).toContain("A tool with \\u001b[31mred\\u001b[0m output.");
  const entry = join(root, "stacks/sample/STACK.md");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\nA changed body.\n`);
  expect(await show(home, root)).toContain("(written for an earlier version of this entry)");
  const user = join(home, "config/stacks");
  seed(user, ref);
  await sidecar(user);
  expect(await show(home, root)).toContain("(from the entry's author, not reviewed by stacks)");
});

test("unsigned and signed builds publish dependency cards and check detects tampering [4.5f#16]", async () => {
  const { fixture, privateKey, serve } = await import("./fixtures/index/harness");
  const { DependencyCards, SignedIndex } = await import("@steamfield/stacks-format");
  const f = await fixture(space.dir());
  allowlist(f.registry, { npm: ["hono"] });
  cards(f.registry, "npm", { hono: dependency() });
  const unsigned = await f.invoke(["--out", f.out, "--previous", "none", "--unsigned"]);
  expect(unsigned.status, unsigned.stderr).toBe(0);
  expect(unsigned.stderr).toBe("");
  const first = Schema.decodeUnknownSync(SignedIndex)(readJson(join(f.out, "v1/deps.json")));
  expect(
    Schema.decodeUnknownSync(DependencyCards)(JSON.parse(first.payload)).cards.npm.hono,
  ).toEqual(dependency());
  const signed = await f.invoke(["--out", f.out, "--previous", "none", "--key", privateKey]);
  expect(signed.status, signed.stderr).toBe(0);
  expect(signed.stderr).toBe("");
  const host = await serve(f.out);
  try {
    const checked = await f.invoke(["--check", host.url]);
    expect(checked.status, checked.stderr).toBe(0);
    expect(checked.stderr).toBe("");
    const path = join(f.out, "v1/deps.json");
    const envelope = Schema.decodeUnknownSync(SignedIndex)(readJson(path));
    writeFileSync(path, JSON.stringify({ ...envelope, payload: `${envelope.payload} ` }));
    const changed = await f.invoke(["--check", host.url]);
    expect(changed.status).not.toBe(0);
    expect(changed.stdout).toBe("");
    expect(changed.stderr).toContain("v1/deps.json");
  } finally {
    await host.close();
  }
}, 30_000);

// The bundled registry's zero-warning half of 4.5f#17 is asserted against the suite's one
// whole-registry report, in tests/bundled-registry.test.ts.
test("every bundled entry has plain copy and every used dependency has a card [4.5f#17]", async () => {
  const root = join(import.meta.dirname, "../registry");
  const home = space.dir();
  const listing = await runCli(["list", "--json"], { home, env: quiet, host: { registry: root } });
  expect(listing.status, listing.stderr).toBe(0);
  expect(listing.stderr).toBe("");
  const { ListResult } = await import("../src/schemas/list");
  const entries = Schema.decodeUnknownSync(ListResult)(JSON.parse(listing.stdout)).entries;
  expect(entries.length).toBeGreaterThan(0);
  const allow = Schema.decodeUnknownSync(DependencyAllowlist)(
    readJson(join(root, "allowlist.json")),
  );
  const { DependencyCardFile } = await import("@steamfield/stacks-format");
  expect(allow).toHaveProperty("names");
  for (const entry of entries) {
    const card = Schema.decodeUnknownSync(SearchMetadata)(readJson(cardPath(root, entry)));
    expect(card.plain, `${entry.kind}/${entry.id}`).toBeDefined();
    const shownRun = await runCli(["show", entry.id, "--kind", entry.kind, "--json"], {
      home,
      env: quiet,
      host: { registry: root },
    });
    expect(shownRun.status, shownRun.stderr).toBe(0);
    expect(shownRun.stderr).toBe("");
    const shown = Schema.decodeUnknownSync(ShowReport)(JSON.parse(shownRun.stdout));
    for (const names of Object.values(shown.deps))
      for (const name of names) {
        const matched = (["npm", "pypi", "go", "crates"] as const).filter((ecosystem) => {
          return allow.names[ecosystem].includes(ecosystem === "go" ? goAllowlistKey(name) : name);
        });
        expect(matched, name).toHaveLength(1);
        const ecosystem = matched[0];
        if (ecosystem === undefined) throw new Error(`Missing allowlist ecosystem for ${name}`);
        const file = Schema.decodeUnknownSync(DependencyCardFile)(
          readJson(join(root, "deps", `${ecosystem}.json`)),
        );
        const key = ecosystem === "go" ? goAllowlistKey(name) : name;
        expect(file.cards[key], `${ecosystem}/${key}`).toBeDefined();
      }
  }
  // One show per entry; concurrent gates can exceed Vitest's 5 s.
}, 60_000);

test("show go-cli includes the canonical go-yaml card and preserves its full import path", async () => {
  const root = join(import.meta.dirname, "../registry");
  const home = space.dir();
  const result = await runCli(["show", "go-cli", "--json"], {
    home,
    env: quiet,
    host: { registry: root },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  const report = Schema.decodeUnknownSync(ShowReport)(JSON.parse(result.stdout));
  const { DependencyCardFile } = await import("@steamfield/stacks-format");
  const file = Schema.decodeUnknownSync(DependencyCardFile)(readJson(join(root, "deps/go.json")));
  expect(report.deps.cli).toContain("go.yaml.in/yaml/v3");
  expect(file.cards["go.yaml.in/yaml"]).toBeDefined();
  expect(report.dependencyCards?.["go/go.yaml.in/yaml"]).toEqual(file.cards["go.yaml.in/yaml"]);
  const text = await runCli(["show", "go-cli"], { home, env: quiet, host: { registry: root } });
  expect(text.status, text.stderr).toBe(0);
  expect(text.stderr).toBe("");
  expect(text.stdout).toMatch(/^Dependencies \(cli\): .*go\.yaml\.in\/yaml\/v3$/m);
});

test("human Go app descriptions match canonical cards and retain full import paths", async () => {
  const { home, root } = setup("deps:\n  app: [go.yaml.in/yaml/v3]");
  await sidecar(root);
  cards(root, "go", { "go.yaml.in/yaml": dependency("A Go YAML reader.") });
  expect(await show(home, root, [], true)).toMatch(
    /^ {2}go\.yaml\.in\/yaml\/v3: A Go YAML reader\.$/m,
  );
});

test("scoped npm and Go module names keep their exact card keys [4.5f#18]", async () => {
  const { home, root } = setup('deps:\n  app: ["@tanstack/react-query", "github.com/jackc/pgx"]');
  await sidecar(root);
  allowlist(root, { npm: ["@tanstack/react-query"], go: ["github.com/jackc/pgx"] });
  cards(root, "npm", { "@tanstack/react-query": dependency("A query cache for React.") });
  cards(root, "go", { "github.com/jackc/pgx": dependency("A Go PostgreSQL driver.") });
  const report = Schema.decodeUnknownSync(ShowReport)(
    JSON.parse(await show(home, root, ["--json"])),
  );
  expect(report.dependencyCards).toEqual({
    "npm/@tanstack/react-query": dependency("A query cache for React."),
    "go/github.com/jackc/pgx": dependency("A Go PostgreSQL driver."),
  });
  expect(await show(home, root, [], true)).toContain("A Go PostgreSQL driver.");
});

test("uncarded app dependencies print only their names in human mode [4.5f#19]", async () => {
  const { home, root } = setup("deps:\n  app: [hono, uncarded]");
  await sidecar(root);
  allowlist(root, { npm: ["hono", "uncarded"] });
  cards(root, "npm", { hono: dependency() });
  const lines = (await show(home, root, [], true)).split("\n");
  const unknown = lines.find((line) => line.includes("uncarded"));
  const unknownIndex = lines.findIndex((line) => line.includes("uncarded"));
  expect(unknown?.trim()).toMatch(/^(?:Dependencies \(app\): )?(?:[-*] )?uncarded$/);
  expect(unknown).not.toContain("placeholder");
  expect(lines[unknownIndex + 1]).toMatch(/^(?:Dependencies \(dev\):|Tools:)/);
  expect(
    lines.some((line) => line.includes("hono") && line.includes("A small web framework.")),
  ).toBe(true);
});

test("personal dependency files are ignored in show and validate [4.5f#20]", async () => {
  const { home, root } = setup();
  await stamp(root, ref);
  allowlist(root, { npm: ["hono"] });
  cards(root, "npm", { hono: dependency("Bundled definition.") });
  const user = join(home, "config/stacks");
  stack(user, ref.id, "deps:\n  app: [hono]");
  await stamp(user, ref);
  cards(user, "npm", { hono: dependency("Personal definition.") });
  const shown = Schema.decodeUnknownSync(ShowReport)(
    JSON.parse(await show(home, root, ["--json"])),
  );
  expect(shown.dependencyCards).toEqual({ "npm/hono": dependency("Bundled definition.") });
  expect(JSON.stringify(shown)).not.toContain("Personal definition.");
  expect(selected(await validate(home, user, false))).toEqual([]);
  const project = join(home, ".stacks");
  stack(project, ref.id, "deps:\n  app: [hono]");
  await stamp(project, ref);
  cards(project, "npm", { hono: dependency("Project definition.") });
  const projectShown = Schema.decodeUnknownSync(ShowReport)(
    JSON.parse(await show(home, root, ["--json"])),
  );
  expect(projectShown.dependencyCards).toEqual({ "npm/hono": dependency("Bundled definition.") });
  expect(JSON.stringify(projectShown)).not.toContain("Project definition.");
  expect(selected(await validate(home, project, false))).toEqual([]);
});

test("card keys must match allowlist case exactly [4.5f#21]", async () => {
  const { home, root } = setup("deps:\n  app: [hono]");
  await stamp(root, ref);
  allowlist(root, { npm: ["hono"] });
  cards(root, "npm", { Hono: dependency() });
  const findings = selected(await validate(home, root));
  expect(
    findings
      .map(({ check, severity }) => ({ check, severity }))
      .sort((a, b) => a.check.localeCompare(b.check)),
  ).toEqual([
    { check: "deps-invalid", severity: "error" },
    { check: "deps-missing", severity: "warning" },
  ]);
});

test("missing ecosystem files publish empty objects [4.5f#22]", async () => {
  const { fixture } = await import("./fixtures/index/harness");
  const { DependencyCards, SignedIndex } = await import("@steamfield/stacks-format");
  const f = await fixture(space.dir());
  allowlist(f.registry, { npm: ["hono"] });
  const result = await f.invoke(["--out", f.out, "--previous", "none", "--unsigned"]);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  const envelope = Schema.decodeUnknownSync(SignedIndex)(readJson(join(f.out, "v1/deps.json")));
  const published = Schema.decodeUnknownSync(DependencyCards)(JSON.parse(envelope.payload));
  expect(published.cards).toEqual({ npm: {}, pypi: {}, go: {}, crates: {} });
}, 30_000);
