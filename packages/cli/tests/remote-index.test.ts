import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { EntryBundle, type IndexEntry, StatsSummary } from "@steamfield/stacks-format";
import { Effect, Fiber, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import type { RemoteIndex } from "../src/core/registry/remote/service";
import { DoctorReport } from "../src/schemas/doctor";
import { LedgerLastRun } from "../src/schemas/ledger";
import { ListResult } from "../src/schemas/list";
import { NewResult } from "../src/schemas/new";
import type { RemoteStatus } from "../src/schemas/remote-index";
import { ShowReport } from "../src/schemas/show";
import { bundleFile, digestOf, entryPath, rawBundle, snapshot } from "./fixtures/index/harness";
import { fakeAgent } from "./helpers/agents";
import { tempDir } from "./helpers/cli";
import {
  buildRemoteFixture,
  cacheRoot,
  environment,
  execute,
  installRemotePackage,
  named,
  publish,
  type RemoteFixture,
  type RemoteServer,
  remoteCli,
  remoteLayer,
  remoteServer,
  success,
} from "./helpers/remote-index";
import { summary } from "./helpers/stats";
import { readManifestAt, splitEvents, workspace, writeRecordedProject } from "./helpers/verify";

const built = tempDir();
const space = workspace();
let fixture: RemoteFixture;
let installed: string;
let server: RemoteServer;
let home: string;
let root: string;
let bundled: string;

// Two signed builds, packing and an offline install happen once, rather than in each test.
// Give real Bun/git/npm child processes 90 s on a loaded test host.
beforeAll(async () => {
  fixture = await buildRemoteFixture(built.path);
  installed = await installRemotePackage(fixture);
}, 90_000);

beforeEach(async () => {
  root = space.dir();
  home = join(root, "home café with spaces");
  mkdirSync(home);
  cpSync(fixture.out, join(root, "published"), { recursive: true });
  bundled = join(root, "bundled");
  cpSync(fixture.bundled, bundled, { recursive: true });
  server = await remoteServer(join(root, "published"));
});

afterEach(async () => {
  await server?.close();
  space.release();
});
afterAll(() => built.cleanup());

const cli = (args: string[], options: Parameters<typeof remoteCli>[1] = { home, server }) =>
  remoteCli(args, { ...options, home, server, host: { registry: bundled, ...options.host } });

function list(result: Awaited<ReturnType<typeof cli>>) {
  success(result);
  return Schema.decodeUnknownSync(ListResult)(JSON.parse(result.stdout));
}
function row(result: ListResult, id = "sample") {
  const found = result.entries.find((entry) => entry.kind === "stack" && entry.id === id);
  expect(found, `Missing stack ${id}`).toBeDefined();
  return found;
}
function makeDifferentBundled() {
  const file = join(entryPath(bundled, "stack", "sample"), "STACK.md");
  writeFileSync(
    file,
    readFileSync(file, "utf8")
      .replace("sample name", "Bundled fallback")
      .replace("sample description.", "Bundled fallback description."),
  );
}
function listedProof() {
  return Schema.decodeUnknownSync(LedgerLastRun)(named(fixture.index, "stack", "sample").lastRun);
}
function readRemote(env: Parameters<typeof remoteLayer>[2] = {}) {
  return Effect.gen(function* () {
    const { RemoteIndex } = yield* Effect.promise(
      () => import("../src/core/registry/remote/service"),
    );
    const layer = yield* Effect.promise(() => remoteLayer(home, server, env));
    const program: Effect.Effect<
      { index: Option.Option<unknown>; status: RemoteStatus },
      unknown,
      RemoteIndex
    > = Effect.gen(function* () {
      const remote = yield* RemoteIndex;
      return { index: yield* remote.current, status: yield* remote.status };
    });
    return yield* program.pipe(Effect.provide(layer));
  });
}
function readBundle(entry: IndexEntry) {
  return Effect.gen(function* () {
    const { RemoteIndex } = yield* Effect.promise(
      () => import("../src/core/registry/remote/service"),
    );
    const layer = yield* Effect.promise(() => remoteLayer(home, server));
    const program: Effect.Effect<Option.Option<string>, unknown, RemoteIndex> = Effect.gen(
      function* () {
        return yield* (yield* RemoteIndex).bundle(entry);
      },
    );
    return yield* program.pipe(Effect.provide(layer));
  });
}
async function newProject(name: string, extra: string[] = []) {
  const target = join(root, name);
  const result = await cli([
    "new",
    "sample",
    target,
    "--sandbox",
    "--agents",
    "claude",
    "--no-launch",
    "--json",
    ...extra,
  ]);
  success(result);
  Schema.decodeUnknownSync(NewResult)(JSON.parse(result.stdout));
  return target;
}

test("fresh signed cache supplies an index-only stack and its ledger proof [4.0d#1]", async () => {
  rmSync(join(bundled, "stacks/sample"), { recursive: true });
  const first = list(await cli(["list", "--json"]));
  expect(row(first)).toMatchObject({
    origin: "index",
    trusted: true,
    lastRun: listedProof(),
  });
  expect(first.rejected).toEqual([]);
  const count = server.requests.length;
  expect(count).toBeGreaterThan(0);
  const second = list(await cli(["list", "--json"]));
  expect(second).toEqual(first);
  expect(server.requests).toHaveLength(count);
  const shown = await cli(["show", "sample", "--json"]);
  success(shown);
  expect(Schema.decodeUnknownSync(ShowReport)(JSON.parse(shown.stdout)).lastRun).toMatchObject(
    listedProof(),
  );
  const doctor = await cli(["doctor", "--json"]);
  success(doctor);
  const report = Schema.decodeUnknownSync(DoctorReport)(JSON.parse(doctor.stdout));
  expect(report).toHaveProperty(
    "remoteIndex",
    expect.objectContaining({
      isDefaultUrl: true,
      lastOutcome: "ok",
      offline: false,
      cachedAt: expect.any(String),
    }),
  );
});

test("the installed CLI stays on the bundled registry without an index URL", async () => {
  const env = { ...environment(home), STACKS_REGISTRY_DIR: bundled };
  // Route the installed binary's HTTP through loopback, including its release API requests.
  const preload = join(root, "loopback.mjs");
  writeFileSync(
    preload,
    `const fetchLocal = globalThis.fetch;
globalThis.fetch = (url, init) =>
  fetchLocal(new URL(new URL(url).pathname, ${JSON.stringify(server.url)}), init);
`,
  );
  const run = (command: string) =>
    execute(process.execPath, ["--import", preload, installed, command, "--json"], home, env);
  const listed = list(await run("list"));
  expect(row(listed)).toMatchObject({ origin: "bundled" });
  expect(listed.entries.every((entry) => entry.origin !== "index")).toBe(true);
  const doctor = await run("doctor");
  success(doctor);
  expect(
    server.requests.filter((path) => !["/v1/allowlist.json", "/v1/stats"].includes(path)),
  ).toEqual([]);
  const report = Schema.decodeUnknownSync(DoctorReport, { onExcessProperty: "error" })(
    JSON.parse(doctor.stdout),
  );
  expect(report.remoteIndex).toEqual({
    url: null,
    isDefaultUrl: false,
    offline: false,
    cachedAt: null,
    lastAttempt: null,
    lastOutcome: null,
    backoffUntil: null,
  });
});

it.effect("the cache stays fresh for 24 hours, then returns the refreshed index [4.0d#1]", () =>
  Effect.gen(function* () {
    publish(join(root, "published"), fixture.envelope, fixture.old);
    const first = yield* readRemote();
    expect(Option.isSome(first.index)).toBe(true);
    expect(server.requests).toHaveLength(1);
    publish(join(root, "published"), fixture.envelope);
    yield* TestClock.adjust("86399999 millis");
    expect((yield* readRemote()).index).toEqual(first.index);
    expect(server.requests).toHaveLength(1);
    yield* TestClock.adjust("1 millis");
    const refreshed = yield* readRemote();
    expect(Option.isSome(refreshed.index)).toBe(true);
    expect(refreshed.index).not.toEqual(first.index);
    expect(refreshed.status.lastOutcome).toBe("ok");
    expect(server.requests).toHaveLength(2);
  }),
);

it.effect("one changed signed byte is ignored and leaves the good cache intact [4.0d#2]", () =>
  Effect.gen(function* () {
    const good = yield* readRemote();
    expect(Option.isSome(good.index)).toBe(true);
    const cached = readFileSync(join(cacheRoot(home), "index.json"), "utf8");
    writeFileSync(
      join(root, "published/v1/index.json"),
      JSON.stringify({
        ...fixture.envelope,
        payload: fixture.envelope.payload.replace("sample name", "Sample name"),
      }),
    );
    yield* TestClock.adjust("24 hours");
    const rejected = yield* readRemote();
    expect(rejected.status.lastOutcome).toBe("signature");
    expect(readFileSync(join(cacheRoot(home), "index.json"), "utf8")).toBe(cached);
    expect(Option.isSome(rejected.index)).toBe(true);
    expect(rejected.index).toEqual(good.index);
  }),
);

test.each([
  { kind: "signature", outcome: "signature" },
  { kind: "keyId", outcome: "signature" },
  { kind: "json", outcome: "invalid" },
])("a bad $kind falls back to bundled with $outcome status [4.0d#2]", async ({ kind, outcome }) => {
  const envelope = { ...fixture.envelope };
  if (kind === "signature") envelope.signature = Buffer.alloc(64).toString("base64");
  if (kind === "keyId") envelope.keyId = "unknown-key";
  writeFileSync(
    join(root, "published/v1/index.json"),
    kind === "json" ? "{broken" : JSON.stringify(envelope),
  );
  expect(row(list(await cli(["list", "--json"])))).toMatchObject({ origin: "bundled" });
  const result = await cli(["doctor", "--json"]);
  success(result);
  expect(JSON.parse(result.stdout)).toHaveProperty("remoteIndex.lastOutcome", outcome);
});

test.each([
  { signature: "valid", origin: "index" },
  { signature: "invalid", origin: "bundled" },
])(
  "an explicit official URL ($signature signature) uses the $origin stack",
  async ({ signature, origin }) => {
    const doctor = await cli(["doctor", "--json"]);
    success(doctor);
    const { url } = Schema.decodeUnknownSync(DoctorReport)(JSON.parse(doctor.stdout)).remoteIndex;
    if (url === null) throw new Error("Missing official fixture index URL");

    makeDifferentBundled();
    if (signature === "invalid") {
      writeFileSync(
        join(root, "published/v1/index.json"),
        JSON.stringify({ ...fixture.envelope, signature: Buffer.alloc(64).toString("base64") }),
      );
    }
    const result = list(
      await cli(["list", "--json"], { home, server, env: { STACKS_INDEX_URL: url } }),
    );
    expect(row(result)).toMatchObject({ origin, trusted: true });
  },
);

test.each([{ formatVersion: 2 }, { minCli: "99.0.0" }])(
  "unsupported payload %j uses bundled entries [4.0d#3]",
  async (change) => {
    publish(join(root, "published"), fixture.envelope, { ...fixture.index, ...change });
    expect(row(list(await cli(["list", "--json"])))).toMatchObject({ origin: "bundled" });
    const result = await cli(["doctor", "--json"]);
    success(result);
    expect(JSON.parse(result.stdout)).toHaveProperty("remoteIndex.lastOutcome", "unsupported");
  },
);

it.effect("a stalled HTTP response reaches its deadline and backs off ten minutes [4.0d#4]", () =>
  Effect.gen(function* () {
    yield* Effect.promise(() => import("../src/core/registry/remote/service"));
    server.mode("hold");
    const fiber = yield* readRemote().pipe(Effect.forkChild);
    yield* Effect.promise(() => expect.poll(() => server.requests.length).toBe(1));
    yield* TestClock.adjust("1500 millis");
    const timedOut = yield* Fiber.join(fiber);
    expect(timedOut.status.lastOutcome).toBe("timeout");
    expect(Option.isNone(timedOut.index)).toBe(true);
    yield* readRemote();
    expect(server.requests).toHaveLength(1);
    yield* TestClock.adjust("599999 millis");
    yield* readRemote();
    expect(server.requests).toHaveLength(1);
    yield* TestClock.adjust("1 millis");
    server.mode("files");
    expect(Option.isSome((yield* readRemote()).index)).toBe(true);
    expect(server.requests).toHaveLength(2);
  }),
);

test("list with a five-second response returns within 2.5 seconds and keeps exit zero [4.0d#4]", async () => {
  // A held response exceeds five seconds, without a timer that outlives the test.
  server.mode("hold");
  const start = performance.now();
  expect(row(list(await cli(["list", "--json"])))).toMatchObject({ origin: "bundled" });
  expect(performance.now() - start).toBeLessThan(2500);
  const count = server.requests.length;
  list(await cli(["list", "--json"]));
  expect(server.requests).toHaveLength(count);
});

it.effect("an uncached bundle download has the same deadline and backoff [4.0d#4]", () =>
  Effect.gen(function* () {
    expect(Option.isSome((yield* readRemote()).index)).toBe(true);
    const entry = named(fixture.index, "stack", "sample");
    const count = server.requests.length;
    server.mode("hold");
    const fiber = yield* readBundle(entry).pipe(Effect.forkChild);
    yield* Effect.promise(() => expect.poll(() => server.requests.length).toBe(count + 1));
    yield* TestClock.adjust("1500 millis");
    expect(Option.isNone(yield* Fiber.join(fiber))).toBe(true);
    expect(Option.isNone(yield* readBundle(entry))).toBe(true);
    expect(server.requests).toHaveLength(count + 1);
    yield* TestClock.adjust("599999 millis");
    expect(Option.isNone(yield* readBundle(entry))).toBe(true);
    expect(server.requests).toHaveLength(count + 1);
    yield* TestClock.adjust("1 millis");
    server.mode("files");
    expect(Option.isSome(yield* readBundle(entry))).toBe(true);
    expect(server.requests).toHaveLength(count + 2);
  }),
);

it.effect("404 waits a full day before trying again [4.0d#5]", () =>
  Effect.gen(function* () {
    server.mode("not_found");
    const missing = yield* readRemote();
    expect(missing.status.lastOutcome).toBe("not_found");
    expect(Option.isNone(missing.index)).toBe(true);
    expect(server.requests).toHaveLength(1);
    yield* TestClock.adjust("86399999 millis");
    yield* readRemote();
    expect(server.requests).toHaveLength(1);
    yield* TestClock.adjust("1 millis");
    server.mode("files");
    expect(Option.isSome((yield* readRemote()).index)).toBe(true);
    expect(server.requests).toHaveLength(2);
  }),
);

test("equal canonical bundle digests retain bundled identity [4.0d#6]", async () => {
  expect(row(list(await cli(["list", "--json"])))).toMatchObject({
    origin: "bundled",
    trusted: true,
  });
  expect(server.requests.length).toBeGreaterThan(0);
});

test("digest mismatch gives exactly the offline JSON result and one human warning [4.0d#7]", async () => {
  makeDifferentBundled();
  publish(join(root, "published"), fixture.envelope, fixture.old);
  const entry = named(fixture.index, "stack", "sample");
  const file = bundleFile(join(root, "published"), entry);
  const bundle = Schema.decodeUnknownSync(EntryBundle)(JSON.parse(readFileSync(file, "utf8")));
  expect(bundle.files.find((file) => file.path === "STACK.md")?.encoding).toBe("utf8");
  const changed: EntryBundle = {
    ...bundle,
    files: bundle.files.map((file) =>
      file.path === "STACK.md"
        ? {
            ...file,
            encoding: "utf8",
            content: `${file.content}\nChanged but still valid stack guidance.\n`,
          }
        : file,
    ),
  };
  expect(await digestOf(changed)).not.toBe(entry.digest);
  writeFileSync(file, JSON.stringify(changed));
  const offline = await cli(["list", "--offline", "--json"]);
  const online = await cli(["list", "--json"]);
  list(offline);
  list(online);
  expect(online.stdout).toBe(offline.stdout);
  rmSync(cacheRoot(home), { recursive: true, force: true });
  const human = await cli(["list"], {
    home,
    server,
    host: { stdoutIsTTY: true },
    env: { LOG_LEVEL: "warn" },
  });
  expect(human.status).toBe(0);
  expect(human.stdout).toContain("Bundled fallback");
  expect(human.stderr.trim().split("\n")).toHaveLength(1);
  expect(human.stderr).toMatch(/digest|integrity/i);
});

test.each([{ id: "Bad_Id" }, { digest: "%2e%2e" }])(
  "unchecked entry %j never becomes a bundle URL [4.0d#8]",
  async (change) => {
    publish(join(root, "published"), fixture.envelope, {
      ...fixture.index,
      entries: fixture.index.entries.map((entry) =>
        entry.id === "sample" ? { ...entry, ...change } : entry,
      ),
    });
    expect(row(list(await cli(["list", "--json"])))).toMatchObject({ origin: "bundled" });
    expect(
      server.requests.filter(
        (path) =>
          path.includes("Bad_Id") || path.includes("%2e") || path.includes("/stack/sample/"),
      ),
    ).toEqual([]);
  },
);

test("traversal in a bundle is rejected before extraction [4.0d#9]", async () => {
  makeDifferentBundled();
  const bundle = rawBundle(fixture.bundled, "stack", "sample");
  const unsafe: EntryBundle = {
    ...bundle,
    files: [
      ...bundle.files,
      { path: "../escaped", encoding: "utf8", content: "escape", executable: false },
    ],
  };
  const digest = await digestOf(unsafe);
  const entry = { ...named(fixture.index, "stack", "sample"), digest };
  const file = bundleFile(join(root, "published"), entry);
  writeFileSync(file, JSON.stringify(unsafe));
  publish(join(root, "published"), fixture.envelope, {
    ...fixture.index,
    entries: fixture.index.entries.map((value) =>
      value.kind === "stack" && value.id === "sample" ? entry : value,
    ),
  });
  expect(Schema.is(EntryBundle)(unsafe)).toBe(false);
  expect(row(list(await cli(["list", "--json"])))).toMatchObject({ origin: "bundled" });
  expect(Object.keys(snapshot(root)).filter((path) => path.endsWith("escaped"))).toEqual([]);
  expect(existsSync(join(cacheRoot(home), "entries", digest))).toBe(false);
});

test("new uses the stack's proven fragment digest rather than the newest tools [4.0d#10]", async () => {
  makeDifferentBundled();
  writeFileSync(join(bundled, "fragments/tools/files/pinned.txt"), "bundled tools\n");
  const target = await newProject("pinned project");
  expect(readFileSync(join(target, "pinned.txt"), "utf8")).toBe("proven old tools\n");
  expect(readManifestAt(target).stack).toMatchObject({ origin: "index", trusted: true });
  const oldTools = named(fixture.old, "fragment", "tools");
  const newTools = named(fixture.index, "fragment", "tools");
  expect(server.requests.some((path) => path.endsWith(`/tools/${oldTools.digest}.json`))).toBe(
    true,
  );
  expect(oldTools.digest).not.toBe(newTools.digest);
});

test("missing composition bundle falls back as a whole and optional add reads the index [4.0d#10]", async () => {
  makeDifferentBundled();
  writeFileSync(join(bundled, "fragments/tools/files/pinned.txt"), "bundled tools\n");
  rmSync(join(bundled, "fragments/extra"), { recursive: true });
  rmSync(bundleFile(join(root, "published"), named(fixture.old, "fragment", "tools")));
  const target = await newProject("fallback project");
  expect(readManifestAt(target).stack).toMatchObject({ origin: "bundled" });
  expect(readFileSync(join(target, "pinned.txt"), "utf8")).toBe("bundled tools\n");
  expect(readManifestAt(target).fragments.every((entry) => entry.origin === "bundled")).toBe(true);
  const result = await cli(["add", "extra", "--dir", target, "--no-launch", "--json"]);
  success(result);
  expect(readManifestAt(target).fragments.find((entry) => entry.id === "extra")).toMatchObject({
    origin: "index",
  });
});

test("non-default URL is untrusted and never launches an available agent [4.0d#11]", async () => {
  makeDifferentBundled();
  writeFileSync(
    join(root, "published/v1/index.json"),
    JSON.stringify({ ...fixture.envelope, signature: "" }),
  );
  const bin = join(root, "bin");
  mkdirSync(bin);
  const marker = join(root, "launched");
  writeFileSync(join(bin, "claude"), `#!/bin/sh\nprintf launched > '${marker}'\n`);
  chmodSync(join(bin, "claude"), 0o755);
  const env = {
    STACKS_INDEX_URL: `${server.url}/v1/index.json`,
    PATH: `${bin}:${process.env.PATH}`,
  };
  const entries = list(await cli(["list", "--json"], { home, server, env }));
  expect(row(entries)).toMatchObject({ origin: "index", trusted: false });
  const target = join(root, "untrusted");
  const result = await cli(
    ["new", "sample", target, "--sandbox", "--agents", "claude", "--launch", "claude"],
    {
      home,
      server,
      env,
      host: { stdoutIsTTY: true, stdinIsTTY: true },
    },
  );
  success(result);
  expect(readManifestAt(target).stack).toMatchObject({ origin: "index", trusted: false });
  expect(result.stdout).toMatch(/confirm|untrusted/i);
  expect(existsSync(marker)).toBe(false);
  expect(readFileSync(join(target, ".stacks/BRIEF.md"), "utf8")).toMatch(/confirm|untrusted/i);
});

test("new reports configured-index entries in both JSON untrusted lists", async () => {
  makeDifferentBundled();
  writeFileSync(join(bundled, "fragments/tools/files/pinned.txt"), "different bundled tools\n");
  const target = join(root, "untrusted-json");
  const result = await cli(["new", "sample", target, "--sandbox", "--json"], {
    home,
    server,
    env: { STACKS_INDEX_URL: `${server.url}/v1/index.json` },
  });
  success(result);
  const created = Schema.decodeUnknownSync(NewResult)(JSON.parse(result.stdout));
  expect(created.untrusted).toEqual([
    { id: "sample", kind: "stack", origin: "index", dir: expect.any(String) },
    { id: "tools", kind: "fragment", origin: "index", dir: expect.any(String) },
  ]);
  expect(created.handoff.untrusted).toEqual(["sample", "tools"]);
  expect(readManifestAt(target).stack).toMatchObject({ origin: "index", trusted: false });
});

test("new launches an available agent for an official-index stack", async () => {
  makeDifferentBundled();
  const bin = join(root, "bin");
  const agent = fakeAgent(bin, "claude");
  const target = join(root, "trusted");
  const result = await cli(["new", "sample", target, "--sandbox", "--launch", "claude"], {
    home,
    server,
    env: { PATH: bin },
    host: { stdoutIsTTY: true, stdinIsTTY: true },
  });
  success(result);
  expect(result.stdout).toContain("Launching");
  expect(agent.ran()).toBe(true);
  expect(readManifestAt(target)).toMatchObject({
    stack: { origin: "index", trusted: true },
    handoff: { kind: "launch", agent: "claude" },
  });
});

test.each([
  { source: "official", stats: true },
  { source: "configured", stats: false },
])("list reports stats=$stats for a stack served by the $source index", async ({ stats }) => {
  makeDifferentBundled();
  if (!summary.published) throw new Error("Expected published stats");
  const item = summary.items.find(({ id }) => id === "go-cli");
  if (!item) throw new Error("Missing published stack stats");
  writeFileSync(
    join(root, "published/v1/stats"),
    JSON.stringify(
      Schema.encodeSync(StatsSummary)({
        ...summary,
        items: [{ ...item, id: "sample" }],
      }),
    ),
  );
  const result = list(
    await cli(["list", "--json"], {
      home,
      server,
      apiUrl: server.url,
      env: stats ? {} : { STACKS_INDEX_URL: `${server.url}/v1/index.json` },
    }),
  );
  const stack = row(result);
  expect(stack).toMatchObject({ origin: "index", trusted: stats });
  if (stats) {
    expect(stack?.stats).toMatchObject({ projects: 215, greenRate: 0.91, sample: 180 });
  } else {
    expect(stack).not.toHaveProperty("stats");
  }
  expect(server.requests).toContain("/v1/index.json");
  expect(server.requests.includes("/v1/stats")).toBe(stats);
});

test.each(["flag", "env"])(
  "offline via %s uses cache without network and verify never refreshes [4.0d#12]",
  async (mode) => {
    makeDifferentBundled();
    list(await cli(["list", "--json"]));
    // Make cache stale without relying on wall time; verify must not refresh even then.
    const stateFile = join(cacheRoot(home), "state.json");
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    writeFileSync(stateFile, JSON.stringify({ ...state, cachedAt: "2000-01-01T00:00:00.000Z" }));
    server.requests.length = 0;
    const result =
      mode === "flag"
        ? await cli(["list", "--offline", "--json"])
        : await cli(["list", "--json"], { home, server, env: { STACKS_OFFLINE: "1" } });
    expect(row(list(result))).toMatchObject({ origin: "index" });
    const target = join(root, "verify-project");
    writeRecordedProject(target, home, []);
    const verified = await cli(["verify", "--json"], { home, server, host: { cwd: target } });
    expect(verified.status, verified.stderr).toBe(0);
    expect(JSON.parse(verified.stdout)).toHaveProperty("steps", []);
    expect(splitEvents(verified.stderr).rest).toBe("");
    expect(server.requests).toEqual([]);
  },
);

test("the offline-installed tarball under Node lists an index-only stack [4.0d#13]", async () => {
  const result = await execute(process.execPath, [installed, "list", "--json"], root, {
    ...environment(home),
    STACKS_INDEX_URL: `${server.url}/v1/index.json`,
  });
  expect(row(list(result))).toMatchObject({
    origin: "index",
    trusted: false,
    lastRun: listedProof(),
  });
  expect(server.requests).toContain("/v1/index.json");
});

test("corrupt cached envelope is verified again, even offline [4.0d#14]", async () => {
  makeDifferentBundled();
  list(await cli(["list", "--json"]));
  const file = join(cacheRoot(home), "index.json");
  const cached = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(
    file,
    JSON.stringify({ ...cached, payload: cached.payload.replace("sample name", "Sample name") }),
  );
  server.requests.length = 0;
  expect(row(list(await cli(["list", "--offline", "--json"])))).toMatchObject({
    origin: "bundled",
  });
  expect(server.requests).toEqual([]);
});

test("symlinked cache home with spaces and non-ASCII names works [4.0d#15]", async () => {
  const actual = join(root, "actual cache café");
  mkdirSync(actual);
  symlinkSync(actual, join(home, "cache"));
  makeDifferentBundled();
  expect(row(list(await cli(["list", "--json"])))).toMatchObject({ origin: "index" });
  expect(existsSync(join(actual, "stacks/index/index.json"))).toBe(true);
});

test("a file blocking cache creation still permits an in-memory index [4.0d#16]", async () => {
  writeFileSync(join(home, "cache"), "keep this file\n");
  makeDifferentBundled();
  expect(row(list(await cli(["list", "--json"])))).toMatchObject({ origin: "index" });
  expect(readFileSync(join(home, "cache"), "utf8")).toBe("keep this file\n");
});

test("a cache for another URL is ignored offline [4.0d#17]", async () => {
  makeDifferentBundled();
  list(await cli(["list", "--json"]));
  server.requests.length = 0;
  expect(
    row(
      list(
        await cli(["list", "--offline", "--json"], {
          home,
          server,
          env: { STACKS_INDEX_URL: `${server.url}/different/v1/index.json` },
        }),
      ),
    ),
  ).toMatchObject({ origin: "bundled" });
  expect(server.requests).toEqual([]);
});

test("a newer entry version skips only that entry [4.0d#18]", async () => {
  makeDifferentBundled();
  publish(join(root, "published"), fixture.envelope, {
    ...fixture.index,
    entries: fixture.index.entries.map((entry) =>
      entry.id === "sample" ? { ...entry, schemaVersion: 99 } : entry,
    ),
  });
  rmSync(join(bundled, "stacks/never-proven"), { recursive: true });
  const result = list(await cli(["list", "--json"]));
  expect(row(result)).toMatchObject({ origin: "bundled" });
  expect(row(result, "never-proven")).toMatchObject({ origin: "index" });
});

it.effect("network failure serves a stale verified cache and records backoff [4.0d#19]", () =>
  Effect.gen(function* () {
    expect(Option.isSome((yield* readRemote()).index)).toBe(true);
    yield* TestClock.adjust("24 hours");
    server.mode("network");
    const result = yield* readRemote();
    expect(Option.isSome(result.index)).toBe(true);
    expect(result.status.lastOutcome).toBe("network");
    expect(result.status.backoffUntil).not.toBeNull();
    const count = server.requests.length;
    yield* readRemote();
    expect(server.requests).toHaveLength(count);
  }),
);

test("project and user entries shadow the index while bundled-only entries survive [4.0d#20]", async () => {
  makeDifferentBundled();
  const user = join(home, "config/stacks");
  cpSync(join(bundled, "stacks/sample"), join(user, "stacks/sample"), { recursive: true });
  expect(row(list(await cli(["list", "--json"])))).toMatchObject({ origin: "user", trusted: true });
  const cwd = join(root, "project");
  cpSync(join(bundled, "stacks/sample"), join(cwd, ".stacks/stacks/sample"), { recursive: true });
  const result = list(await cli(["list", "--json"], { home, server, host: { cwd } }));
  expect(row(result)).toMatchObject({ origin: "project", trusted: false });
  expect(
    result.entries.some((entry) => entry.id === "unproven" && entry.origin === "bundled"),
  ).toBe(true);
});

it.effect(
  "interrupting a bundle download keeps verified cache and unrelated entries [4.0d#21]",
  () =>
    Effect.gen(function* () {
      const { RemoteIndex } = yield* Effect.promise(
        () => import("../src/core/registry/remote/service"),
      );
      const layer = yield* Effect.promise(() => remoteLayer(home, server));
      const program: Effect.Effect<void, unknown, RemoteIndex> = Effect.gen(function* () {
        const remote = yield* RemoteIndex;
        expect(Option.isSome(yield* remote.current)).toBe(true);
        const tools = named(fixture.index, "fragment", "tools");
        const preserved = yield* remote.bundle(tools);
        if (Option.isNone(preserved)) throw new Error("Fixture tools bundle was not cached");
        const before = snapshot(preserved.value);
        expect(Object.keys(before).length).toBeGreaterThan(0);
        const indexFile = join(cacheRoot(home), "index.json");
        const cached = readFileSync(indexFile, "utf8");
        const entries = join(cacheRoot(home), "entries");
        const directories = readdirSync(entries).sort();
        server.mode("partial");
        const entry = named(fixture.index, "stack", "sample");
        const fiber = yield* remote.bundle(entry).pipe(Effect.forkChild);
        yield* Effect.promise(() =>
          expect
            .poll(() => server.requests.some((path) => path.endsWith(`/${entry.digest}.json`)))
            .toBe(true),
        );
        yield* Fiber.interrupt(fiber);
        expect(readFileSync(indexFile, "utf8")).toBe(cached);
        expect(snapshot(preserved.value)).toEqual(before);
        expect(readdirSync(entries).sort()).toEqual(directories);
        const count = server.requests.length;
        const reread = yield* remote.bundle(tools);
        if (Option.isNone(reread)) throw new Error("Previously verified tools bundle was lost");
        expect(snapshot(reread.value)).toEqual(before);
        expect(server.requests).toHaveLength(count);
      });
      yield* program.pipe(Effect.provide(layer));
    }),
);
