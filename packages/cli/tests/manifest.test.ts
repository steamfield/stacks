import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ManifestStep } from "@steamfield/stacks-format";
import { Effect, Exit, Random } from "effect";
import { afterEach, expect, test } from "vitest";
import { canonicalJson } from "../src/core/canonical-json";
import {
  buildManifest,
  type DigestInput,
  digestSteps,
  encodeManifest,
  MANIFEST_PATH,
  readManifest,
} from "../src/core/manifest";
import { InvalidConfig, NotFound, PermissionDenied } from "../src/errors";
import { quiet, runCli, tempDir, terminal } from "./helpers/cli";
import { composition, manifestOf, runWith, succeed } from "./helpers/state";

const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});
function temp() {
  const dir = tempDir();
  dirs.push(dir);
  return dir.path;
}
const asRoot = process.getuid?.() === 0;

test("a manifest built from a real composition writes, reads back unchanged and carries its digest", async () => {
  const manifest = await manifestOf({ preset: "sandbox" }, 4321);
  const project = temp();
  mkdirSync(join(project, ".stacks"));
  const path = join(project, MANIFEST_PATH);
  writeFileSync(path, encodeManifest(manifest));
  const read = await succeed(runWith(readManifest(path)));
  expect(read).toEqual(manifest);
  expect(read.verifyDigest).toBe(digestSteps(read));
  expect(read.verifyDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(read).toMatchObject({
    schemaVersion: 1,
    mode: "new",
    preset: "sandbox",
    agents: ["claude"],
    stack: { id: "web-stack", origin: "bundled", trusted: true },
    briefWords: 4321,
  });
  expect(read.projectId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(Number.isNaN(Date.parse(read.createdAt))).toBe(false);
  expect(read).not.toHaveProperty("handoff");
  expect(read).not.toHaveProperty("fingerprint");
  // Two-space JSON with one trailing newline.
  expect(readFileSync(path, "utf8")).toMatch(/^\{\n {2}"schemaVersion": 1,[\s\S]*\}\n$/);
});

test("the manifest lists the composition's entries and steps in order, with defaults applied and owners by id", async () => {
  const composed = await composition();
  const manifest = await manifestOf();
  expect(manifest.fragments.map((ref) => ref.id)).toEqual(composed.fragments.map((f) => f.id));
  expect(manifest.env).toEqual(composed.env);
  expect(manifest.commands).toEqual(composed.commands);
  expect(manifest.verify.map((step) => step.name)).toEqual(composed.verify.map((s) => s.name));
  const web = manifest.verify.find((step) => step.name === "web");
  expect(web).toMatchObject({
    owner: "web-stack",
    phase: "serve",
    tags: [],
    timeout: "10m",
    expect: { http: expect.stringContaining("PORT_WEB"), within: "60s" },
  });
  const app = composed.app;
  expect(app).not.toBeNull();
  const appSteps = manifest.verify.filter((step) => step.owner === app?.id);
  expect(appSteps.length).toBeGreaterThan(0);
  for (const step of appSteps) expect(step.tags).toContain("app");
});

test("--sandbox marks prod steps skipByDefault; the default preset doesn't", async () => {
  const skipped = (preset: "default" | "sandbox") =>
    manifestOf({ preset }).then((manifest) =>
      manifest.verify.filter((step) => step.skipByDefault).map((step) => step.name),
    );
  expect(await skipped("sandbox")).toEqual(["deploy-dry-run"]);
  expect(await skipped("default")).toEqual([]);
});

test("a seeded Random gives the same project id; different seeds give different ids", async () => {
  const composed = await composition();
  const id = (seed: string) =>
    Effect.runPromise(
      buildManifest(composed, { briefWords: 1 }).pipe(
        Random.withSeed(seed),
        Effect.map((m) => m.projectId),
      ),
    );
  expect(await id("a")).toBe(await id("a"));
  expect(await id("a")).not.toBe(await id("b"));
});

const base: ManifestStep = {
  name: "web",
  run: "bun run dev",
  cwd: "app",
  phase: "serve",
  tags: ["prod", "app"],
  expect: { http: "http://localhost:3000/", within: "30s" },
  layer: "serve",
  timeout: "5m",
  owner: "web-stack",
  skipByDefault: false,
};
const input = (step: ManifestStep, rest: Partial<DigestInput> = {}): DigestInput => ({
  verify: [step, { name: "test", run: "bun test", owner: "web-stack", skipByDefault: false }],
  env: { PORT: "3000" },
  preset: "default",
  ...rest,
});
const digest = digestSteps(input(base));

test.each<[string, DigestInput]>([
  ["name", input({ ...base, name: "site" })],
  ["phase", input({ ...base, phase: "check", expect: base.expect })],
  ["layer", input({ ...base, layer: "build" })],
  ["run", input({ ...base, run: "bun run start" })],
  ["cwd", input({ ...base, cwd: "web" })],
  ["cwd removed", input((({ cwd: _cwd, ...rest }) => rest)(base))],
  ["tags", input({ ...base, tags: ["prod", "app", "slow"] })],
  ["the app tag removed", input({ ...base, tags: ["prod"] })],
  ["expect.http", input({ ...base, expect: { http: "http://localhost:4000/", within: "30s" } })],
  ["expect.within", input({ ...base, expect: { http: "http://localhost:3000/", within: "90s" } })],
  ["timeout", input({ ...base, timeout: "6m" })],
  ["skipByDefault", input({ ...base, skipByDefault: true })],
  ["an env value", input(base, { env: { PORT: "3001" } })],
  ["an env key added", input(base, { env: { PORT: "3000", HOST: "0.0.0.0" } })],
  ["preset", input(base, { preset: "sandbox" })],
  [
    "step order",
    {
      ...input(base),
      verify: [...input(base).verify].reverse(),
    },
  ],
])("changing %s changes the digest [1.2b#3]", (_field, changed) => {
  expect(digestSteps(changed)).not.toBe(digest);
});

test("key order, owner, later manifest fields and explicit defaults leave the digest alone [1.2b#3]", async () => {
  const reordered = Object.fromEntries(Object.entries(base).reverse()) as ManifestStep;
  expect(digestSteps(input(reordered))).toBe(digest);
  expect(digestSteps(input({ ...base, owner: "someone-else" }))).toBe(digest);
  const manifest = await manifestOf();
  const later = {
    ...manifest,
    handoff: { kind: "print" as const, at: "x" },
    fingerprint: "sha256:0",
  };
  expect(digestSteps(later)).toBe(manifest.verifyDigest);

  const bare: ManifestStep = {
    name: "web",
    run: "bun run dev",
    phase: "serve",
    expect: { http: "http://localhost:3000/" },
    owner: "web-stack",
    skipByDefault: false,
  };
  const explicit: ManifestStep = {
    ...bare,
    tags: [],
    timeout: "10m",
    expect: { http: "http://localhost:3000/", within: "60s" },
  };
  expect(digestSteps(input(explicit))).toBe(digestSteps(input(bare)));
  const check = { name: "t", run: "x", owner: "o", skipByDefault: false };
  expect(digestSteps(input(check))).toBe(digestSteps(input({ ...check, phase: "check" })));
});

test("canonical JSON sorts keys at every level and keeps array order", () => {
  expect(canonicalJson({ b: [2, 1], a: { d: 1, c: undefined, b: "x" } })).toBe(
    '{"a":{"b":"x","d":1},"b":[2,1]}',
  );
});

async function written(value: unknown, raw = false) {
  const path = join(temp(), "manifest.json");
  writeFileSync(path, raw ? String(value) : JSON.stringify(value));
  return { path, exit: await runWith(readManifest(path)) };
}
const encoded = async () =>
  JSON.parse(encodeManifest(await manifestOf())) as Record<string, unknown>;

test("forward reads: fields later sub-phases fill, mode add, stack null and a newer origin decode [1.2b#4]", async () => {
  const manifest = await encoded();
  const { exit } = await written({
    ...manifest,
    mode: "add",
    stack: null,
    fragments: [{ id: "from-git", origin: "source", trusted: false }],
    handoff: { kind: "launch", agent: "other", at: "2026-10-26T00:00:00.000Z" },
    fingerprint: "sha256:abc",
  });
  expect(Exit.isSuccess(exit)).toBe(true);
});

test("an unknown top-level key, bad JSON or a bad project id is InvalidConfig with the path [1.2b#4]", async () => {
  const manifest = await encoded();
  for (const value of [
    { ...manifest, extra: true },
    { ...manifest, projectId: "../../elsewhere" },
    { ...manifest, verify: [{ name: "x", run: "y" }] },
  ]) {
    const { path, exit } = await written(value);
    expect(exit).toEqual(Exit.fail(new InvalidConfig({ details: { path } })));
  }
  const { path, exit } = await written("{not json", true);
  expect(exit).toEqual(Exit.fail(new InvalidConfig({ details: { path } })));
});

test("a manifest from a newer stacks is InvalidConfig with its schemaVersion, even with new keys [1.2b#4]", async () => {
  const manifest = await encoded();
  const { path, exit } = await written({ ...manifest, schemaVersion: 2, newField: 1 });
  expect(exit).toEqual(Exit.fail(new InvalidConfig({ details: { path, schemaVersion: 2 } })));
});

test("a missing manifest is NotFound", async () => {
  const path = join(temp(), "manifest.json");
  expect(await runWith(readManifest(path))).toEqual(Exit.fail(new NotFound()));
});

test.skipIf(asRoot)("an unreadable manifest is PermissionDenied read", async () => {
  const path = join(temp(), "manifest.json");
  writeFileSync(path, "{}");
  chmodSync(path, 0o000);
  expect(await runWith(readManifest(path))).toEqual(
    Exit.fail(new PermissionDenied({ details: { reason: "read", path } })),
  );
});

test("InvalidConfig details reach the envelope, and human mode escapes the path and says to upgrade", async () => {
  const error = new InvalidConfig({
    details: { path: "/p/\u001b[31m/manifest.json", schemaVersion: 2 },
  });
  const json = await runCli(["--json"], { program: Effect.fail(error) });
  expect(json.status).toBe(3);
  expect(JSON.parse(json.stderr)).toEqual({
    error: {
      tag: "InvalidConfig",
      message: "Configuration is invalid.",
      retryable: false,
      next: "upgrade @steamfield/stacks, then run this command again.",
      details: { path: "/p/\u001b[31m/manifest.json", schemaVersion: 2 },
    },
  });
  const human = await runCli([], { program: Effect.fail(error), env: quiet, host: terminal });
  expect(human.stderr).toBe(
    "Configuration is invalid.\n  Path: /p/\\u001b[31m/manifest.json\n  Schema version: 2, from a newer stacks.\n  Next: upgrade @steamfield/stacks, then run this command again.\n",
  );
});
