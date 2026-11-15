import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Manifest } from "@steamfield/stacks-format";
import { Effect, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { renderBrief } from "../src/core/brief/render";
import { versions } from "../src/core/brief/text";
import { missingTools } from "../src/core/compose/compose";
import { composeFiles, NEUTRAL_VARS, type RenderedFile } from "../src/core/compose/files";
import type { Composition } from "../src/core/compose/types";
import { fingerprint } from "../src/core/fingerprint";
import { TEMPLATE_VARIABLES } from "../src/core/template";
import type { EntryInvalid, PermissionDenied } from "../src/errors";
import {
  BODY,
  composition,
  type FileFixture,
  fileFixture,
  newResult,
  STACK_META,
  scaffoldCli,
  TEMPLATE,
  workspace,
} from "./fixtures/composed-files";
import { writeEntry } from "./helpers/registry";

const space = workspace();
afterEach(() => space.release());
const hash = (c: Composition) =>
  Effect.runPromise<string, EntryInvalid | PermissionDenied>(
    fingerprint(c).pipe(Effect.provide(NodeServices.layer)),
  );
const files = (c: Composition) =>
  Effect.runPromise<ReadonlyArray<RenderedFile>, EntryInvalid | PermissionDenied>(
    composeFiles(c, NEUTRAL_VARS).pipe(Effect.provide(NodeServices.layer)),
  );

// Each mutation starts from a newly loaded real registry, avoiding cached entry metadata.
const mutations: ReadonlyArray<{
  name: string;
  change: (f: FileFixture) => void;
}> = [
  {
    name: "stack body",
    change: (f) =>
      writeEntry({
        root: f.root,
        kind: "stack",
        dir: "sample",
        frontmatter: STACK_META,
        body: `${BODY}More guidance.\n`,
      }),
  },
  {
    name: "fragment body",
    change: (f) => {
      const at = join(f.last, "FRAGMENT.md");
      writeFileSync(at, `${readFileSync(at, "utf8")}Extra fragment guidance.\n`);
    },
  },
  {
    name: "first fragment body",
    change: (f) => {
      const at = join(f.first, "FRAGMENT.md");
      writeFileSync(at, `${readFileSync(at, "utf8")}More first-fragment guidance.\n`);
    },
  },
  {
    name: "stack frontmatter value",
    change: (f) =>
      writeEntry({
        root: f.root,
        kind: "stack",
        dir: "sample",
        frontmatter: STACK_META.replace("sample name", "Changed name"),
        body: BODY,
      }),
  },
  {
    name: "fragment frontmatter value",
    change: (f) => {
      const at = join(f.first, "FRAGMENT.md");
      writeFileSync(at, readFileSync(at, "utf8").replace("sample name", "Changed name"));
    },
  },
  {
    name: "last fragment frontmatter value",
    change: (f) => {
      const at = join(f.last, "FRAGMENT.md");
      writeFileSync(at, readFileSync(at, "utf8").replace("z-extra name", "Changed name"));
    },
  },
  {
    name: "binary byte",
    change: (f) => f.put(f.stack, "files/payload.bin", new Uint8Array([0, 254])),
  },
  {
    name: "template byte",
    change: (f) => f.put(f.stack, "files/README.md.tmpl", `${TEMPLATE}More\n`),
  },
  {
    name: "merged JSON value",
    change: (f) => f.put(f.last, "files/.shared/settings.json", '{"nested":{"last":false}}'),
  },
  {
    name: "shipped path",
    change: (f) =>
      renameSync(join(f.stack, "files/payload.bin"), join(f.stack, "files/renamed.bin")),
  },
  {
    name: "file owner",
    change: (f) => renameSync(join(f.stack, "files/-flags.txt"), join(f.first, "files/-flags.txt")),
  },
  {
    name: "executable flag",
    change: (f) => chmodSync(join(f.first, "files/.githooks/pre-commit"), 0o644),
  },
];

test.each(mutations)("a change to $name changes the fingerprint [2.0a#2]", async ({ change }) => {
  const fixture = fileFixture(space.dir());
  const before = await hash(await composition(fixture));
  expect(before).toMatch(/^sha256:[0-9a-f]{64}$/);
  change(fixture);
  const after = await hash(await composition(fixture));
  expect(after).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(after).not.toBe(before);
});

test("equivalent neutral rendering ignores template token spelling [2.0a#2]", async () => {
  const fixture = fileFixture(space.dir());
  const before = await composition(fixture);
  const originalFiles = await files(before);
  const expected = await hash(before);
  fixture.put(
    fixture.stack,
    "files/README.md.tmpl",
    TEMPLATE_VARIABLES.reduce(
      (text, key) => text.replace(`{{ ${key} }}`, NEUTRAL_VARS[key]),
      TEMPLATE,
    ),
  );
  const after = await composition(fixture);
  expect(after.stack.meta).toEqual(before.stack.meta);
  expect(after.stack.body).toBe(before.stack.body);
  expect(await files(after)).toEqual(originalFiles);
  expect(await hash(after)).toBe(expected);
});

test("adjacent file bytes and paths cannot run together in the hash input [2.0a#2]", async () => {
  const fixture = fileFixture(space.dir());
  fixture.put(fixture.stack, "files/zzz-a", "Xzzz-");
  fixture.put(fixture.stack, "files/zzz-b", "unchanged second file");
  const before = await composition(fixture);
  const expected = await hash(before);
  fixture.put(fixture.stack, "files/zzz-a", "X");
  renameSync(join(fixture.stack, "files/zzz-b"), join(fixture.stack, "files/zzz-zzz-b"));
  const after = await composition(fixture);
  expect(after.stack.meta).toEqual(before.stack.meta);
  expect(after.fragments).toEqual(before.fragments);
  expect(after.stack.body).toBe(before.stack.body);
  // Without framing, bytes "Xzzz-" + path "zzz-b" equal bytes "X" + path "zzz-zzz-b".
  expect(await hash(after)).not.toBe(expected);
});

test("the preset changes the fingerprint even when entries and shipped bytes are identical [2.0a#2]", async () => {
  const fixture = fileFixture(space.dir());
  const normal = await composition(fixture);
  const sandbox = await composition(fixture, { preset: "sandbox" });
  expect(normal.stack).toEqual(sandbox.stack);
  expect(normal.fragments).toEqual(sandbox.fragments);
  expect(await files(normal)).toEqual(await files(sandbox));
  expect(await hash(normal)).not.toBe(await hash(sandbox));
});

test("repeated calls, relocated entries, TZ and HOME do not change a fingerprint [2.0a#2]", async () => {
  const firstHome = space.dir();
  const secondHome = space.dir();
  const first = await composition(fileFixture(firstHome));
  const second = await composition(fileFixture(secondHome));
  const savedHome = process.env.HOME;
  const savedTZ = process.env.TZ;
  try {
    process.env.HOME = firstHome;
    process.env.TZ = "Pacific/Kiritimati";
    const expected = await hash(first);
    expect(await hash(first)).toBe(expected);
    process.env.HOME = secondHome;
    process.env.TZ = "America/Adak";
    expect(await hash(first)).toBe(expected);
    expect(await hash(second)).toBe(expected);
  } finally {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedTZ === undefined) delete process.env.TZ;
    else process.env.TZ = savedTZ;
  }
});

