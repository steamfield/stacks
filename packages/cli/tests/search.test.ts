import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Option, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { ErrorEnvelope } from "../src/errors";
import { ndjson, runCli, terminal } from "./helpers/cli";
import { hitSchema, iosCaveats, options, searched, searchSchema } from "./helpers/search-command";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());
const ios = "an iOS health app";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

test("unsupported firmware asks for a better description or confirmation of weak matches [4.5c#3]", async () => {
  const opts = options(space.dir());
  const { value } = await searched("firmware for a microcontroller", opts);
  expect(value.noStrongMatch).toBe(true);
  const text = await runCli(["search", "firmware for a microcontroller"], opts);
  expect(text.status).toBe(0);
  expect(text.stderr).toBe("");
  expect(text.stdout).toContain(
    value.stacks.length || value.fragments.length
      ? "Nothing fits strongly. Confirm the fit with the user."
      : "Nothing matched.",
  );
  expect(text.stdout.trimEnd()).toMatch(
    /Next: stacks list stacks\nNext: stacks search "<fewer, broader words>"$/,
  );
});

test("search publishes its schema and deterministic schema-valid JSON [4.5c#4]", async () => {
  const opts = options(space.dir());
  const first = await searched(ios, opts);
  const second = await searched(ios, opts);
  expect(digest(second.stdout)).toBe(digest(first.stdout));
  const words = await searched(["an", "iOS", "health", "app"], opts);
  expect(words.value.request).toBe(ios);
  expect(digest(words.stdout)).toBe(digest(first.stdout));
  const schema = await runCli(["schema", "search", "--json"], opts);
  expect(schema.status, schema.stderr).toBe(0);
  expect(schema.stderr).toBe("");
  const document = Schema.toJsonSchemaDocument(await searchSchema(), { onExcessProperty: "error" });
  expect(JSON.parse(schema.stdout)).toEqual({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...document.schema,
    ...(Object.keys(document.definitions ?? {}).length ? { $defs: document.definitions } : {}),
  });
  for (const row of [...first.value.stacks, ...first.value.fragments]) {
    expect(Schema.decodeUnknownSync(await hitSchema())(row)).toEqual(row);
    expect(Number.isFinite(row.score)).toBe(true);
    expect(row.score).toBeGreaterThanOrEqual(0);
    expect(row.score).toBeLessThanOrEqual(1);
  }
});

test.each([
  ["   \t\n", 0],
  ["confidentialproduct".padEnd(501, "z"), 501],
])("invalid request length %j is private BadInput [4.5c#10]", async (request, length) => {
  const home = space.dir();
  const log = join(home, "private.log");
  const opts = options(home);
  const result = await runCli(["search", request, "--json"], {
    ...opts,
    env: { ...opts?.env, LOG_LEVEL: "debug", STACKS_LOG_FILE: log },
  });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(ndjson(result.stderr)).toEqual([
    expect.objectContaining({
      error: expect.objectContaining({
        tag: "BadInput",
        details: { flag: "request", length },
      }),
    }),
  ]);
  const logs = readFileSync(log, "utf8");
  if (request.trim()) {
    expect(result.stderr + logs).not.toContain("confidentialproduct");
    expect(result.stderr + logs).not.toContain(request);
  }
});

test("no positional request is Usage [4.5c#10]", async () => {
  const result = await runCli(["search", "--json"], options(space.dir()));
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(ndjson(result.stderr)).toEqual([
    expect.objectContaining({ error: expect.objectContaining({ tag: "Usage" }) }),
  ]);
  const envelope = Schema.decodeUnknownSync(ErrorEnvelope)(JSON.parse(result.stderr), {
    onExcessProperty: "error",
  });
  expect(envelope.error.details).toMatchObject({ command: "search" });
});

