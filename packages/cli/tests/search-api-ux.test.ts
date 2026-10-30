import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StatsSummary } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";
import { ErrorEnvelope } from "../src/errors";
import { runCli, terminal } from "./helpers/cli";
import { emptyRegistry } from "./helpers/registry";
import {
  apiOptions,
  decoded,
  officialHit,
  response,
  type SearchServer,
  searchServer,
} from "./helpers/search-api";
import { fixtureRecord } from "./helpers/search-command";
import { put } from "./helpers/search-metadata";
import { workspace } from "./helpers/verify";

const space = workspace();
let server: SearchServer;
beforeEach(async () => {
  server = await searchServer();
});
afterEach(async () => {
  await server?.close();
  space.release();
});

test.each([undefined, "stack", "fragment"] as const)(
  "merged noStrongMatch follows visible kinds (%s), not the API flag",
  async (kind) => {
    const opts = { ...apiOptions(space.dir(), server.url), host: { registry: emptyRegistry } };
    const flags = kind ? ["--kind", kind] : [];
    for (const strongKind of ["stack", "fragment"] as const) {
      const hit = officialHit("supported", { kind: strongKind });
      server.answer({
        ...response(strongKind === "stack" ? [hit] : [], strongKind === "fragment" ? [hit] : []),
        noStrongMatch: true,
      });
      const result = decoded(await runCli(["search", "supported", ...flags, "--json"], opts));
      expect(result.noStrongMatch).toBe(kind !== undefined && kind !== strongKind);
      expect(result.noStrongMatch).toBe(
        ![...result.stacks, ...result.fragments].some((row) => row.tier === "strong"),
      );
    }
  },
);

test.each([false, true])(
  "local fragment success has consistent text and JSON (human %s)",
  async (human) => {
    const opts = {
      ...apiOptions(space.dir(), server.url),
      ...(human
        ? { host: { ...terminal, registry: join(import.meta.dirname, "../registry") } }
        : {}),
    };
    const args = ["search", "migrate to Cloudflare Pages", "--local", "--kind", "fragment"];
    const json = decoded(await runCli([...args, "--json"], opts));
    expect(json.fragments[0]).toMatchObject({ id: "cloudflare-pages", tier: "strong" });
    expect(json.noStrongMatch).toBe(false);
    const text = await runCli(args, opts);
    expect(text.status).toBe(0);
    expect(text.stderr).toBe("");
    expect(text.stdout).toContain("cloudflare-pages");
    expect(text.stdout).not.toContain("Nothing fits strongly");
    expect(text.stdout).toMatch(
      /Next: stacks show cloudflare-pages, then stacks add cloudflare-pages\.\n?$/,
    );
  },
);

function cachedEvidence(home: string) {
  const wire = readFileSync(
    join(import.meta.dirname, "../../format/tests/fixtures/stats/summary.json"),
    "utf8",
  );
  put(join(home, "cache/stacks/stats/summary.json"), wire);
  const summary = Schema.decodeUnknownSync(Schema.fromJsonString(StatsSummary))(wire);
  if (!summary.published) throw new Error("Expected published stats fixture");
  return summary;
}

test("API hits retain missing local evidence and use it to break ties", async () => {
  const home = space.dir();
  cachedEvidence(home);
  const opts = apiOptions(home, server.url);
  const local = decoded(await runCli(["search", "go cli", "--local", "--json"], opts));
  const go = local.stacks.find(({ id }) => id === "go-cli");
  expect(go?.evidence).toMatchObject({
    stats: { greenRateLower: 0.86 },
    lastRun: { result: "pass" },
  });
  const body = response([officialHit("api-first"), officialHit("go-cli")]);
  server.answer(body);
  const merged = decoded(await runCli(["search", "go cli", "--json"], opts));
  expect(merged.stacks[0]).toEqual({ ...body.stacks[1], evidence: go?.evidence });
  expect(merged.stacks.find(({ id }) => id === "api-first")?.evidence).toEqual({});
  expect(server.requests).toHaveLength(1);
});