test("YAML layout, quoting and nested key order do not change decoded frontmatter or fingerprint [2.0a#2]", async () => {
  const fixture = fileFixture(space.dir());
  const before = await composition(fixture);
  const reformatted = STACK_META.replace(
    "commands: { test: bun test, lint: bun run lint }",
    'commands:\n  lint: "bun run lint"\n  test: "bun test"',
  )
    .replace("schema_version: 1\nid: sample", "id: 'sample'\nschema_version: 1")
    .replace("required: [sample, z-extra]", "required:\n    - sample\n    - z-extra");
  writeEntry({
    root: fixture.root,
    kind: "stack",
    dir: "sample",
    frontmatter: reformatted,
    body: BODY,
  });
  const after = await composition(fixture);
  expect(after.stack.meta).toEqual(before.stack.meta);
  expect(after.stack.body).toBe(before.stack.body);
  expect(await hash(after)).toBe(await hash(before));
});

test("project names, scope, author and the brief's fixed wording are outside the fingerprint [2.0a#2]", async () => {
  const home = space.dir();
  const fixture = fileFixture(home);
  const c = await composition(fixture);
  const expected = await hash(c);
  const first = newResult(await scaffoldCli(fixture, home, "first", { scope: "one" }));
  const config = join(home, "config/stacks");
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "config.json"), JSON.stringify({ author: "Another Author" }));
  const second = newResult(await scaffoldCli(fixture, home, "second", { scope: "two" }));
  expect(first).toMatchObject({ fingerprint: expected });
  expect(second).toMatchObject({ fingerprint: expected });
  expect(readFileSync(join(home, "first/README.md"), "utf8")).not.toBe(
    readFileSync(join(home, "second/README.md"), "utf8"),
  );
  const context = {
    project: "example",
    git: { kind: "none" as const },
    written: first.written,
    missing: missingTools(c, () => true),
    yes: true,
    invocation: "stacks",
  };
  const before = renderBrief(c, context).text;
  // Simulate a CLI prose-only release using the real fixed text, restoring it for other tests.
  const saved = [...versions];
  try {
    versions.push("- A revised fixed instruction from a later CLI release.");
    expect(renderBrief(c, context).text).not.toBe(before);
    expect(await hash(c)).toBe(expected);
  } finally {
    versions.splice(0, versions.length, ...saved);
  }
});

test("agents differ only when their selected adapter files differ [2.0a#2]", async () => {
  const fixture = fileFixture(space.dir());
  const claude = await composition(fixture, { agents: ["claude"] });
  const codex = await composition(fixture, { agents: ["codex"] });
  expect(await files(claude)).toEqual(await files(codex));
  const expected = await hash(claude);
  expect(await hash(codex)).toBe(expected);
  fixture.put(fixture.stack, "adapters/codex/AGENTS.md", "Codex-specific guidance.\n");
  expect(await hash(await composition(fixture, { agents: ["claude"] }))).toBe(expected);
  expect(await hash(await composition(fixture, { agents: ["codex"] }))).not.toBe(expected);
});

test("new JSON and manifest carry the composition fingerprint without a schema bump [2.0a#3]", async () => {
  const home = space.dir();
  const fixture = fileFixture(home);
  const c = await composition(fixture, { agents: ["codex"], preset: "sandbox" });
  const expected = await hash(c);
  expect(expected).toMatch(/^sha256:[0-9a-f]{64}$/);
  const result = newResult(
    await scaffoldCli(fixture, home, "app", { agents: "codex", sandbox: true }),
  );
  expect(result).toMatchObject({ fingerprint: expected });
  const manifest = Schema.decodeUnknownSync(Manifest, { onExcessProperty: "error" })(
    JSON.parse(readFileSync(join(home, "app/.stacks/manifest.json"), "utf8")),
  );
  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.fingerprint).toBe(expected);
});
