import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { IndexEntry, type RegistryIndex } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  bundleFile,
  compositionFingerprint,
  digestOf,
  entryPath,
  fixture,
  privateKey,
  proof,
  rawBundle,
  readBuild,
  serve,
} from "./fixtures/index/harness";
import { tempDir } from "./helpers/cli";
import { writeLedger } from "./helpers/ledger";
import {
  named,
  publish,
  type RemoteServer,
  remoteCli,
  remoteServer,
  success,
} from "./helpers/remote-index";
import { reviewSearchFixture } from "./helpers/search-fixture";
import { readManifestAt, workspace } from "./helpers/verify";
import { workspaceRegistry } from "./helpers/workspace";

const GIT_ENV = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_AUTHOR_DATE: "2026-10-28T09:00:00Z",
  GIT_COMMITTER_DATE: "2026-10-28T09:00:00Z",
};
const PART_IDS = ["api-part", "web-part"] as const;

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Replaces `from` with `to` in a registry file, failing loudly when `from` isn't there. */
function replaceIn(registry: string, file: string, from: string, to: string) {
  const path = join(registry, file);
  const text = readFileSync(path, "utf8");
  if (!text.includes(from)) throw new Error(`${file} has no ${JSON.stringify(from)}`);
  writeFileSync(path, text.replace(from, to));
}

/**
 * The workspace fixture made publishable: `build:index` refuses a registry with any validate
 * warning, and the shared fixture keeps a few on purpose for other lanes (no typecheck step, an
 * overlay `db` can't use, an uncovered command, a pinned action version, dependencies with no
 * allowlist entry or card).
 */
function publishable(registry: string) {
  for (const id of ["pair", "api-part", "web-part"])
    replaceIn(
      registry,
      `stacks/${id}/STACK.md`,
      "verify:\n",
      'verify:\n  - { name: typecheck, layer: typecheck, run: "true" }\n',
    );
  rmSync(join(registry, "fragments/db/stacks/web-part"), { recursive: true });
  replaceIn(
    registry,
    "fragments/db/FRAGMENT.md",
    "commands:\n  db-up: Start the local database\n",
    "",
  );
  replaceIn(registry, "fragments/root-ci/files/.github/workflows/ci.yml", "@v4", "");
  for (const [file, deps] of [
    ["stacks/api-part/STACK.md", "deps:\n  dev: [tsx]\n  runtime: [hono]\n"],
    ["stacks/web-part/STACK.md", "deps:\n  dev: [vitest]\n"],
    ["fragments/db/FRAGMENT.md", "deps:\n  backend: [pg]\n"],
  ] as const)
    replaceIn(registry, file, deps, "");
}

/** The index harness's registry plus the workspace fixture's entries, committed. */
async function workspaceFixture(dir: string): Promise<Fixture> {
  const f = await fixture(dir);
  for (const kind of ["stacks", "fragments"])
    cpSync(join(workspaceRegistry, kind), join(f.registry, kind), { recursive: true });
  publishable(f.registry);
  reviewSearchFixture(f.registry);
  commit(f, "fixture: workspace");
  return f;
}

function commit(f: Fixture, message: string) {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: f.root, env: GIT_ENV });
  git("add", "packages/cli/registry");
  git("commit", "--quiet", "-m", message);
}

/** `pair`'s proof over the registry as it is now, as a passing ledger record. */
async function pairProof(registry: string) {
  return proof(registry, {
    stack: "pair",
    fingerprint: await compositionFingerprint(registry, { stack: "pair" }),
  });
}

const digestOfEntry = (registry: string, id: string) => digestOf(rawBundle(registry, "stack", id));

async function expectedPins(registry: string) {
  return {
    backend: { stack: "api-part", digest: await digestOfEntry(registry, "api-part") },
    frontend: { stack: "web-part", digest: await digestOfEntry(registry, "web-part") },
  };
}

async function build(f: Fixture, out: string, args: string[]) {
  const result = await f.invoke(["--out", out, ...args], { timeout: 40_000 });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  return readBuild(out);
}

