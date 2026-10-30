import { generateKeyPairSync, verify } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import type { IndexEntry } from "@steamfield/stacks-format";
import { canonicalBundle, EntryBundle } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { ValidateReport } from "../src/schemas/validate";
import {
  bundleFile,
  compositionFingerprint,
  digestOf,
  entryPath,
  fixture,
  keyId,
  preserve,
  privateKey,
  proof,
  publicKey,
  rawBundle,
  readBuild,
  serve,
  snapshot,
} from "./fixtures/index/harness";
import { quiet, runCli } from "./helpers/cli";
import { runRecord, writeLedger } from "./helpers/ledger";
import { reviewSearchFixture } from "./helpers/search-fixture";
import { workspace } from "./helpers/verify";

// Each case copies a source workspace and runs real Bun processes plus validation and git.
// Carry-forward/check cases also own an HTTP server; allow 30 s under concurrent test hosts.
const space = workspace();
afterEach(() => space.release());
const setup = () => fixture(space.dir());
type Fixture = Awaited<ReturnType<typeof setup>>;
type Result = Awaited<ReturnType<Fixture["invoke"]>>;

function succeeded(result: Result) {
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
}

function failed(result: Result) {
  expect(result.status).toBeGreaterThan(0);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim()).not.toBe("");
  // Missing implementation must fail negative cases too, rather than masquerade as rejection.
  expect(result.stderr).not.toMatch(
    /Module not found|Cannot find module|SyntaxError|ReferenceError/,
  );
}

async function build(f: Fixture, previous = "none", out = f.out) {
  const result = await f.invoke(["--out", out, "--previous", previous, "--key", privateKey]);
  succeeded(result);
  expect(result.stdout.trim()).not.toBe("");
  return readBuild(out);
}

function named(entries: readonly IndexEntry[], kind: IndexEntry["kind"], id: string): IndexEntry {
  const entry = entries.find((entry) => entry.kind === kind && entry.id === id);
  if (entry === undefined) throw new Error(`Missing index entry: ${kind}/${id}`);
  return entry;
}

async function assertBundle(out: string, entry: IndexEntry) {
  const file = bundleFile(out, entry);
  const bytes = readFileSync(file);
  const bundle = Schema.decodeUnknownSync(EntryBundle)(JSON.parse(bytes.toString("utf8")));
  expect(bundle.id).toBe(entry.id);
  expect(bundle.kind).toBe(entry.kind);
  expect(await digestOf(bundle)).toBe(entry.digest);
  expect(bytes.toString("utf8")).toBe(new TextDecoder().decode(canonicalBundle(bundle)));
  return bundle;
}

test("a signed build decodes and publishes canonical bundles at their digests [4.0c#1]", async () => {
  const f = await setup();
  const { envelope, index } = await build(f);
  expect(envelope.keyId).toBe(keyId);
  expect(
    verify(
      null,
      Buffer.from(envelope.payload),
      publicKey,
      Buffer.from(envelope.signature, "base64"),
    ),
  ).toBe(true);
  expect(index.formatVersion).toBe(1);
  expect(index.minCli).toMatch(/^\d+\.\d+\.\d+/);
  expect(Number.isNaN(Date.parse(index.generatedAt))).toBe(false);
  expect(index.commit).toBe(f.commit);
  expect(index.entries.map((entry: IndexEntry) => `${entry.kind}/${entry.id}`).sort()).toEqual([
    "fragment/tools",
    "stack/sample",
  ]);
  for (const entry of index.entries) {
    await assertBundle(f.out, entry);
    expect(entry.digest).toBe(await digestOf(rawBundle(f.registry, entry.kind, entry.id)));
    expect(entry).toMatchObject({
      schemaVersion: 1,
      name: `${entry.id} name`,
      description: `${entry.id} description.`,
      tags: entry.kind === "stack" ? ["scripts"] : [],
    });
  }
}, 30_000);

test("default digests and newest eligible matching proof are published [4.0c#2]", async () => {
  const f = await setup();
  const newest = { ...f.record, date: "2026-10-29", minutesToGreen: 1.25 };
  writeLedger(f.registry, [
    f.record,
    newest,
    { ...f.record, date: "2026-11-01", fingerprint: `sha256:${"f".repeat(64)}` },
    { ...f.record, date: "2026-11-02", interventions: 1 },
    { ...f.record, date: "2026-11-03", result: "fail" },
    { ...f.record, date: "2026-10-26" },
  ]);
  const { index } = await build(f);
  const stack = named(index.entries, "stack", "sample");
  expect(stack.composition).toEqual({
    tools: await digestOf(rawBundle(f.registry, "fragment", "tools")),
  });
  expect(stack.lastRun).toEqual({
    date: newest.date,
    result: "pass",
    agent: "claude",
    preset: newest.preset,
    minutesToGreen: 1.25,
    fingerprint: newest.fingerprint,
  });
}, 30_000);

