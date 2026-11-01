import { sign } from "node:crypto";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import {
  compositionFingerprint,
  fixture,
  privateKey,
  proof,
  readBuild,
  serve,
} from "./fixtures/index/harness";
import {
  buildDirectory,
  commitAt,
  datedEntries,
  directoryEnvelope,
  entryRefs,
  failedDirectory,
  readDirectory,
  writeRemoved,
} from "./helpers/directory";
import { writeLedger } from "./helpers/ledger";
import { git, type NamesFixture, succeeded } from "./helpers/official-names";
import { minimal, writeEntry } from "./helpers/registry";
import { workspace } from "./helpers/verify";

const shared = workspace();
const space = workspace();
let published: NamesFixture;
// Copy, validate and build once. Each test owns its HTTP server and restores mutated files.
beforeAll(async () => {
  published = await fixture(shared.dir());
  const f = published;
  writeRemoved(f, {});
  writeEntry({
    root: f.registry,
    kind: "fragment",
    dir: "zeta",
    frontmatter: minimal("fragment", "zeta", "tags: [0-api, api-]"),
  });
  commitAt(f, "2026-10-29T10:00:00-05:00", "fixture: add zeta");
  const sample = readFileSync(join(f.registry, "stacks/sample/STACK.md"), "utf8").replace(
    "tags: [scripts]",
    "tags: [scripts, api--v2]",
  );
  const alpha = writeEntry({ root: f.registry, kind: "stack", dir: "alpha", frontmatter: "" });
  writeFileSync(
    join(alpha, "STACK.md"),
    sample
      .replaceAll("sample", "alpha")
      .replace("default: [tools]", "default: [zeta]")
      .replace("  optional: [extra, unproven]\n", ""),
  );
  commitAt(f, "2026-11-01T12:00:00Z", "fixture: add alpha");
  const extra = join(f.registry, "fragments/extra/FRAGMENT.md");
  const original = readFileSync(extra, "utf8");
  rmSync(extra);
  rmSync(join(f.registry, "search/fragments/extra.json"));
  commitAt(f, "2026-11-02T12:00:00Z", "fixture: remove extra");
  writeFileSync(extra, original);
  commitAt(f, "2026-11-03T12:00:00Z", "fixture: restore extra");
  writeFileSync(join(f.registry, "stacks/sample/STACK.md"), `${sample}\nEdited guidance.\n`);
  writeLedger(f.registry, [
    await proof(f.registry),
    await proof(f.registry, {
      stack: "alpha",
      fingerprint: await compositionFingerprint(f.registry, { stack: "alpha" }),
    }),
    await proof(f.registry, {
      with: ["extra"],
      fingerprint: await compositionFingerprint(f.registry, { with: ["extra"] }),
    }),
  ]);
  commitAt(f, "2026-11-05T12:00:00Z", "fixture: edit and prove compositions");
  await buildDirectory(f);
}, 60_000);
afterEach(() => space.release());
afterAll(() => shared.release());

test("signed directory covers valid hyphenated tags and index rows with first committer dates [4.2c#1] [4.2c#3] [4.2c#6]", async () => {
  const directory = await readDirectory(published.out);
  const { index, envelope } = await readBuild(published.out);
  expect(directoryEnvelope(published.out).keyId).toBe(envelope.keyId);
  expect(directory).toMatchObject({
    formatVersion: 1,
    commit: git(published, "rev-parse", "HEAD"),
    generatedAt: index.generatedAt,
    removed: [],
  });
  expect(datedEntries(directory.entries)).toEqual([
    { id: "extra", kind: "fragment", addedAt: "2026-10-27T09:00:00.000Z" },
    { id: "tools", kind: "fragment", addedAt: "2026-10-27T09:00:00.000Z" },
    { id: "zeta", kind: "fragment", addedAt: "2026-10-29T15:00:00.000Z" },
    { id: "alpha", kind: "stack", addedAt: "2026-11-01T12:00:00.000Z" },
    { id: "sample", kind: "stack", addedAt: "2026-10-27T09:00:00.000Z" },
  ]);
  expect(entryRefs(directory.entries)).toEqual(entryRefs(index.entries));
  expect(index.entries.find((entry) => entry.id === "sample")?.tags).toEqual([
    "scripts",
    "api--v2",
  ]);
  expect(index.entries.find((entry) => entry.id === "zeta")?.tags).toEqual(["0-api", "api-"]);
});

