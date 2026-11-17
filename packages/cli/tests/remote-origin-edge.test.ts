import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { RemoteIndex } from "../src/core/registry/remote/service";
import { bundleFile, digestOf, rawBundle } from "./fixtures/index/harness";
import { tempDir } from "./helpers/cli";
import {
  buildRemoteFixture,
  named,
  publish,
  type RemoteFixture,
  type RemoteServer,
  remoteCli,
  remoteLayer,
  remoteServer,
  success,
} from "./helpers/remote-index";
import { readManifestAt, workspace } from "./helpers/verify";

const built = tempDir();
const space = workspace();
let fixture: RemoteFixture;
let server: RemoteServer;
let root: string;
let home: string;
let bundled: string;
beforeAll(async () => {
  fixture = await buildRemoteFixture(built.path);
}, 90_000);
beforeEach(async () => {
  root = space.dir();
  home = join(root, "home");
  mkdirSync(home);
  bundled = join(root, "bundled");
  cpSync(fixture.bundled, bundled, { recursive: true });
  cpSync(fixture.out, join(root, "published"), { recursive: true });
  server = await remoteServer(join(root, "published"));
});
afterEach(async () => {
  await server?.close();
  space.release();
});
afterAll(() => built.cleanup());

const invoke = (args: string[]) => remoteCli(args, { home, server, host: { registry: bundled } });
const create = async () => {
  const target = join(root, "project");
  success(await invoke(["new", "sample", target, "--sandbox", "--no-launch", "--json"]));
  return target;
};

test("an unavailable stack bundle uses the complete bundled composition", async () => {
  const file = join(bundled, "stacks/sample/STACK.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("sample name", "Bundled fallback"));
  writeFileSync(join(bundled, "fragments/tools/files/pinned.txt"), "bundled tools\n");
  rmSync(bundleFile(join(root, "published"), named(fixture.index, "stack", "sample")));
  const target = await create();
  expect(readManifestAt(target).stack?.origin).toBe("bundled");
  expect(readFileSync(join(target, "pinned.txt"), "utf8")).toBe("bundled tools\n");
  expect(readManifestAt(target).fragments.every((entry) => entry.origin === "bundled")).toBe(true);
});

test("pinned fragments with the bundled digest retain bundled identity", async () => {
  const target = await create();
  expect(readManifestAt(target).fragments.find((entry) => entry.id === "tools")?.origin).toBe(
    "bundled",
  );
});

test("project fragments shadow pinned index defaults", async () => {
  const source = join(bundled, "fragments/tools");
  const target = join(home, ".stacks/fragments/tools");
  cpSync(source, target, { recursive: true });
  writeFileSync(join(target, "files/pinned.txt"), "project tools\n");
  const project = await create();
  expect(readFileSync(join(project, "pinned.txt"), "utf8")).toBe("project tools\n");
  expect(readManifestAt(project).fragments.find((entry) => entry.id === "tools")?.origin).toBe(
    "project",
  );
});

test("an invalid index URL never reaches HTTP, including direct bundle access", async () => {
  const layer = await remoteLayer(home, server, { STACKS_INDEX_URL: "not a URL" });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* RemoteIndex).bundle(named(fixture.index, "stack", "sample"));
    }).pipe(Effect.provide(layer)),
  );
  expect(Option.isNone(result)).toBe(true);
  expect(server.requests).toEqual([]);
});

// A stack's proof covers its own content; shared fragments are proven by the canaries.
test("a local fragment change keeps an index stack's proof current", async () => {
  const file = join(bundled, "stacks/sample/STACK.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("sample name", "Bundled fallback"));
  const tools = join(home, ".stacks/fragments/tools");
  cpSync(join(bundled, "fragments/tools"), tools, { recursive: true });
  writeFileSync(join(tools, "files/pinned.txt"), "project tools\n");
  const shown = await invoke(["show", "sample", "--json"]);
  success(shown);
  expect(JSON.parse(shown.stdout)).toMatchObject({
    origin: "index",
    lastRun: { sameContent: true },
  });
});

test("an index-only stack's show hint uses a command that can resolve it", async () => {
  rmSync(join(bundled, "stacks/sample"), { recursive: true });
  const shown = await invoke(["show", "sample"]);
  success(shown);
  expect(shown.stdout).toContain("Next: stacks new sample --dry-run --sandbox --no-launch");
  success(await invoke(["new", "sample", "--dry-run", "--sandbox", "--no-launch", "--json"]));
});

test("an advertised optional fragment stays available after a missing pinned bundle", async () => {
  const bundle = rawBundle(fixture.bundled, "fragment", "extra");
  const ref = {
    id: "extra",
    kind: "fragment" as const,
    schemaVersion: 1,
    name: "extra",
    description: "optional",
    tags: [],
    digest: await digestOf(bundle),
  };
  const file = bundleFile(join(root, "published"), ref);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(bundle));
  publish(join(root, "published"), fixture.envelope, {
    ...fixture.index,
    entries: [...fixture.index.entries, ref],
  });
  rmSync(join(bundled, "fragments/extra"), { recursive: true });
  writeFileSync(join(bundled, "fragments/tools/files/pinned.txt"), "bundled tools\n");
  rmSync(bundleFile(join(root, "published"), named(fixture.old, "fragment", "tools")));
  const target = await create();
  success(await invoke(["add", "extra", "--dir", target, "--no-launch", "--json"]));
  expect(readManifestAt(target).fragments.find((entry) => entry.id === "extra")?.origin).toBe(
    "index",
  );
});

