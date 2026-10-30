import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Option, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { ErrorEnvelope } from "../src/errors";
import { ndjson, runCli, terminal } from "./helpers/cli";
import {
  hit,
  hitSchema,
  mobileCaveats,
  options,
  searched,
  searchSchema,
} from "./helpers/search-command";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());
const ios = "an iOS health app";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

test("iOS beats incidental body health matches [4.5c#1]", async () => {
  const { value } = await searched(ios, options(space.dir()), ["--limit", "20"]);
  expect(value).toMatchObject({ ranking: "local", noStrongMatch: false });
  expect(value.understood.platforms).toEqual(["ios"]);
  expect(value.understood.unmatched).toEqual(["health"]);
  expect(value.stacks[0]).toMatchObject({ id: "mobile-expo", tier: "strong" });
  expect(hit(value.stacks, "mobile-expo").why).toContainEqual(
    expect.objectContaining({
      field: "platforms",
      matched: "ios",
      from: expect.stringMatching(/ios/i),
    }),
  );
  for (const row of value.stacks.filter((row) => row.id !== "mobile-expo"))
    expect(row.tier).not.toBe("strong");
});

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

test("Python penalizes CLI languages, sign-in names auth, and go live is not Go [4.5c#8a]", async () => {
  const opts = options(space.dir());
  const python = (await searched("a command line tool in Python", opts, ["--limit", "20"])).value;
  expect(python.understood.languages).toEqual(["python"]);
  expect(python.noStrongMatch).toBe(true);
  for (const id of ["go-cli", "typescript-cli"]) {
    expect(hit(python.stacks, id).penalties).toContainEqual(
      expect.objectContaining({ kind: "language" }),
    );
    expect(hit(python.stacks, id).tier).not.toBe("strong");
  }
  const auth = (await searched("sign-in for my mobile app", opts)).value;
  expect(auth.fragments[0]?.id).toBe("clerk");
  expect(hit(auth.fragments, "clerk").why).toContainEqual(
    expect.objectContaining({ field: "capabilities", matched: "auth" }),
  );
  expect(
    (await searched("ready to go live with my blog", opts)).value.understood.languages,
  ).toEqual([]);
});

test("overlapping vocabulary categories and TUI exclusions remain visible [4.5c#8b]", async () => {
  const opts = options(space.dir());
  const go = (await searched("go cli", opts)).value;
  expect(go.stacks[0]).toMatchObject({ id: "go-cli", tier: "strong" });
  expect(go.stacks[0]?.why).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: "languages", matched: "go" }),
      expect.objectContaining({ field: "platforms", matched: "cli" }),
    ]),
  );
  const tui = (await searched("a cli with a good TUI experience", opts)).value;
  expect(
    tui.stacks
      .slice(0, 2)
      .map(({ id }) => id)
      .sort(),
  ).toEqual(["go-cli", "typescript-cli"]);
  for (const row of tui.stacks.slice(0, 2)) {
    expect(row.penalties).toContainEqual(expect.objectContaining({ kind: "notFor" }));
    expect(row.tier).not.toBe("strong");
  }
  expect(tui.noStrongMatch).toBe(true);
  expect(tui.understood.unmatched).toContain("TUI");
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

test("kind and per-list limits filter real hits [4.5c#11]", async () => {
  const opts = options(space.dir());
  const fragments = (await searched("sign in", opts, ["--kind", "fragment", "--limit", "3"])).value;
  expect(fragments.stacks).toEqual([]);
  expect(fragments.fragments.length).toBeGreaterThan(0);
  expect(fragments.fragments.length).toBeLessThanOrEqual(3);
  expect(fragments.fragments[0]?.id).toBe("clerk");
  const stacks = (await searched(ios, opts, ["--kind", "stack", "--limit", "1"])).value;
  expect(stacks.fragments).toEqual([]);
  expect(stacks.stacks.map(({ id }) => id)).toEqual(["mobile-expo"]);
  const defaults = (await searched(ios, opts)).value;
  expect(defaults.stacks).toHaveLength(3);
  expect(defaults.fragments).toHaveLength(5);
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
  for (const caveat of mobileCaveats()) expect(agent.stdout).toContain(caveat);
  for (const row of [...value.stacks, ...value.fragments]) {
    expect(agent.stdout).toContain(row.id);
    expect(agent.stdout).toContain(row.summary);
    const hasOtherField = row.why.some((reason) => reason.field !== "body");
    for (const reason of row.why.filter((reason) => !hasOtherField || reason.field !== "body"))
      expect(agent.stdout).toContain(reason.matched);
  }
  expect(agent.stdout.trim().split("\n").at(-1)).toMatch(
    /^Next:.*local-stacks show mobile-expo.*local-stacks new mobile-expo/,
  );
  const human = await runCli(["search", ios], {
    ...opts,
    host: { ...opts?.host, ...terminal, columns: Option.some(48) },
  });
  expect(human.status).toBe(0);
  expect(human.stderr).toBe("");
  expect(human.stdout.replace(/\s+/g, " ")).toContain(mobileCaveats()[0]?.replace(/\s+/g, " "));
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