test.each([
  { label: "intervention", overrides: { interventions: 1 } },
  { label: "unknown intervention count", overrides: { interventions: null } },
  {
    label: "manifest-only verification",
    overrides: { run: runRecord({ tamperCheck: "manifest-only" }) },
  },
  { label: "missing verification", overrides: { run: null } },
  { label: "failed run", overrides: { result: "fail" } },
])(
  "$label cannot prove matching content [4.0c#3]",
  async ({ overrides }) => {
    const f = await setup();
    writeLedger(f.registry, [{ ...f.record, ...overrides }]);
    const { index } = await build(f);
    expect(index.entries).toEqual([]);
  },
  30_000,
);

test.each(["other", "none"])(
  "recorded agent %s proves without losing its identity [4.0c#4]",
  async (agent) => {
    const f = await setup();
    // LedgerRecord currently restricts agents to adapters; the plan explicitly widens this input.
    writeLedger(f.registry, [{ ...f.record, agent, run: runRecord({ agent: "other" }) }]);
    const { index } = await build(f);
    expect(named(index.entries, "stack", "sample").lastRun).toEqual({
      date: f.record.date,
      result: "pass",
      agent,
      preset: f.record.preset,
      minutesToGreen: f.record.minutesToGreen,
      fingerprint: f.record.fingerprint,
    });
  },
  30_000,
);

test("changed stack and fragment carry old proof and every old bundle [4.0c#5]", async () => {
  const f = await setup();
  const previous = join(f.root, "previous");
  const old = await build(f, "none", previous);
  const oldStack = named(old.index.entries, "stack", "sample");
  const oldTools = named(old.index.entries, "fragment", "tools");
  const stackFile = join(entryPath(f.registry, "stack", "sample"), "STACK.md");
  writeFileSync(stackFile, `${readFileSync(stackFile, "utf8")}\nChanged stack guidance.\n`);
  const fragmentFile = join(entryPath(f.registry, "fragment", "tools"), "FRAGMENT.md");
  writeFileSync(
    fragmentFile,
    `${readFileSync(fragmentFile, "utf8")}\nChanged fragment guidance.\n`,
  );
  expect(await compositionFingerprint(f.registry)).not.toBe(f.record.fingerprint);
  reviewSearchFixture(f.registry);
  const host = await serve(previous);
  try {
    const { index } = await build(f, `${host.url}/v1/index.json`);
    expect(named(index.entries, "stack", "sample")).toEqual(oldStack);
    expect(named(index.entries, "fragment", "tools")).toEqual(oldTools);
    for (const entry of [oldStack, oldTools]) {
      await assertBundle(f.out, entry);
      expect(readFileSync(bundleFile(f.out, entry), "utf8")).toBe(
        readFileSync(bundleFile(previous, entry), "utf8"),
      );
      expect(host.requests).toContain(`/${relative(previous, bundleFile(previous, entry))}`);
    }
    expect(named(index.entries, "fragment", "tools").digest).not.toBe(
      await digestOf(rawBundle(f.registry, "fragment", "tools")),
    );
  } finally {
    await host.close();
  }
}, 30_000);

test("never-proven stacks are omitted, including an entirely unproven registry [4.0c#6]", async () => {
  const f = await setup();
  const first = await build(f);
  expect(first.index.entries.some((entry: IndexEntry) => entry.id === "never-proven")).toBe(false);
  writeLedger(f.registry, []);
  const empty = await build(f);
  expect(empty.index.entries).toEqual([]);
}, 30_000);