test.each(["default", "with", "without"])(
  "historical pins work with %s selection when the current fragment schema is unsupported",
  async (selection) => {
    rmSync(join(bundled, "fragments/tools"), { recursive: true });
    publish(join(root, "published"), fixture.envelope, {
      ...fixture.index,
      entries: fixture.index.entries.map((entry) =>
        entry.kind === "fragment" && entry.id === "tools" ? { ...entry, schemaVersion: 99 } : entry,
      ),
    });
    const target = join(root, "project");
    const flags = selection === "default" ? [] : [`--${selection}`, "tools"];
    success(
      await invoke(["new", "sample", target, "--sandbox", "--no-launch", "--json", ...flags]),
    );
    if (selection === "without") expect(existsSync(join(target, "pinned.txt"))).toBe(false);
    else expect(readFileSync(join(target, "pinned.txt"), "utf8")).toBe("proven old tools\n");
  },
);

test.each(["new", "add"])(
  "%s uses the indexed optional fragment after bundled fallback",
  async (mode) => {
    const source = rawBundle(fixture.bundled, "fragment", "extra");
    const bundle = {
      ...source,
      files: [
        ...source.files,
        {
          path: "files/optional.txt",
          executable: false,
          encoding: "utf8" as const,
          content: "indexed optional\n",
        },
      ],
    };
    const ref = {
      id: "extra",
      kind: "fragment" as const,
      schemaVersion: 1,
      name: "extra",
      description: "optional",
      tags: [],
      digest: await digestOf(bundle),
    };
    const file = bundleFile(join(root, "published"), ref);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, JSON.stringify(bundle));
    publish(join(root, "published"), fixture.envelope, {
      ...fixture.index,
      entries: [...fixture.index.entries, ref],
    });
    mkdirSync(join(bundled, "fragments/extra/files"), { recursive: true });
    writeFileSync(join(bundled, "fragments/extra/files/optional.txt"), "bundled optional\n");
    const stackFile = join(bundled, "stacks/sample/STACK.md");
    writeFileSync(
      stackFile,
      readFileSync(stackFile, "utf8").replace("sample name", "Bundled fallback"),
    );
    rmSync(bundleFile(join(root, "published"), named(fixture.index, "stack", "sample")));
    const target = join(root, "project");
    success(
      await invoke([
        "new",
        "sample",
        target,
        "--sandbox",
        "--no-launch",
        "--json",
        ...(mode === "new" ? ["--with", "extra"] : []),
      ]),
    );
    if (mode === "add")
      success(await invoke(["add", "extra", "--dir", target, "--no-launch", "--json"]));
    expect(readFileSync(join(target, "optional.txt"), "utf8")).toBe("indexed optional\n");
  },
);

test.each(["project", "user"])(
  "%s shadows include the supported index without downloading its bundle",
  async (origin) => {
    const local = origin === "project" ? join(home, ".stacks") : join(home, "config/stacks");
    cpSync(join(bundled, "stacks/sample"), join(local, "stacks/sample"), { recursive: true });
    const file = join(bundled, "stacks/sample/STACK.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("sample name", "Bundled fallback"));
    const result = await invoke(["list", "--json"]);
    success(result);
    expect(
      JSON.parse(result.stdout).entries.find(
        (entry: { kind: string; id: string }) => entry.kind === "stack" && entry.id === "sample",
      ),
    ).toMatchObject({ origin, shadows: ["index", "bundled"] });
    expect(server.requests.some((request) => request.includes("/stack/sample/"))).toBe(false);
  },
);

it.effect("index refresh backoff does not suppress available bundles from the stale index", () =>
  Effect.gen(function* () {
    const layer = yield* Effect.promise(() => remoteLayer(home, server));
    yield* Effect.gen(function* () {
      const remote = yield* RemoteIndex;
      expect(Option.isSome(yield* remote.current)).toBe(true);
      yield* TestClock.adjust("24 hours");
      server.mode("not_found");
      expect(Option.isSome(yield* remote.current)).toBe(true);
      expect((yield* remote.status).lastOutcome).toBe("not_found");
      server.mode("files");
      expect(Option.isSome(yield* remote.bundle(named(fixture.index, "stack", "sample")))).toBe(
        true,
      );
    }).pipe(Effect.provide(layer));
  }),
);

test("a bundled fragment change keeps a bundled stack's proof current", async () => {
  writeFileSync(join(bundled, "fragments/tools/files/pinned.txt"), "changed bundled tools\n");
  const shown = await invoke(["show", "sample", "--json"]);
  success(shown);
  expect(JSON.parse(shown.stdout)).toMatchObject({
    origin: "bundled",
    lastRun: { sameContent: true },
  });
});

async function stallUnrelated(): Promise<RemoteServer> {
  const requests: string[] = [];
  const http = createServer((request, response) => {
    const at = request.url ?? "/";
    requests.push(at);
    if (at.includes("/stack/never-proven/")) return;
    const file = join(root, "published", at);
    try {
      response.end(readFileSync(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    mode: () => {},
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()));
        http.closeAllConnections();
      }),
  };
}

test.each(["show", "new", "add"])("%s ignores an unrelated stalled bundle", async (command) => {
  const target = join(root, "project");
  if (command === "add")
    success(
      await invoke(["new", "sample", target, "--offline", "--sandbox", "--no-launch", "--json"]),
    );
  rmSync(join(bundled, "stacks/never-proven"), { recursive: true });
  await server.close();
  server = await stallUnrelated();
  const args =
    command === "show"
      ? ["show", "sample", "--json"]
      : [
          command,
          command === "new" ? "sample" : "extra",
          ...(command === "new" ? [target, "--sandbox"] : ["--dir", target]),
          "--no-launch",
          "--json",
        ];
  success(await invoke(args));
  expect(server.requests.some((request) => request.includes("/stack/never-proven/"))).toBe(false);
});