test("check verifies directory bytes and rejects a one-byte change [4.2c#1]", async () => {
  const file = join(published.out, "v1/directory.json");
  const original = readFileSync(file, "utf8");
  const envelope = directoryEnvelope(published.out);
  const { DirectoryData } = await import("@steamfield/stacks-format");
  const before = Schema.decodeUnknownSync(DirectoryData)(JSON.parse(envelope.payload));
  const changed = envelope.payload.replace(/"addedAt"\s*:\s*"2026-10-27/, (field) =>
    field.replace("2026-10-27", "2026-10-28"),
  );
  expect(changed).not.toBe(envelope.payload);
  expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(envelope.payload));
  const after = Schema.decodeUnknownSync(DirectoryData)(JSON.parse(changed));
  expect(after.formatVersion).toBe(before.formatVersion);
  expect(after.generatedAt).toBe(before.generatedAt);
  expect(after.commit).toBe(before.commit);
  expect(after.removed).toEqual(before.removed);
  expect(after.entries).not.toEqual(before.entries);
  const host = await serve(published.out);
  try {
    succeeded(await published.invoke(["--check", host.url]));
    expect(host.requests).toContain("/v1/directory.json");
    writeFileSync(file, JSON.stringify({ ...envelope, payload: changed }));
    const result = await published.invoke(["--check", host.url]);
    failedDirectory(result);
    expect(result.stderr).toContain("v1/directory.json");
  } finally {
    writeFileSync(file, original);
    await host.close();
  }
}, 30_000);

test.each(["missing", "unsigned", "unknown key", "invalid payload"])(
  "check rejects %s directory beside a valid index [4.2c#9]",
  async (kind) => {
    const file = join(published.out, "v1/directory.json");
    const original = readFileSync(file, "utf8");
    const envelope = directoryEnvelope(published.out);
    const host = await serve(published.out);
    try {
      if (kind === "missing") rmSync(file);
      else if (kind === "unsigned")
        writeFileSync(file, JSON.stringify({ ...envelope, signature: "" }));
      else if (kind === "unknown key")
        writeFileSync(file, JSON.stringify({ ...envelope, keyId: "unknown" }));
      else {
        const payload = JSON.stringify({ formatVersion: 999, entries: [], removed: [] });
        const signature = sign(null, Buffer.from(payload), readFileSync(privateKey)).toString(
          "base64",
        );
        writeFileSync(file, JSON.stringify({ ...envelope, payload, signature }));
      }
      const result = await published.invoke(["--check", host.url]);
      failedDirectory(result);
      expect(result.stderr).toContain("v1/directory.json");
      expect(host.requests).toContain("/v1/directory.json");
    } finally {
      writeFileSync(file, original);
      await host.close();
    }
  },
  30_000,
);

test("history reads ignore cwd and inherited git selectors in paths with spaces and accents [4.2c#7]", async () => {
  const out = join(published.root, "-directory output café");
  succeeded(
    await published.invoke(["--out", out, "--previous", "none", "--key", privateKey], {
      cwd: space.dir(),
      env: {
        GIT_DIR: join(published.root, "absent.git"),
        GIT_WORK_TREE: "/missing",
        GIT_INDEX_FILE: "/missing/index",
        AI_AGENT: "1",
      },
    }),
  );
  const directory = await readDirectory(out);
  expect(directory.entries).toEqual((await readDirectory(published.out)).entries);
  expect(directory.commit).toBe(git(published, "rev-parse", "HEAD"));
}, 30_000);

const BundledRemovals = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  entries: Schema.Record(
    Schema.String,
    Schema.Struct({
      kind: Schema.Literals(["stack", "fragment"]),
      replacedBy: Schema.optionalKey(Schema.String),
    }),
  ),
});

test("bundled removal rows name retired ids and current replacements [4.2c#5]", () => {
  const bundled = join(import.meta.dirname, "../registry");
  const removals = Schema.decodeUnknownSync(BundledRemovals)(
    JSON.parse(readFileSync(join(bundled, "removed.json"), "utf8")) as unknown,
  );
  const current = (kind: "stack" | "fragment", id: string) =>
    existsSync(join(bundled, kind === "stack" ? "stacks" : "fragments", id));
  for (const [id, row] of Object.entries(removals.entries)) {
    expect(current(row.kind, id), `${row.kind}/${id} is still bundled`).toBe(false);
    if (row.replacedBy !== undefined)
      expect(
        current("stack", row.replacedBy) || current("fragment", row.replacedBy),
        `${id}: replacement ${row.replacedBy} is not bundled`,
      ).toBe(true);
  }
});

test("the bundled registry's current entries build a signed directory [4.2c#5]", async () => {
  const f = await fixture(space.dir());
  rmSync(f.registry, { recursive: true });
  cpSync(join(import.meta.dirname, "../registry"), f.registry, { recursive: true });
  // The fixture has no release tags, so a removal row's last published content can't resolve.
  writeFileSync(join(f.registry, "removed.json"), '{ "schemaVersion": 1, "entries": {} }\n');
  commitAt(f, "2026-11-06T12:00:00Z", "fixture: bundled registry");
  // Building every bundled entry takes about 10 s alone and longer under a loaded gate.
  succeeded(
    await f.invoke(["--out", f.out, "--previous", "none", "--key", privateKey], {
      timeout: 55_000,
    }),
  );
  const directory = await readDirectory(f.out);
  expect(directory.removed).toEqual([]);
  // The bundled ledger proves no stack today, so the index may be empty; the rows still match.
  const { index } = await readBuild(f.out);
  expect(entryRefs(directory.entries)).toEqual(entryRefs(index.entries));
}, 60_000);
