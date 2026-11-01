import { cpSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Clock, Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach, expect, test } from "vitest";
import { ndjson, runCli } from "./helpers/cli";
import { emptyRegistry } from "./helpers/registry";
import {
  apiOptions,
  childSearch,
  clockedCli,
  decoded,
  officialHit,
  response,
  type SearchServer,
  searchServer,
  validResponse,
} from "./helpers/search-api";
import { fixtureRecord, hit } from "./helpers/search-command";
import { bundled, put } from "./helpers/search-metadata";
import { workspace } from "./helpers/verify";

const space = workspace();
let server: SearchServer;
let opts: ReturnType<typeof apiOptions>;
beforeEach(async () => {
  server = await searchServer();
  opts = apiOptions(space.dir(), server.url);
});
afterEach(async () => {
  await server?.close();
  space.release();
});
const args = ["search", "go cli", "--limit", "20", "--json"];
const lists = (value: ReturnType<typeof decoded>) => ({
  understood: value.understood,
  noStrongMatch: value.noStrongMatch,
  stacks: value.stacks,
  fragments: value.fragments,
});

test("API column decoding preserves the search JSON bytes for a hit without a run", async () => {
  const body = response([officialHit("go-cli")]);
  server.answer(body);
  const options = { ...opts, host: { ...opts.host, registry: emptyRegistry } };
  const result = await runCli(["search", "go cli", "--json"], options);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe(
    `${JSON.stringify({
      request: "go cli",
      ranking: "api",
      remote: "used",
      method: "lexical",
      understood: body.understood,
      noStrongMatch: false,
      stacks: body.stacks,
      fragments: [],
    })}\n`,
  );
  expect(body.stacks[0]?.evidence).toEqual({});
});

test("API hits replace official copies while user and project entries keep their local rank [4.5e#8]", async () => {
  const home = opts.home ?? "";
  const user = join(home, "config/stacks");
  const project = join(home, ".stacks");
  await fixtureRecord(user, "personal-cli", {
    search: {
      summary: "Personal Go CLI.",
      platforms: ["cli"],
      languages: ["go"],
      requests: ["go cli"],
    },
  });
  await fixtureRecord(project, "project-cli", {
    search: {
      summary: "Project Go CLI.",
      platforms: ["cli"],
      languages: ["go"],
      requests: ["go cli"],
    },
  });
  // A working copy has different guidance/card bytes from the bundled entry it shadows.
  cpSync(join(bundled, "stacks/go-cli"), join(user, "stacks/go-cli"), { recursive: true });
  const body = response([
    officialHit("go-cli"),
    officialHit("typescript-cli", { tier: "partial", score: 0.31 }),
  ]);
  server.answer(body);
  const local = decoded(await runCli([...args, "--local"], opts));
  const value = decoded(await runCli(args, opts));
  expect(value).toMatchObject({ ranking: "api", remote: "used", method: "lexical" });
  expect(value).not.toHaveProperty("remoteReason");
  expect(server.requests).toHaveLength(1);
  expect(server.requests[0]).toMatchObject({ method: "GET", url: { pathname: "/v1/search" } });
  expect(server.requests[0]?.url.searchParams.get("q")).toBe("go cli");
  expect(server.requests[0]?.url.searchParams.get("limit")).toBe("20");
  for (const id of ["personal-cli", "project-cli", "go-cli"])
    expect(hit(value.stacks, id)).toEqual(hit(local.stacks, id));
  expect(hit(value.stacks, "go-cli").origin).toBe("user");
  expect(hit(value.stacks, "project-cli").origin).toBe("project");
  expect(value.stacks.filter(({ id }) => id === "go-cli")).toHaveLength(1);
  expect(hit(value.stacks, "typescript-cli")).toEqual({
    ...body.stacks[1],
    evidence: hit(local.stacks, "typescript-cli").evidence,
  });
  await validResponse(body);
});

