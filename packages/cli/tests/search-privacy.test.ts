import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { StatsSummary } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { runCli } from "./helpers/cli";
import { emptyRegistry } from "./helpers/registry";
import { remoteCli, remoteServer, success } from "./helpers/remote-index";
import { fixtureRecord, hit, options, searched } from "./helpers/search-command";
import { put, readJson } from "./helpers/search-metadata";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
// 4.5e reports why the API wasn't asked, which differs by mode; the ranking must not.
const ranked = (stdout: string) => {
  const value = JSON.parse(stdout) as unknown;
  if (typeof value !== "object" || value === null) throw new Error("search printed no object");
  const rest = Object.entries(value).filter(([key]) => key !== "remote" && key !== "remoteReason");
  return digest(JSON.stringify(rest));
};

test("online, unreachable and offline search send no HTTP request and give identical rankings [4.5c#5]", async () => {
  const server = await remoteServer(space.dir());
  const home = space.dir();
  const opts = { ...options(home), home, server };
  const args = ["search", "an iOS health app", "--json"];
  let online: Awaited<ReturnType<typeof remoteCli>>;
  try {
    online = await remoteCli(args, opts);
    success(online);
    const offline = await remoteCli([...args, "--offline"], opts);
    success(offline);
    expect(ranked(offline.stdout)).toBe(ranked(online.stdout));
    expect(server.requests).toEqual([]);
  } finally {
    await server.close();
  }
  const unreachable = await remoteCli(args, opts);
  success(unreachable);
  expect(ranked(unreachable.stdout)).toBe(ranked(online.stdout));
});

test("search reads published cached stats and omits absent or unpublished summaries [4.5c#6]", async () => {
  const home = space.dir();
  const opts = options(home);
  const cached = join(home, "cache/stacks/stats/summary.json");
  const request = "go cli";
  const env = { ...opts?.env, XDG_CACHE_HOME: join(home, "cache") };
  const before = (await searched(request, { ...opts, env })).value;
  const wire = readJson(
    join(import.meta.dirname, "../../format/tests/fixtures/stats/summary.json"),
  );
  const summary = Schema.decodeUnknownSync(StatsSummary)(wire);
  put(cached, JSON.stringify(wire));
  const published = (await searched(request, { ...opts, env })).value;
  expect(hit(published.stacks, "go-cli").evidence.stats).toMatchObject({
    greenRateLower: 0.86,
    sample: 180,
    projects: 215,
    window: 28,
  });
  expect(published.statsPopulation).toBe("seeded development data");
  const stripStats = (value: typeof before) => {
    const { statsPopulation: _population, ...result } = value;
    return {
      ...result,
      stacks: value.stacks.map(({ evidence, ...row }) => {
        const { stats: _stats, ...rest } = evidence;
        return { ...row, evidence: rest };
      }),
    };
  };
  expect(stripStats(published)).toEqual(stripStats(before));
  put(cached, JSON.stringify(summary));
  expect((await searched(request, { ...opts, env })).value).toEqual(before);
  put(
    cached,
    JSON.stringify(
      Schema.encodeUnknownSync(StatsSummary)({
        ...summary,
        published: false,
        items: [{ id: "go-cli", kind: "stack" }],
      }),
    ),
  );
  expect((await searched(request, { ...opts, env })).value).toEqual(before);
  rmSync(cached);
  expect((await searched(request, { ...opts, env })).value).toEqual(before);
});

test("successful search logs length and counts without storing the private request or telemetry [4.5c#12]", async () => {
  const home = space.dir();
  const log = join(home, "search.log");
  const request = "iOS privateprojectcanary secretworkflowcanary";
  const opts = options(home);
  const { value } = await searched(request, {
    ...opts,
    env: { ...opts?.env, LOG_LEVEL: "debug", STACKS_LOG_FILE: log },
  });
  const text = readFileSync(log, "utf8");
  expect(text).not.toContain("privateprojectcanary");
  expect(text).not.toContain("secretworkflowcanary");
  const records: unknown[] = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
  expect(records).toContainEqual(
    expect.objectContaining({
      msg: "command",
      requestLength: String(request.length),
      stacks: String(value.stacks.length),
      fragments: String(value.fragments.length),
    }),
  );
  const files = readdirSync(home, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(home, join(entry.parentPath, entry.name)))
    .sort();
  expect(files).toEqual(["search.log"]);
});

test("Next uses the first trusted hit and never offers new for an untrusted hit [4.5c#9a]", async () => {
  const home = space.dir();
  await fixtureRecord(join(home, "config/stacks"), "trusted-fallback", {
    search: {
      summary: "A weather station.",
      platforms: ["desktop"],
      requests: [],
      useCases: [],
      synonyms: [],
      goodFor: ["workout"],
    },
  });
  await fixtureRecord(join(home, ".stacks"), "untrusted-journal");
  const opts = options(home, emptyRegistry);
  const host = { ...opts?.host, invocation: "workspace-stacks" };
  const json = (await searched("iOS workout journal", { ...opts, host })).value;
  expect(json.stacks[0]).toMatchObject({
    id: "untrusted-journal",
    trusted: false,
    tier: "partial",
  });
  const text = await runCli(["search", "iOS workout journal"], { ...opts, host });
  expect(text.status).toBe(0);
  expect(text.stderr).toBe("");
  const next = text.stdout
    .split("\n")
    .filter((line) => line.startsWith("Next:"))
    .join("\n");
  expect(next).toMatch(
    /^Next:.*workspace-stacks show trusted-fallback.*workspace-stacks new trusted-fallback/,
  );
  expect(next).not.toContain("new untrusted-journal");
});

test("Next asks the user when every returned hit is untrusted [4.5c#9a]", async () => {
  const home = space.dir();
  await fixtureRecord(join(home, ".stacks"), "untrusted-journal");
  const text = await runCli(["search", "iOS workout journal"], options(home, emptyRegistry));
  expect(text.status).toBe(0);
  expect(text.stderr).toBe("");
  const next = text.stdout
    .split("\n")
    .filter((line) => line.startsWith("Next:"))
    .join("\n");
  expect(next).toMatch(/^Next:.*ask.*user/im);
  expect(next).not.toMatch(/\bnew\b/);
});