test.each(["stats", "lastRun", "both"] as const)(
  "API %s wins while the other evidence field falls back locally",
  async (field) => {
    const home = space.dir();
    cachedEvidence(home);
    const opts = apiOptions(home, server.url);
    const local = decoded(await runCli(["search", "go cli", "--local", "--json"], opts));
    const go = local.stacks.find(({ id }) => id === "go-cli");
    const evidence = {
      ...(field !== "lastRun"
        ? { stats: { greenRateLower: 0.5, sample: 10, projects: 20, window: 7 as const } }
        : {}),
      ...(field !== "stats" && go?.evidence.lastRun
        ? { lastRun: { ...go.evidence.lastRun, date: "2026-10-28" } }
        : {}),
    };
    server.answer(response([officialHit("go-cli", { evidence })]));
    const merged = decoded(await runCli(["search", "go cli", "--json"], opts));
    expect(merged.stacks.find(({ id }) => id === "go-cli")?.evidence).toEqual({
      ...go?.evidence,
      ...evidence,
    });
    expect(server.requests).toHaveLength(1);
  },
);

test("same-id stack evidence does not attach to an API fragment", async () => {
  const opts = apiOptions(space.dir(), server.url);
  server.answer(response([], [officialHit("go-cli", { kind: "fragment" })]));
  const merged = decoded(await runCli(["search", "go cli", "--json"], opts));
  expect(merged.fragments.find(({ id }) => id === "go-cli")?.evidence).toEqual({});
  expect(server.requests).toHaveLength(1);
});

test("API fragments retain local cached stats when their evidence is empty", async () => {
  const home = space.dir();
  const summary = cachedEvidence(home);
  const row = summary.items[0];
  if (!row) throw new Error("Missing published stats fixture");
  put(
    join(home, "cache/stacks/stats/summary.json"),
    JSON.stringify(
      Schema.encodeSync(StatsSummary)({
        ...summary,
        items: [{ ...row, id: "clerk", kind: "fragment" }],
      }),
    ),
  );
  const opts = apiOptions(home, server.url);
  const local = decoded(await runCli(["search", "auth", "--local", "--json"], opts));
  const clerk = local.fragments.find(({ id }) => id === "clerk");
  expect(clerk?.evidence.stats).toMatchObject({ greenRateLower: 0.86 });
  server.answer(response([], [officialHit("clerk", { kind: "fragment" })]));
  const merged = decoded(await runCli(["search", "auth", "--json"], opts));
  expect(merged.fragments.find(({ id }) => id === "clerk")?.evidence).toEqual({
    stats: clerk?.evidence.stats,
  });
  expect(server.requests).toHaveLength(1);
});

test("merged search keeps at most two weak stacks alongside a strong match", async () => {
  const opts = apiOptions(space.dir(), server.url);
  server.answer(
    response([
      officialHit("mobile-expo"),
      officialHit("api-weak-one", { tier: "weak", score: 0.2 }),
      officialHit("api-weak-two", { tier: "weak", score: 0.1 }),
    ]),
  );
  const args = ["search", "an iOS health app"];
  const json = decoded(await runCli([...args, "--json"], opts));
  expect(json.stacks).toHaveLength(3);
  expect(json.stacks.filter((hit) => hit.tier === "weak")).toHaveLength(2);
  const text = await runCli(args, opts);
  expect(text.status).toBe(0);
  expect(text.stderr).toBe("");
  expect(text.stdout.match(/^stack /gm)).toHaveLength(3);
});