test("kind and limit reach the API and merged lists obey tier before score [4.5e#8]", async () => {
  const body = response([
    officialHit("go-cli", { tier: "partial", score: 0.99 }),
    officialHit("typescript-cli", { tier: "strong", score: 0.51 }),
    officialHit("go-tui", { tier: "partial", score: 0.98 }),
    officialHit("rust-cli", { tier: "partial", score: 0.98 }),
    officialHit("rust-tui", { tier: "partial", score: 0.98 }),
    officialHit("python-cli", { tier: "partial", score: 0.98 }),
    officialHit("java-cli", { tier: "partial", score: 0.98 }),
  ]);
  server.answer(body);
  const value = decoded(
    await runCli(["search", "cli", "--kind", "stack", "--limit", "1", "--json"], opts),
  );
  expect(value).toMatchObject({ ranking: "api", remote: "used", method: "lexical" });
  expect(value.stacks.map(({ id }) => id)).toEqual(["typescript-cli"]);
  expect(value.fragments).toEqual([]);
  expect(server.requests).toHaveLength(1);
  expect(server.requests[0]?.url.searchParams.get("kind")).toBe("stack");
  expect(server.requests[0]?.url.searchParams.get("limit")).toBe("1");
  await validResponse(body);
});

test("API fragments replace their bundled copies and evidence breaks equal-score ties [4.5e#8]", async () => {
  const body = response(
    [],
    [
      officialHit("clerk", { kind: "fragment", score: 0.6, appliesTo: [] }),
      officialHit("drizzle", {
        kind: "fragment",
        score: 0.6,
        appliesTo: [],
        evidence: { stats: { greenRateLower: 0.9, sample: 100, projects: 100, window: 28 } },
      }),
    ],
  );
  server.answer(body);
  const value = decoded(
    await runCli(["search", "auth", "--kind", "fragment", "--limit", "2", "--json"], opts),
  );
  expect(value).toMatchObject({ ranking: "api", remote: "used" });
  expect(value.stacks).toEqual([]);
  expect(value.fragments).toEqual([body.fragments[1], body.fragments[0]]);
  expect(server.requests).toHaveLength(1);
  expect(server.requests[0]?.url.searchParams.get("kind")).toBe("fragment");
  await validResponse(body);
});

test("local and API hits share one tier/trust order before the merged limit [4.5e#8]", async () => {
  const home = opts.home ?? "";
  const search = {
    summary: "A Go CLI.",
    platforms: ["cli"],
    languages: ["go"],
    requests: ["go cli"],
  };
  await fixtureRecord(join(home, "config/stacks"), "user-go", { search });
  await fixtureRecord(join(home, ".stacks"), "project-go", { search });
  const options = { ...opts, host: { ...opts.host, registry: emptyRegistry } };
  const local = decoded(await runCli([...args, "--offline"], options));
  expect(hit(local.stacks, "user-go")).toMatchObject({ tier: "strong", trusted: true });
  expect(hit(local.stacks, "project-go")).toMatchObject({ tier: "partial", trusted: false });
  expect(hit(local.stacks, "project-go").score).toBeGreaterThan(0.4);
  const body = response([
    officialHit("api-lower", { tier: "partial", score: 0.3 }),
    officialHit("api-higher", { tier: "partial", score: 0.4 }),
  ]);
  server.answer(body);
  const merged = decoded(await runCli(args, options));
  expect(merged).toMatchObject({ ranking: "api", remote: "used" });
  expect(merged.stacks.map(({ id }) => id)).toEqual([
    "user-go",
    "api-higher",
    "api-lower",
    "project-go",
  ]);
  const limited = decoded(await runCli(["search", "go cli", "--limit", "3", "--json"], options));
  expect(limited.stacks.map(({ id }) => id)).toEqual(["user-go", "api-higher", "api-lower"]);
  expect(server.requests).toHaveLength(2);
  await validResponse(body);
});