function expectNoFragmentPins(index: RegistryIndex) {
  for (const entry of index.entries.filter((item) => item.kind === "fragment")) {
    expect(entry).not.toHaveProperty("parts");
    expect(entry).not.toHaveProperty("composition");
  }
}

const built = tempDir();
const space = workspace();
let f: Fixture;
/** A signed build in which only `pair` (and the harness's `sample`) has a proof. */
let signed: { out: string; index: RegistryIndex };
let pairRecord: Awaited<ReturnType<typeof pairProof>>;

beforeAll(async () => {
  f = await workspaceFixture(built.path);
  pairRecord = await pairProof(f.registry);
  writeLedger(f.registry, [f.record, pairRecord]);
  commit(f, "fixture: pair proof");
  const out = join(f.root, "signed");
  signed = { out, index: (await build(f, out, ["--previous", "none", "--key", privateKey])).index };
}, 90_000);
afterAll(() => built.cleanup());
afterEach(() => space.release());

describe("building the index", () => {
  test("an unsigned build pins each part and publishes both part bundles", async () => {
    const out = join(space.dir(), "unsigned");
    const { index } = await build(f, out, [
      "--previous",
      "none",
      "--unsigned",
      "--include-unproven",
    ]);
    const pair = named(index, "stack", "pair");
    expect(pair.parts).toEqual(await expectedPins(f.registry));
    for (const id of PART_IDS) {
      const part = named(index, "stack", id);
      expect(part).not.toHaveProperty("parts");
      expect(existsSync(bundleFile(out, part))).toBe(true);
    }
    expectNoFragmentPins(index);
    expect(named(index, "stack", "sample")).not.toHaveProperty("parts");
  });

  test("a signed build where only pair is proven still publishes both part bundles", async () => {
    const pair = named(signed.index, "stack", "pair");
    expect(pair.lastRun?.fingerprint).toBe(
      await compositionFingerprint(f.registry, { stack: "pair" }),
    );
    expect(pair.parts).toEqual(await expectedPins(f.registry));
    for (const id of PART_IDS) {
      const part = named(signed.index, "stack", id);
      expect(part).not.toHaveProperty("lastRun");
      expect(part.digest).toBe(await digestOfEntry(f.registry, id));
      expect(existsSync(bundleFile(signed.out, part))).toBe(true);
      // A part's own pinned fragments are served too, so it can be composed on its own.
      for (const [fragment, digest] of Object.entries(part.composition ?? {}))
        expect(existsSync(bundleFile(signed.out, { kind: "fragment", id: fragment, digest }))).toBe(
          true,
        );
    }
    expectNoFragmentPins(signed.index);
  });

  test("a fragment index entry carrying pins does not decode", () => {
    const fragment = signed.index.entries.find((entry) => entry.kind === "fragment");
    if (fragment === undefined) throw new Error("No fragment in the signed build");
    const pinned = { ...fragment, parts: named(signed.index, "stack", "pair").parts };
    expect(Schema.is(IndexEntry)(pinned)).toBe(false);
  });

  /**
   * Changes api-part (staling pair's proof) and gives it a proof of its own; the returned
   * function restores the shared registry and ledger.
   */
  async function staleApiPart() {
    const source = join(entryPath(f.registry, "stack", "api-part"), "files/src/index.ts");
    const original = readFileSync(source, "utf8");
    writeFileSync(source, `${original}//\n`);
    const apiProof = await proof(f.registry, {
      stack: "api-part",
      fingerprint: await compositionFingerprint(f.registry, { stack: "api-part" }),
    });
    writeLedger(f.registry, [f.record, pairRecord, apiProof]);
    commit(f, "fixture: api-part changed");
    return () => {
      writeFileSync(source, original);
      writeLedger(f.registry, [f.record, pairRecord]);
      commit(f, "fixture: api-part restored");
    };
  }

  /** `--check` against a served build: the paths it fetched. */
  async function check(out: string) {
    const host = await serve(out);
    try {
      const result = await f.invoke(["--check", host.url]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      return host.requests;
    } finally {
      await host.close();
    }
  }

  test("a carried-forward pair keeps its old part bundle served, and --check fetches it", async () => {
    const dir = space.dir();
    const previous = join(dir, "previous");
    cpSync(signed.out, previous, { recursive: true });
    const oldPair = named(signed.index, "stack", "pair");
    const oldApi = {
      kind: "stack" as const,
      id: "api-part",
      digest: oldPair.parts?.backend?.digest,
    };
    expect(oldApi.digest).toBeDefined();
    const restore = await staleApiPart();
    const server = await serve(previous);
    const out = join(dir, "next");
    try {
      const { index } = await build(f, out, [
        "--previous",
        `${server.url}/v1/index.json`,
        "--key",
        privateKey,
      ]);
      expect(named(index, "stack", "pair")).toEqual(oldPair);
      const api = named(index, "stack", "api-part");
      expect(api.lastRun).toBeDefined();
      expect(api.digest).not.toBe(oldApi.digest);
      expect(existsSync(bundleFile(out, api))).toBe(true);
      expect(existsSync(bundleFile(out, { ...oldApi, digest: oldApi.digest ?? "" }))).toBe(true);
    } finally {
      await server.close();
      restore();
    }
    expect(await check(out)).toContain(`/v1/entries/stack/api-part/${oldApi.digest}.json`);
  }, 90_000);
});

describe("reading pinned parts", () => {
  let root: string;
  let home: string;
  let bundled: string;
  let published: string;
  let server: RemoteServer;

  beforeEach(async () => {
    root = space.dir();
    home = join(root, "home");
    mkdirSync(home);
    bundled = join(root, "bundled");
    cpSync(f.registry, bundled, { recursive: true });
    published = join(root, "published");
    cpSync(signed.out, published, { recursive: true });
    server = await remoteServer(published);
  });
  afterEach(async () => {
    await server?.close();
  });

  const MAIN = "files/src/main.ts";
  /** Marks a copy of `web-part` so the written `frontend/src/main.ts` shows which copy was used. */
  const mark = (registry: string, label: string) =>
    writeFileSync(join(entryPath(registry, "stack", "web-part"), MAIN), `// ${label}\n`);
  /** Makes the bundled `pair` differ from the index's, so the index copy is downloaded. */
  const driftPair = () =>
    appendFileSync(join(entryPath(bundled, "stack", "pair"), "STACK.md"), "\nBundled drift.\n");

  async function newPair() {
    const target = join(root, "project");
    const result = await remoteCli(
      ["new", "pair", target, "--sandbox", "--agents", "claude", "--no-launch", "--json"],
      { home, server, host: { registry: bundled } },
    );
    success(result);
    const manifest = readManifestAt(target);
    const origins = Object.fromEntries(
      (manifest.parts ?? []).map((part) => [part.name, part.stack.origin]),
    );
    return {
      main: readFileSync(join(target, "frontend/src/main.ts"), "utf8"),
      stack: manifest.stack?.origin,
      origins,
    };
  }
  const partRequests = () =>
    server.requests.filter((path) => path.startsWith("/v1/entries/stack/web-part/"));

  test("a pinned part whose bundled copy matches is used without a download", async () => {
    const original = readFileSync(join(entryPath(bundled, "stack", "web-part"), MAIN), "utf8");
    const result = await newPair();
    expect(result).toEqual({
      main: original,
      stack: "bundled",
      origins: { backend: "bundled", frontend: "bundled" },
    });
    expect(partRequests()).toEqual([]);
  });

  test("a pinned part whose bundled copy differs is downloaded", async () => {
    const original = readFileSync(join(entryPath(bundled, "stack", "web-part"), MAIN), "utf8");
    mark(bundled, "bundled drift");
    const result = await newPair();
    expect(result).toEqual({
      main: original,
      stack: "bundled",
      origins: { backend: "bundled", frontend: "index" },
    });
    expect(partRequests()).toHaveLength(1);
  });

  test("a missing pinned part bundle falls back to the whole bundled pair with its bundled parts", async () => {
    driftPair();
    // Only api-part's pinned bundle is missing; web-part's index copy is still served, and the
    // fallback must not compose it with the bundled pair.
    mark(bundled, "bundled copy");
    appendFileSync(join(entryPath(bundled, "stack", "api-part"), "files/src/index.ts"), "//\n");
    rmSync(bundleFile(published, named(signed.index, "stack", "api-part")));
    const result = await newPair();
    expect(result).toEqual({
      main: "// bundled copy\n",
      stack: "bundled",
      origins: { backend: "bundled", frontend: "bundled" },
    });
  });

  test("a pinned part bundle whose bytes don't match its digest falls back the same way", async () => {
    driftPair();
    mark(bundled, "bundled copy");
    const pinned = bundleFile(published, named(signed.index, "stack", "web-part"));
    writeFileSync(pinned, readFileSync(pinned, "utf8").replace("Web part", "Web parts"));
    const result = await newPair();
    expect(result).toEqual({
      main: "// bundled copy\n",
      stack: "bundled",
      origins: { backend: "bundled", frontend: "bundled" },
    });
  });

  /** Republishes the signed index with pair's `parts` pin replaced by `edit`'s result. */
  async function repinPair(edit: (parts: NonNullable<IndexEntry["parts"]>) => IndexEntry["parts"]) {
    const { envelope, index } = await readBuild(published);
    const entries = index.entries.map((entry) => {
      if (entry.kind !== "stack" || entry.id !== "pair") return entry;
      const { parts, ...rest } = entry;
      const next = edit(parts ?? {});
      return next === undefined ? rest : { ...rest, parts: next };
    });
    publish(published, envelope, { ...index, entries });
  }

  type Pins = NonNullable<IndexEntry["parts"]>;
  const edits: ReadonlyArray<[string, (parts: Pins) => Pins | undefined]> = [
    ["has no parts pin", () => undefined],
    [
      "misses a part name",
      (parts) => Object.fromEntries(Object.entries(parts).filter(([name]) => name !== "frontend")),
    ],
    [
      "pins a part to another stack id",
      (parts) => (parts.backend ? { ...parts, frontend: parts.backend } : parts),
    ],
  ];
  test.each(edits)(
    "an index workspace that %s composes the whole bundled pair",
    async (_, edit) => {
      driftPair();
      // The index web-part is still served; a pin that doesn't cover frontend must not reach it.
      mark(bundled, "bundled copy");
      await repinPair(edit);
      const result = await newPair();
      expect(result).toEqual({
        main: "// bundled copy\n",
        stack: "bundled",
        origins: { backend: "bundled", frontend: "bundled" },
      });
    },
  );

  test("a bundled fallback missing a part refuses rather than take the index's current part", async () => {
    driftPair();
    rmSync(entryPath(bundled, "stack", "web-part"), { recursive: true });
    rmSync(bundleFile(published, named(signed.index, "stack", "web-part")));
    const target = join(root, "project");
    const result = await remoteCli(
      ["new", "pair", target, "--sandbox", "--agents", "claude", "--no-launch", "--json"],
      { home, server, host: { registry: bundled } },
    );
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toMatchObject({
      tag: "EntryInvalid",
      details: { id: "pair", origin: "bundled", reason: "part_stack", part: "frontend" },
    });
    expect(existsSync(target)).toBe(false);
  });

  test("a user-root part overrides the pin", async () => {
    // The user root under the test's XDG_CONFIG_HOME (`environment` in the remote-index helper).
    const user = join(home, "config/stacks");
    mkdirSync(join(user, "stacks"), { recursive: true });
    cpSync(entryPath(bundled, "stack", "web-part"), join(user, "stacks/web-part"), {
      recursive: true,
    });
    mark(user, "user copy");
    const result = await newPair();
    expect(result).toEqual({
      main: "// user copy\n",
      stack: "bundled",
      origins: { backend: "bundled", frontend: "user" },
    });
  });
});