test("a strong local entry absent from the API remains visible", async () => {
  const home = space.dir();
  const opts = apiOptions(home, server.url);
  opts.host = { ...opts.host, registry: emptyRegistry };
  await fixtureRecord(join(home, "config/stacks"), "local-go", {
    search: { platforms: ["cli"], languages: ["go"], requests: ["go cli"] },
  });
  server.answer(response([officialHit("api-go")]));
  const json = decoded(await runCli(["search", "go cli", "--json"], opts));
  expect(json.stacks.find((hit) => hit.id === "local-go")).toMatchObject({
    origin: "user",
    tier: "strong",
  });
});

test("fragment fit appears in text only when the fragment names targets", async () => {
  const opts = { ...apiOptions(space.dir(), server.url), host: { registry: emptyRegistry } };
  server.answer(
    response(
      [],
      [
        officialHit("clerk", { kind: "fragment", appliesTo: ["mobile-expo"] }),
        officialHit("shared-auth", { kind: "fragment", appliesTo: [] }),
      ],
    ),
  );
  const text = await runCli(["search", "auth"], opts);
  expect(text.status).toBe(0);
  expect(text.stderr).toBe("");
  expect(text.stdout).toContain("Applies to: mobile-expo");
  expect(text.stdout.match(/^Applies to:/gm)).toHaveLength(1);
});

test.each(["seeded development data", "stacks projects"] as const)(
  "API stats population %s labels shown evidence",
  async (statsPopulation) => {
    const opts = { ...apiOptions(space.dir(), server.url), host: { registry: emptyRegistry } };
    server.answer({
      ...response([
        officialHit("go-cli", {
          evidence: { stats: { greenRateLower: 0.78, sample: 10235, projects: 11695, window: 28 } },
        }),
      ]),
      statsPopulation,
    });
    const json = decoded(await runCli(["search", "go cli", "--json"], opts));
    expect(json.statsPopulation).toBe(statsPopulation);
    const text = await runCli(["search", "go cli"], opts);
    expect(text.status).toBe(0);
    expect(text.stderr).toBe("");
    expect(text.stdout).toContain(
      `Evidence: green lower 0.78, sample 10235${statsPopulation === "seeded development data" ? ", seeded" : ""}, 11695 projects / 28 days`,
    );
  },
);

test("cached seeded stats label local-only evidence", async () => {
  const home = space.dir();
  cachedEvidence(home);
  const opts = apiOptions(home, server.url);
  const json = decoded(await runCli(["search", "go cli", "--local", "--json"], opts));
  expect(json.statsPopulation).toBe("seeded development data");
  const text = await runCli(["search", "go cli", "--local"], opts);
  expect(text.status).toBe(0);
  expect(text.stderr).toBe("");
  expect(text.stdout).toMatch(/Evidence: green lower 0\.86, sample \d+, seeded,/);
});

test("seeded local fallback labels evidence when API stats are unseeded", async () => {
  const home = space.dir();
  cachedEvidence(home);
  const opts = apiOptions(home, server.url);
  server.answer(response([officialHit("go-cli")], [], "stacks projects"));
  const json = decoded(await runCli(["search", "go cli", "--json"], opts));
  expect(json.stacks.find((hit) => hit.id === "go-cli")?.evidence.stats).toBeDefined();
  expect(json.statsPopulation).toBe("seeded development data");
  const text = await runCli(["search", "go cli"], opts);
  expect(text.status).toBe(0);
  expect(text.stderr).toBe("");
  expect(text.stdout).toMatch(/Evidence: green lower 0\.86, sample \d+, seeded,/);
});

test("a population is absent when no shown hit has stats", async () => {
  const opts = { ...apiOptions(space.dir(), server.url), host: { registry: emptyRegistry } };
  server.answer(response([officialHit("go-cli")], [], "seeded development data"));
  const json = decoded(await runCli(["search", "go cli", "--json"], opts));
  expect(json.stacks).toHaveLength(1);
  expect(json.statsPopulation).toBeUndefined();
});