for (const mode of ["hold", "partial"] as const) {
  it.effect(`${mode} response falls back at 800 ms including reading the body [4.5e#9]`, () =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock;
      const local = decoded(
        yield* Effect.promise(() => clockedCli([...args, "--local"], opts, clock)),
      );
      server.mode(mode);
      let finished = false;
      const fiber = yield* Effect.promise((signal) =>
        clockedCli(args, { ...opts, signal }, clock),
      ).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            finished = true;
          }),
        ),
        Effect.forkChild,
      );
      yield* Effect.promise(() => expect.poll(() => server.requests.length).toBe(1));
      yield* TestClock.adjust("799 millis");
      expect(finished).toBe(false);
      yield* TestClock.adjust("1 millis");
      // Bound the real-I/O drain below 1,500 ms, so a native or virtual 1,500 ms timeout fails.
      yield* Effect.promise(() => expect.poll(() => finished, { timeout: 1_000 }).toBe(true));
      const value = decoded(yield* Fiber.join(fiber));
      expect(value).toMatchObject({ ranking: "local", remote: "unavailable" });
      expect(lists(value)).toEqual(lists(local));
      expect(server.requests).toHaveLength(1);
      const again = decoded(yield* Effect.promise(() => clockedCli(args, opts, clock)));
      expect(again).toMatchObject({ ranking: "local", remote: "off", remoteReason: "backoff" });
      expect(server.requests).toHaveLength(1);
    }),
  );
}

test("a fresh process observes search backoff and the index state stays intact [4.5e#9]", async () => {
  const home = opts.home ?? "";
  const indexState = join(home, "cache/stacks/index/state.json");
  const original = '{"sentinel":"existing index state"}\n';
  put(indexState, original);
  const isolated = decoded(await childSearch([...args, "--offline"], opts));
  expect(isolated.ranking).toBe("local");
  expect(server.requests).toEqual([]);
  server.mode("500");
  const request = "private-backoff-sentinel go cli";
  const first = decoded(await runCli(["search", request, "--json"], opts));
  expect(first).toMatchObject({ ranking: "local", remote: "unavailable" });
  expect(server.requests).toHaveLength(1);
  const files = readdirSync(home, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => path !== indexState);
  expect(files).toHaveLength(1);
  const statePath = files[0];
  if (!statePath) throw new Error("Search did not persist its backoff state");
  const bytes = readFileSync(statePath, "utf8");
  const state = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
    JSON.parse(bytes),
  );
  expect(Object.keys(state).length).toBeGreaterThan(0);
  expect(bytes).not.toContain("private-backoff-sentinel");
  const next = decoded(await childSearch(args, opts));
  expect(next).toMatchObject({ ranking: "local", remote: "off", remoteReason: "backoff" });
  expect(server.requests).toHaveLength(1);
  expect(readFileSync(indexState, "utf8")).toBe(original);
  const alternate = await searchServer();
  try {
    const changedUrl = decoded(
      await runCli(args, { ...opts, env: { ...opts.env, STACKS_DEV_API_URL: alternate.url } }),
    );
    expect(changedUrl).toMatchObject({ ranking: "api", remote: "used" });
    expect(alternate.requests).toHaveLength(1);
    expect(server.requests).toHaveLength(1);
    expect(readFileSync(indexState, "utf8")).toBe(original);
    await validResponse(response());
  } finally {
    await alternate.close();
  }
});

for (const mode of ["500", "invalid", "disconnect"] as const) {
  it.effect(
    `${mode} falls back once and persists backoff across invocations for ten minutes [4.5e#9]`,
    () =>
      Effect.gen(function* () {
        const clock = yield* Clock.Clock;
        const local = decoded(
          yield* Effect.promise(() => clockedCli([...args, "--local"], opts, clock)),
        );
        server.mode(mode);
        const first = decoded(yield* Effect.promise(() => clockedCli(args, opts, clock)));
        expect(first).toMatchObject({ ranking: "local", remote: "unavailable" });
        expect(lists(first)).toEqual(lists(local));
        expect(server.requests).toHaveLength(1);
        yield* TestClock.adjust("599999 millis");
        const second = decoded(yield* Effect.promise(() => clockedCli(args, opts, clock)));
        expect(second).toMatchObject({ ranking: "local", remote: "off", remoteReason: "backoff" });
        expect(server.requests).toHaveLength(1);
        yield* TestClock.adjust("1 millis");
        const body = response();
        server.answer(body);
        const retried = decoded(yield* Effect.promise(() => clockedCli(args, opts, clock)));
        expect(retried).toMatchObject({ ranking: "api", remote: "used" });
        expect(server.requests).toHaveLength(2);
        yield* Effect.promise(() => validResponse(body));
      }),
  );
}

test("agent output names unavailable API ranking exactly once [4.5e#9]", async () => {
  server.mode("500");
  const result = await runCli(["search", "go cli"], opts);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(
    result.stdout.split("\n").filter((line) => /ranked locally: API unavailable/i.test(line)),
  ).toHaveLength(1);
  expect(result.stdout).toContain("go-cli");
  expect(server.requests).toHaveLength(1);
});