test("shared fragments retain old and new proven digests when only one stack is re-proven [4.0c#5]", async () => {
  const f = await setup();
  const second = await proof(f.registry, {
    stack: "never-proven",
    fingerprint: await compositionFingerprint(f.registry, { stack: "never-proven" }),
  });
  writeLedger(f.registry, [f.record, second]);
  const previous = join(f.root, "previous");
  const old = await build(f, "none", previous);
  const oldSample = named(old.index.entries, "stack", "sample");
  const oldSecond = named(old.index.entries, "stack", "never-proven");
  const oldTools = named(old.index.entries, "fragment", "tools");
  const fragmentFile = join(entryPath(f.registry, "fragment", "tools"), "FRAGMENT.md");
  writeFileSync(fragmentFile, `${readFileSync(fragmentFile, "utf8")}\nNew shared guidance.\n`);
  reviewSearchFixture(f.registry);
  const updated = await proof(f.registry, { date: "2026-10-28" });
  writeLedger(f.registry, [f.record, second, updated]);
  const currentDigest = await digestOf(rawBundle(f.registry, "fragment", "tools"));
  expect(currentDigest).not.toBe(oldTools.digest);
  const host = await serve(previous);
  try {
    const { index } = await build(f, `${host.url}/v1/index.json`);
    const sample = named(index.entries, "stack", "sample");
    expect(sample.digest).toBe(oldSample.digest);
    expect(sample.composition).toEqual({ tools: currentDigest });
    expect(sample.lastRun).toEqual({
      date: updated.date,
      result: "pass",
      agent: updated.agent,
      preset: updated.preset,
      minutesToGreen: updated.minutesToGreen,
      fingerprint: updated.fingerprint,
    });
    expect(named(index.entries, "stack", "never-proven")).toEqual(oldSecond);
    expect(oldSecond.composition).toEqual({ tools: oldTools.digest });
    await assertBundle(f.out, oldTools);
    await assertBundle(f.out, { ...oldTools, digest: currentDigest });
    expect(host.requests).toContain(`/${relative(previous, bundleFile(previous, oldTools))}`);
  } finally {
    await host.close();
  }
}, 30_000);

test("invalid entry validation preserves an existing output byte for byte [4.0c#7]", async () => {
  const f = await setup();
  const before = preserve(f.out);
  const file = join(entryPath(f.registry, "stack", "sample"), "STACK.md");
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace("schema_version: 1", "schema_version: invalid"),
  );
  failed(await f.invoke(["--out", f.out, "--previous", "none", "--key", privateKey]));
  expect(snapshot(f.out)).toEqual(before);
}, 30_000);

test("a tampered carried bundle aborts without replacing output [4.0c#8] [4.0c#16]", async () => {
  const f = await setup();
  const previous = join(f.root, "previous");
  const old = await build(f, "none", previous);
  const entry = named(old.index.entries, "fragment", "tools");
  const file = bundleFile(previous, entry);
  const bundle = Schema.decodeUnknownSync(EntryBundle)(JSON.parse(readFileSync(file, "utf8")));
  writeFileSync(file, JSON.stringify({ ...bundle, files: [] }));
  writeLedger(f.registry, []);
  const before = preserve(f.out);
  const host = await serve(previous);
  try {
    const result = await f.invoke([
      "--out",
      f.out,
      "--previous",
      `${host.url}/v1/index.json`,
      "--key",
      privateKey,
    ]);
    failed(result);
    expect(result.stderr).toContain(`${entry.digest}.json`);
    expect(snapshot(f.out)).toEqual(before);
    expect(readFileSync(join(f.root, "unrelated"), "utf8")).toBe("keep sibling\n");
  } finally {
    await host.close();
  }
}, 30_000);

test("signing mode is required; unsigned output is inspectable but fails check [4.0c#9]", async () => {
  const f = await setup();
  failed(await f.invoke(["--out", f.out, "--previous", "none"]));
  expect(existsSync(f.out)).toBe(false);
  succeeded(await f.invoke(["--out", f.out, "--previous", "none", "--unsigned"]));
  const { envelope } = await readBuild(f.out);
  expect(envelope.signature).toBe("");
  const host = await serve(f.out);
  try {
    const result = await f.invoke(["--check", host.url]);
    failed(result);
    expect(result.stderr).toContain("v1/index.json");
  } finally {
    await host.close();
  }
}, 30_000);

test("check verifies a good host and names an index whose payload changed [4.0c#10]", async () => {
  const f = await setup();
  const { envelope } = await build(f);
  const host = await serve(f.out);
  try {
    succeeded(await f.invoke(["--check", host.url]));
    writeFileSync(
      join(f.out, "v1/index.json"),
      JSON.stringify({
        ...envelope,
        payload: envelope.payload.replace("sample name", "Sample name"),
      }),
    );
    expect(JSON.parse(readFileSync(join(f.out, "v1/index.json"), "utf8")).payload).not.toBe(
      envelope.payload,
    );
    const result = await f.invoke(["--check", host.url]);
    failed(result);
    expect(result.stderr).toContain("v1/index.json");
  } finally {
    await host.close();
  }
}, 30_000);