test("Why omits body matches when another field explains the hit", async () => {
  const opts = { ...apiOptions(space.dir(), server.url), host: { registry: emptyRegistry } };
  server.answer(
    response([
      officialHit("other-reason", {
        why: [
          { field: "body", matched: "body-only", from: "body-only" },
          { field: "summary", matched: "summary-match", from: "summary-match" },
        ],
      }),
      officialHit("body-only", {
        tier: "partial",
        why: [{ field: "body", matched: "only-body", from: "only-body" }],
      }),
    ]),
  );
  const text = await runCli(["search", "go cli"], opts);
  expect(text.status).toBe(0);
  expect(text.stderr).toBe("");
  expect(text.stdout).toContain("Why: summary-match (summary)");
  expect(text.stdout).not.toContain("body-only (body)");
  expect(text.stdout).toContain("Why: only-body (body)");
});

test("empty search lists end with browse and broader-search recovery in both text audiences", async () => {
  server.answer(response([], []));
  const opts = apiOptions(space.dir(), server.url);
  opts.host = { ...opts.host, registry: emptyRegistry };
  const json = decoded(await runCli(["search", "!!!", "--json"], opts));
  expect(json).toEqual({
    request: "!!!",
    ranking: "api",
    method: "lexical",
    remote: "used",
    understood: response().understood,
    noStrongMatch: true,
    stacks: [],
    fragments: [],
  });
  for (const host of [{}, terminal]) {
    const text = await runCli(["search", "!!!"], { ...opts, host: { ...opts.host, ...host } });
    expect(text.status).toBe(0);
    expect(text.stderr).toBe("");
    expect(text.stdout).toContain("Nothing matched.");
    expect(text.stdout.trimEnd()).toMatch(
      /Next: stacks list stacks\nNext: stacks search "<fewer, broader words>"$/,
    );
    expect(text.stdout).not.toMatch(/stacks (?:show|new)|weak match|confirm the fit/i);
  }
  expect(server.requests).toHaveLength(3);
});

test("weak-only search keeps confirmation and ends with invocation-aware recovery", async () => {
  server.answer(response([officialHit("go-cli", { tier: "weak" })]));
  const opts = apiOptions(space.dir(), server.url);
  opts.host = { ...opts.host, registry: emptyRegistry };
  for (const host of [{}, terminal]) {
    const text = await runCli(["search", "cli"], {
      ...opts,
      host: { ...opts.host, ...host, invocation: "npx -y stacks@1.2.3" },
    });
    expect(text.status).toBe(0);
    expect(text.stderr).toBe("");
    expect(text.stdout).toContain("confirm with the user before using a weak match");
    expect(text.stdout.replace(/\s+/g, " ")).toContain("npx -y stacks@1.2.3 show go-cli");
    expect(text.stdout.trimEnd()).toMatch(
      /Next: npx -y stacks@1\.2\.3 list stacks\nNext: npx -y stacks@1\.2\.3 search "<fewer, broader words>"$/,
    );
  }
});

test("unreachable API and persisted backoff each explain local ranking once in both text audiences", async () => {
  server.mode("disconnect");
  for (const host of [{}, terminal]) {
    const opts = apiOptions(space.dir(), server.url);
    for (const reason of ["API unavailable", "API backoff"]) {
      const text = await runCli(["search", "go cli"], {
        ...opts,
        host: { ...opts.host, ...host },
      });
      expect(text.status).toBe(0);
      expect(text.stderr).toBe("");
      expect(text.stdout.match(/^Ranked locally: .*$/gm)).toEqual([`Ranked locally: ${reason}.`]);
      expect(text.stdout).toContain("go-cli");
    }
  }
  expect(server.requests).toHaveLength(2);
});