test.each([
  { flags: ["--local"], env: {}, reason: "local_flag" },
  { flags: ["--offline"], env: {}, reason: "offline" },
  { flags: [], env: { STACKS_OFFLINE: "1" }, reason: "offline" },
  { flags: [], env: { DO_NOT_TRACK: "1" }, reason: "do_not_track" },
  { flags: [], env: { DO_NOT_TRACK: "yes" }, reason: "do_not_track" },
])("$reason opts out without HTTP [4.5e#10]", async ({ flags, env, reason }) => {
  const value = decoded(
    await runCli([...args, ...flags], { ...opts, env: { ...opts.env, ...env } }),
  );
  expect(value).toMatchObject({ ranking: "local", remote: "off", remoteReason: reason });
  expect(value).not.toHaveProperty("method");
  expect(value.stacks[0]?.id).toBe("go-cli");
  expect(server.requests).toEqual([]);
});

test.each(["", "0", "false"])("DO_NOT_TRACK=%j permits API ranking [4.5e#10]", async (value) => {
  const result = decoded(
    await runCli(args, { ...opts, env: { ...opts.env, DO_NOT_TRACK: value } }),
  );
  expect(result).toMatchObject({ ranking: "api", remote: "used" });
  expect(server.requests).toHaveLength(1);
  await validResponse(response());
});

test("API search logs lengths, result counts and remote outcome without request text [4.5e#11]", async () => {
  const request = "private-sentinel-栈 go cli";
  const log = join(opts.home ?? "", "search.log");
  const value = decoded(
    await runCli(["search", request, "--json"], {
      ...opts,
      env: { ...opts.env, LOG_LEVEL: "debug", STACKS_LOG_FILE: log },
    }),
  );
  expect(value).toMatchObject({ ranking: "api", remote: "used" });
  const bytes = readFileSync(log, "utf8");
  expect(bytes).not.toContain(request);
  expect(bytes).not.toContain("private-sentinel");
  expect(bytes).not.toContain(encodeURIComponent(request));
  expect(ndjson(bytes)).toContainEqual(
    expect.objectContaining({
      msg: "command",
      requestLength: String([...request].length),
      stacks: String(value.stacks.length),
      fragments: String(value.fragments.length),
      remote: "used",
    }),
  );
  expect(server.requests).toHaveLength(1);
  await validResponse(response());
});

test("query punctuation and Unicode survive URL encoding without injecting parameters [4.5e#14]", async () => {
  const request = "go cli &kind=fragment #café + 日本語";
  const value = decoded(await runCli(["search", request, "--limit", "3", "--json"], opts));
  expect(value).toMatchObject({ request, ranking: "api", remote: "used" });
  expect(server.requests).toHaveLength(1);
  const sent = server.requests[0];
  expect(sent?.url.pathname).toBe("/v1/search");
  expect(sent?.url.searchParams.get("q")).toBe(request);
  expect(sent?.url.hash).toBe("");
  expect([...(sent?.url.searchParams.keys() ?? [])].sort()).toEqual(["limit", "q"]);
  for (const encoded of ["%26", "%23", "%2B", "%C3%A9", "%E6%97%A5"])
    expect(sent?.raw.toUpperCase()).toContain(encoded.toUpperCase());
  await validResponse(response());
});

test("bundled entries absent from an older API remain locally ranked in both lists [4.5e#16]", async () => {
  const local = decoded(await runCli([...args, "--local"], opts));
  const body = response([officialHit("go-cli")]);
  server.answer(body);
  const value = decoded(await runCli(args, opts));
  expect(value).toMatchObject({ ranking: "api", remote: "used" });
  for (const row of local.stacks.filter(({ id }) => id !== "go-cli"))
    expect(hit(value.stacks, row.id)).toEqual(row);
  expect(value.fragments).toEqual(local.fragments);
  expect(hit(value.stacks, "go-cli")).toEqual({
    ...body.stacks[0],
    evidence: hit(local.stacks, "go-cli").evidence,
  });
  expect(server.requests).toHaveLength(1);
  await validResponse(body);
});