test("check rejects a tampered signed allowlist", async () => {
  const f = await setup();
  await build(f);
  const host = await serve(f.out);
  try {
    succeeded(await f.invoke(["--check", host.url]));
    const file = join(f.out, "v1/allowlist.json");
    const envelope = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...envelope, payload: `${envelope.payload} ` }));
    const result = await f.invoke(["--check", host.url]);
    failed(result);
    expect(result.stderr).toContain("v1/allowlist.json");
    expect(result.stderr).toContain("signature verification failed");
  } finally {
    await host.close();
  }
}, 30_000);

test("generated headers declare exactly the index, bundle and search cache rules [4.0c#11]", async () => {
  const f = await setup();
  await build(f);
  expect(
    readFileSync(join(f.out, "_headers"), "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  ).toEqual([
    "/v1/index.json",
    "Cache-Control: public, max-age=300, stale-while-revalidate=3600",
    "/v1/entries/*",
    "Cache-Control: public, max-age=31536000, immutable",
    "/v1/search.json",
    "Cache-Control: public, max-age=300, stale-while-revalidate=3600",
  ]);
}, 30_000);

test("optional fragments enter the index only with current proven compositions [4.0c#12]", async () => {
  const f = await setup();
  const optional = await proof(f.registry, {
    with: ["extra"],
    fingerprint: await compositionFingerprint(f.registry, { with: ["extra"] }),
  });
  writeLedger(f.registry, [f.record, optional]);
  const { index } = await build(f);
  const extra = named(index.entries, "fragment", "extra");
  expect(extra.digest).toBe(await digestOf(rawBundle(f.registry, "fragment", "extra")));
  await assertBundle(f.out, extra);
  expect(index.entries.some((entry: IndexEntry) => entry.id === "unproven")).toBe(false);
  const file = join(entryPath(f.registry, "fragment", "extra"), "FRAGMENT.md");
  writeFileSync(file, `${readFileSync(file, "utf8")}\nNew optional guidance.\n`);
  reviewSearchFixture(f.registry);
  const changed = await build(f);
  expect(changed.index.entries.some((entry: IndexEntry) => entry.id === "extra")).toBe(false);
}, 30_000);

test.each(["unknown key", "changed payload"])(
  "previous index with %s fails before publication [4.0c#13]",
  async (kind) => {
    const f = await setup();
    const previous = join(f.root, "previous");
    const { envelope } = await build(f, "none", previous);
    writeFileSync(
      join(previous, "v1/index.json"),
      JSON.stringify(
        kind === "unknown key"
          ? { ...envelope, keyId: "unknown" }
          : { ...envelope, payload: `${envelope.payload} ` },
      ),
    );
    const before = preserve(f.out);
    const host = await serve(previous);
    try {
      const result = await f.invoke([
        "--out",
        f.out,
        "--previous",
        `${host.url}/v1/index.json`,
        "--key",
        privateKey,
      ]);
      failed(result);
      expect(result.stderr).toContain("v1/index.json");
      expect(snapshot(f.out)).toEqual(before);
    } finally {
      await host.close();
    }
  },
  30_000,
);

test.each(["tampered", "missing"])(
  "check rejects a %s advertised bundle and names it [4.0c#13]",
  async (kind) => {
    const f = await setup();
    const { index } = await build(f);
    const entry = named(index.entries, "fragment", "tools");
    const file = bundleFile(f.out, entry);
    if (kind === "missing") rmSync(file);
    else
      writeFileSync(
        file,
        JSON.stringify({ ...rawBundle(f.registry, "fragment", "tools"), files: [] }),
      );
    const host = await serve(f.out);
    try {
      const result = await f.invoke(["--check", host.url]);
      failed(result);
      expect(result.stderr).toContain(`${entry.digest}.json`);
    } finally {
      await host.close();
    }
  },
  30_000,
);

test.each(["missing key", "untrusted key", "both signing modes", "missing previous"])(
  "%s refuses publication and preserves output [4.0c#14]",
  async (kind) => {
    const f = await setup();
    const before = preserve(f.out);
    const wrongKey = join(f.root, "wrong-key.pem");
    const pair = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    writeFileSync(wrongKey, pair.privateKey);
    const args = ["--out", f.out];
    if (kind !== "missing previous") args.push("--previous", "none");
    let key = privateKey;
    if (kind === "missing key") key = join(f.root, "absent.pem");
    if (kind === "untrusted key") key = wrongKey;
    args.push("--key", key);
    if (kind === "both signing modes") args.push("--unsigned");
    failed(await f.invoke(args));
    expect(snapshot(f.out)).toEqual(before);
  },
  30_000,
);

