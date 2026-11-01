import { readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { quiet, runCli } from "./helpers/cli";
import { minimal, writeEntry } from "./helpers/registry";
import {
  bundled,
  card,
  cardPath,
  copyVocabulary,
  decorate,
  decorateWorkspace,
  openRouter,
  put,
  readJson,
  searchFindings,
  seed,
  stamp,
  validateSearch,
} from "./helpers/search-metadata";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());
const sample = { kind: "stack", id: "sample" } as const;

test("draft prompts include reviewed registry cards when they are available", async () => {
  const f = decorateWorkspace(space.dir());
  // The copied bundled cards are reviewed too; leave only this test's two as examples.
  for (const dir of ["stacks", "fragments"])
    rmSync(join(f.registry, "search", dir), { recursive: true });
  const summaries = ["Reviewed second example fixture.", "Reviewed third example fixture."];
  for (const [index, id] of ["second", "third"].entries()) {
    const ref = { kind: "stack", id } as const;
    const value = await stamp(f.registry, ref);
    put(cardPath(f.registry, ref), JSON.stringify({ ...value, summary: summaries[index] }));
  }
  const mobile = { kind: "stack", id: "mobile-expo" } as const;
  const server = await openRouter([{ content: JSON.stringify(card(mobile)) }]);
  try {
    const result = await decorate(f, [mobile.id], {
      env: {
        OPENROUTER_API_KEY: "fixture-secret",
        OPENROUTER_BASE_URL: server.url,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    const request = JSON.stringify(server.requests[0]?.body);
    for (const summary of summaries) expect(request).toContain(summary);
  } finally {
    await server.close();
  }
});

function seedStack(root: string) {
  writeEntry({
    root,
    kind: "stack",
    dir: sample.id,
    frontmatter: minimal(
      "stack",
      sample.id,
      `tags: [scripts]
verify:
  - { name: install, phase: setup, layer: install, run: "true" }
  - { name: lint, layer: lint, run: "true" }
  - { name: typecheck, layer: typecheck, run: "true" }
  - { name: test, layer: test, run: "true" }`,
    ),
    body: "# Fixture\n\n## Setup\n\nBuild a small command.\n",
  });
}

test("restamp under an agent stamps an unread model draft against the current entry", async () => {
  const f = decorateWorkspace(space.dir());
  const ref = { kind: "stack", id: "second" } as const;
  const card = await stamp(f.registry, ref);
  put(
    cardPath(f.registry, ref),
    JSON.stringify({
      ...card,
      source: {
        ...card.source,
        digest: `sha256:${"0".repeat(64)}`,
        by: "drafted",
        model: "fixture/model",
        promptVersion: 1,
        reviewedAt: null,
      },
    }),
  );
  const result = await decorate(f, ["--restamp", ref.id], { env: { CLAUDECODE: "1" } });
  expect(result.status, result.stderr).toBe(0);
  const after = readJson(cardPath(f.registry, ref));
  expect(after).toMatchObject({
    source: { by: "drafted", digest: card.source.digest, reviewedAt: expect.any(String) },
  });
});

test("restamp cannot mark an unread submitted author card reviewed", async () => {
  const f = decorateWorkspace(space.dir());
  const ref = { kind: "stack", id: "second" } as const;
  const card = await stamp(f.registry, ref);
  put(
    cardPath(f.registry, ref),
    JSON.stringify({ ...card, source: { ...card.source, by: "author", reviewedAt: null } }),
  );
  const before = readFileSync(cardPath(f.registry, ref), "utf8");
  const result = await decorate(f, ["--restamp", ref.id], { env: { CLAUDECODE: "1" } });
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toMatch(/approve/);
  expect(readFileSync(cardPath(f.registry, ref), "utf8")).toBe(before);
});

test("a missing bundled vocabulary is an error even with a current card", async () => {
  const home = space.dir();
  const root = join(home, "registry");
  seedStack(root);
  const card = await stamp(root, sample);
  put(cardPath(root, sample), JSON.stringify({ ...card, platforms: ["invented-platform"] }));
  const findings = searchFindings(await validateSearch(root, { home, bundled: true }));
  expect(findings).toContainEqual(
    expect.objectContaining({ check: "vocabulary-invalid", severity: "error" }),
  );
});

test("an unreadable search directory cannot silently validate as empty", async () => {
  const home = space.dir();
  const root = join(home, "registry");
  seedStack(root);
  copyVocabulary(root);
  symlinkSync("fragments", join(root, "search/fragments"));
  const result = await runCli(["validate", root, "--json"], {
    home,
    env: quiet,
    host: { registry: bundled },
  });
  expect(result.status).toBe(6);
  expect(JSON.parse(result.stderr)).toMatchObject({ error: { tag: "PermissionDenied" } });
});

test("a personal-root preview reads each selected card from its own origin", async () => {
  const home = space.dir();
  const root = join(home, "personal");
  const bundled = join(home, "bundled");
  const tools = { kind: "fragment", id: "tools" } as const;
  seed(root, tools);
  seedStack(bundled);
  copyVocabulary(bundled);
  await stamp(root, tools);
  await stamp(bundled, sample);
  const result = await runCli(
    ["validate", root, "--brief", sample.id, "--with", tools.id, "--json"],
    {
      home,
      env: quiet,
      host: { registry: bundled },
    },
  );
  expect(result.status, result.stderr).toBe(0);
  const { BriefPreview } = await import("../src/schemas/validate");
  const { Schema } = await import("effect");
  const report = Schema.decodeUnknownSync(BriefPreview)(JSON.parse(result.stdout));
  expect(report.findings.filter(({ check }) => check.startsWith("search-"))).toEqual([]);
});

test("validating one entry does not enumerate another kind's unreadable cards", async () => {
  const home = space.dir();
  const root = join(home, "registry");
  seedStack(root);
  copyVocabulary(root);
  await stamp(root, sample);
  symlinkSync("fragments", join(root, "search/fragments"));
  const result = await runCli(["validate", join(root, "stacks/sample"), "--json"], {
    home,
    env: quiet,
    host: { registry: bundled },
  });
  expect(result.status, result.stderr).toBe(0);
  const { ValidateReport } = await import("../src/schemas/validate");
  const { Schema } = await import("effect");
  expect(
    searchFindings(Schema.decodeUnknownSync(ValidateReport)(JSON.parse(result.stdout))),
  ).toEqual([expect.objectContaining({ check: "vocabulary-ignored" })]);
  expect(readJson(cardPath(root, sample))).toMatchObject({ id: sample.id });
});

test("every bundled card is byte for byte what decorate writes, so approving changes one line", async () => {
  const { readdirSync } = await import("node:fs");
  const { Schema } = await import("effect");
  const { SearchMetadata } = await import("@steamfield/stacks-format");
  for (const kind of ["stack", "fragment"] as const) {
    for (const name of readdirSync(join(bundled, "search", `${kind}s`))) {
      const text = readFileSync(join(bundled, "search", `${kind}s`, name), "utf8");
      const decoded = Schema.decodeUnknownSync(SearchMetadata)(JSON.parse(text));
      expect(text, name).toBe(`${JSON.stringify(decoded, null, 2)}\n`);
    }
  }
});