test.each([
  { env: { STACKS_OFFLINE: "1" }, reason: "offline", message: "offline" },
  { env: { DO_NOT_TRACK: "1" }, reason: "do_not_track", message: "DO_NOT_TRACK" },
  { env: { STACKS_DEV_API_URL: "" }, reason: "no_endpoint", message: "no API endpoint configured" },
])(
  "API off ($reason) explains local ranking in both text audiences",
  async ({ env, reason, message }) => {
    const opts = apiOptions(space.dir(), server.url);
    opts.env = { ...opts.env, ...env };
    expect(decoded(await runCli(["search", "go cli", "--json"], opts))).toMatchObject({
      ranking: "local",
      remote: "off",
      remoteReason: reason,
    });
    for (const host of [{}, terminal]) {
      const text = await runCli(["search", "go cli"], { ...opts, host: { ...opts.host, ...host } });
      expect(text.status).toBe(0);
      expect(text.stderr).toBe("");
      expect(text.stdout.match(/^Ranked locally: .*$/gm)).toEqual([`Ranked locally: ${message}.`]);
      expect(text.stdout).toContain("go-cli");
    }
    expect(server.requests).toEqual([]);
  },
);

test.each([false, true])(
  "API ranking and explicit --local (%s) omit fallback notices",
  async (local) => {
    const opts = apiOptions(space.dir(), server.url);
    const args = ["search", "go cli", ...(local ? ["--local"] : [])];
    expect(decoded(await runCli([...args, "--json"], opts))).toMatchObject(
      local
        ? { ranking: "local", remote: "off", remoteReason: "local_flag" }
        : { ranking: "api", remote: "used" },
    );
    for (const host of [{}, terminal]) {
      const text = await runCli(args, { ...opts, host: { ...opts.host, ...host } });
      expect(text.status).toBe(0);
      expect(text.stderr).toBe("");
      expect(text.stdout).not.toContain("Ranked locally:");
      expect(text.stdout).toContain("go-cli");
    }
    expect(server.requests).toHaveLength(local ? 0 : 3);
  },
);

test.each([
  { args: ["search", "go", "--limit", "50"], details: { flag: "limit", value: "50" } },
  { args: ["search", "   "], details: { flag: "request", length: 0 } },
  { args: ["search", "x".repeat(501)], details: { flag: "request", length: 501 } },
])("input details name the rejected value: $details", async ({ args, details }) => {
  const result = await runCli([...args, "--json"], apiOptions(space.dir(), server.url));
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  const envelope = Schema.decodeUnknownSync(ErrorEnvelope)(JSON.parse(result.stderr), {
    onExcessProperty: "error",
  });
  expect(envelope.error).toMatchObject({ tag: "BadInput", details });
  expect(envelope.error.details).not.toHaveProperty("id");
  expect(server.requests).toEqual([]);
});

test.each([
  { args: ["search"], command: "search", suggestion: undefined },
  { args: ["search", "cli", "--kind", "stacks"], command: "search", suggestion: "stack" },
  { args: ["show"], command: "show", suggestion: undefined },
  { args: ["show", "go-cli", "--kind", "stacks"], command: "show", suggestion: "stack" },
  { args: ["new", "go-cli", "app", "--preset", "sandbx"], command: "new", suggestion: "sandbox" },
])(
  "parser errors name $command help and suggest choices",
  async ({ args, command, suggestion }) => {
    const opts = apiOptions(space.dir(), server.url);
    const result = await runCli([...args, "--json"], opts);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    const envelope = Schema.decodeUnknownSync(ErrorEnvelope)(JSON.parse(result.stderr), {
      onExcessProperty: "error",
    });
    expect(envelope.error.next).toContain(`stacks ${command} --help`);
    expect(envelope.error.details).toMatchObject({ command });
    if (suggestion) expect(envelope.error.details).toMatchObject({ suggestions: [suggestion] });
    for (const host of [{}, terminal]) {
      const text = await runCli(args, { ...opts, host: { ...opts.host, ...host } });
      expect(text.status).toBe(2);
      expect(text.stdout).toBe("");
      expect(text.stderr).toContain(`stacks ${command} --help`);
      if (suggestion) expect(text.stderr).toContain(`Did you mean: ${suggestion}?`);
    }
    expect(server.requests).toEqual([]);
  },
);