test("raw files preserve dotfiles, binary bytes, templates and executable bits [4.0c#15]", async () => {
  const f = await setup();
  const root = entryPath(f.registry, "stack", "sample");
  mkdirSync(join(root, "files"));
  writeFileSync(join(root, "files/.keep"), "");
  writeFileSync(join(root, "files/-notes café.txt"), "héllo\r\n");
  writeFileSync(join(root, "files/icon.bin"), Uint8Array.from([0, 255, 128, 13, 10]));
  writeFileSync(join(root, "files/README.md.tmpl"), "# {{ project_name }}\r\n");
  writeFileSync(join(root, "files/check.sh"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(root, "files/check.sh"), 0o755);
  writeLedger(f.registry, [await proof(f.registry)]);
  const { index } = await build(f);
  const entry = named(index.entries, "stack", "sample");
  const bundle = await assertBundle(f.out, entry);
  expect(entry.digest).toBe(await digestOf(rawBundle(f.registry, "stack", "sample")));
  expect(bundle.files.find((file) => file.path === "files/README.md.tmpl")?.content).toBe(
    "# {{ project_name }}\r\n",
  );
  expect(bundle.files.find((file) => file.path === "files/check.sh")?.executable).toBe(true);
}, 30_000);

test("a symlink inside an entry fails validation and leaves output intact [4.0c#15]", async () => {
  const f = await setup();
  symlinkSync(
    join(f.registry, "stacks/sample/STACK.md"),
    join(f.registry, "stacks/sample/linked.md"),
  );
  const before = preserve(f.out);
  failed(await f.invoke(["--out", f.out, "--previous", "none", "--key", privateKey]));
  expect(snapshot(f.out)).toEqual(before);
}, 30_000);

test("a successful rebuild replaces existing output and keeps siblings [4.0c#16]", async () => {
  const f = await setup();
  preserve(f.out);
  await build(f);
  expect(existsSync(join(f.out, "v1/entries/old/keep"))).toBe(false);
  expect(readFileSync(join(f.root, "unrelated"), "utf8")).toBe("keep sibling\n");
}, 30_000);

test("a warning-only registry cannot be published [4.0c#17]", async () => {
  const f = await setup();
  const file = join(f.registry, "stacks/sample/STACK.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("tags: [scripts]", "tags: []"));
  reviewSearchFixture(f.registry);
  writeLedger(f.registry, [await proof(f.registry)]);
  const validation = await runCli(["validate", "--json"], {
    home: join(f.root, "home"),
    host: { registry: f.registry, cwd: f.cli },
    env: { ...quiet, PATH: process.env.PATH },
  });
  expect(validation.status, validation.stderr).toBe(0);
  expect(validation.stderr).toBe("");
  const report = Schema.decodeUnknownSync(ValidateReport)(JSON.parse(validation.stdout));
  expect(
    report.findings
      .filter((finding) => finding.severity !== "note")
      .map(({ check, severity }) => ({ check, severity })),
  ).toEqual([{ check: "task-runner-tag", severity: "warning" }]);
  const before = preserve(f.out);
  failed(await f.invoke(["--out", f.out, "--previous", "none", "--key", privateKey]));
  expect(snapshot(f.out)).toEqual(before);
}, 30_000);

test("unrelated cwd and inherited git selectors do not change the registry or commit [4.0c#18]", async () => {
  const f = await setup();
  succeeded(
    await f.invoke(["--out", f.out, "--previous", "none", "--key", privateKey], {
      cwd: space.dir(),
      env: { GIT_DIR: join(f.root, "missing.git"), GIT_WORK_TREE: "/missing", AI_AGENT: "1" },
    }),
  );
  const { index } = await readBuild(f.out);
  expect(index.commit).toBe(f.commit);
  expect(named(index.entries, "stack", "sample").digest).toBe(
    await digestOf(rawBundle(f.registry, "stack", "sample")),
  );
}, 30_000);

test("the index credits each entry authors.json names, and no other", async () => {
  const f = await setup();
  writeFileSync(join(f.registry, "authors.json"), JSON.stringify({ "stack/sample": "octo-cat" }));
  const { index } = await build(f);
  expect(named(index.entries, "stack", "sample").author).toBe("octo-cat");
  expect(named(index.entries, "fragment", "tools")).not.toHaveProperty("author");
}, 30_000);