test.each([
  ["--limit", "0", "BadInput", "limit"],
  ["--limit", "21", "BadInput", "limit"],
  ["--limit", "abc", "Usage", "--limit"],
  ["--limit", "2.5", "Usage", "--limit"],
  ["--kind", "app", "Usage", "--kind"],
])("%s %s gives actionable input failure [4.5c#10a]", async (flag, value, tag, detailFlag) => {
  const opts = options(space.dir());
  const json = await runCli(["search", ios, flag, value, "--json"], opts);
  expect(json.status).toBe(2);
  expect(json.stdout).toBe("");
  expect(ndjson(json.stderr)).toEqual([
    expect.objectContaining({
      error: expect.objectContaining({
        tag,
        details: expect.objectContaining({
          flag: detailFlag,
          value,
          ...(tag === "BadInput" ? {} : { expected: expect.any(String) }),
        }),
      }),
    }),
  ]);
  const text = await runCli(["search", ios, flag, value], opts);
  expect(text.status).toBe(2);
  expect(text.stdout).toBe("");
  // failureGuide indents its lines, Next: included, under the message.
  expect(text.stderr.trim().split("\n").at(-1)).toMatch(/^ {2}Next: /);
});

test("kind and per-list limits filter ranked hits [4.5c#11]", async () => {
  const opts = options(space.dir());
  const fragments = (await searched("sign in", opts, ["--kind", "fragment", "--limit", "3"])).value;
  expect(fragments.stacks).toEqual([]);
  expect(fragments.fragments.length).toBeGreaterThan(0);
  expect(fragments.fragments.length).toBeLessThanOrEqual(3);
  expect(fragments.fragments[0]?.id).toBe("clerk");
  const stacks = (await searched(ios, opts, ["--kind", "stack", "--limit", "1"])).value;
  expect(stacks.fragments).toEqual([]);
  expect(stacks.stacks.map(({ id }) => id)).toEqual(["ios-swiftui"]);
  const defaults = (await searched(ios, opts)).value;
  const all = (await searched(ios, opts, ["--limit", "20"])).value;
  for (const kind of ["stacks", "fragments"] as const) {
    expect(all[kind].length).toBeGreaterThan(5);
    expect(defaults[kind]).toEqual(all[kind].slice(0, 5));
  }
});

test("agent blocks show caveats, human text wraps, JSON contains only the result [4.5c#14]", async () => {
  const opts = options(space.dir());
  const { value, stdout } = await searched(ios, opts);
  expect(ndjson(stdout)).toHaveLength(1);
  const agent = await runCli(["search", ios], {
    ...opts,
    host: { ...opts?.host, invocation: "local-stacks" },
  });
  expect(agent.status).toBe(0);
  expect(agent.stderr).toBe("");
  for (const caveat of iosCaveats()) expect(agent.stdout).toContain(caveat);
  for (const row of [...value.stacks, ...value.fragments]) {
    expect(agent.stdout).toContain(row.id);
    expect(agent.stdout).toContain(row.summary);
  }
  expect(agent.stdout).toContain(
    "Why: ios (platforms); iOS (id, name, tags, requests, useCases, synonyms)",
  );
  expect(agent.stdout.trim().split("\n").at(-1)).toMatch(
    /^Next:.*local-stacks show ios-swiftui.*local-stacks new ios-swiftui/,
  );
  const human = await runCli(["search", ios], {
    ...opts,
    host: { ...opts?.host, ...terminal, columns: Option.some(48) },
  });
  expect(human.status).toBe(0);
  expect(human.stderr).toBe("");
  expect(human.stdout.replace(/\s+/g, " ")).toContain(iosCaveats()[0]?.replace(/\s+/g, " "));
  expect(human.stdout.split("\n").length).toBeGreaterThan(agent.stdout.split("\n").length);
  expect(human.stdout).toContain("strong");
  const humanText = human.stdout.replace(/\s+/g, " ");
  for (const row of [...value.stacks, ...value.fragments]) {
    expect(humanText).toContain(`${row.kind} ${row.id} · ${row.name}`);
    expect(agent.stdout).not.toContain(`${row.id} · ${row.name}`);
  }
});

test("search help names the hosted request and every privacy opt-out", async () => {
  for (const host of [{}, terminal]) {
    const result = await runCli(["search", "--help"], { host });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.replace(/\s+/g, " ")).toContain(
      "the hosted stacks API, which receives the request text unless --local, --offline, STACKS_OFFLINE=1 or DO_NOT_TRACK is set.",
    );
  }
});
