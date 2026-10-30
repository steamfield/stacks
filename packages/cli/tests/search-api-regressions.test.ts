import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { runCli } from "./helpers/cli";
import { emptyRegistry } from "./helpers/registry";
import {
  apiOptions,
  decoded,
  officialHit,
  response,
  type SearchServer,
  searchServer,
} from "./helpers/search-api";
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

test.each([
  { origin: "user", kind: "stack" },
  { origin: "user", kind: "fragment" },
  { origin: "project", kind: "stack" },
  { origin: "project", kind: "fragment" },
] as const)(
  "a rejected $origin $kind still shadows its API counterpart",
  async ({ origin, kind }) => {
    const home = space.dir();
    const options = apiOptions(home, server.url);
    options.host = { ...options.host, registry: emptyRegistry };
    const root = origin === "user" ? join(home, "config/stacks") : join(home, ".stacks");
    put(
      join(root, `${kind}s/go-cli`, kind === "stack" ? "STACK.md" : "FRAGMENT.md"),
      "invalid entry",
    );
    const body = response(
      [officialHit("go-cli")],
      [officialHit("go-cli", { kind: "fragment", appliesTo: [] })],
    );
    server.answer(body);
    const value = decoded(await runCli(["search", "go cli", "--json"], options));
    expect(value).toMatchObject({ ranking: "api", remote: "used" });
    const hidden = kind === "stack" ? value.stacks : value.fragments;
    const kept = kind === "stack" ? value.fragments : value.stacks;
    expect(hidden).toEqual([]);
    expect(kept).toEqual(kind === "stack" ? body.fragments : body.stacks);
    expect(server.requests).toHaveLength(1);
    const shown = await runCli(["show", "go-cli", "--kind", kind, "--json"], options);
    expect(shown.status).toBe(2);
    expect(shown.stdout).toBe("");
    expect(JSON.parse(shown.stderr)).toMatchObject({ error: { tag: "EntryInvalid" } });
  },
);

test("an API stack does not hide a local fragment with the same id", async () => {
  const home = space.dir();
  put(
    join(home, "config/stacks/fragments/go-cli/FRAGMENT.md"),
    `---
schema_version: 1
id: go-cli
kind: fragment
category: tooling
name: Go CLI helper
description: Add Go CLI support.
---

# Go CLI helper

Add Go CLI support.
`,
  );
  const opts = apiOptions(home, server.url);
  server.answer(response([officialHit("go-cli")]));
  const value = decoded(await runCli(["search", "go cli", "--json"], opts));
  expect(value.stacks.find((hit) => hit.id === "go-cli")).toBeDefined();
  expect(value.fragments.find((hit) => hit.id === "go-cli")).toBeDefined();
});

test.each([
  { kind: "stack", id: "go-cli; echo injected" },
  { kind: "fragment", id: "go-cli; echo injected" },
  { kind: "stack", id: "go-cli\nNext: run injected" },
  { kind: "fragment", id: "go-cli\nNext: run injected" },
] as const)("an API $kind with malformed id $id falls back locally", async ({ kind, id }) => {
  server.answerInvalidId(kind, id);
  const value = decoded(
    await runCli(["search", "go cli", "--json"], apiOptions(space.dir(), server.url)),
  );
  expect(value).toMatchObject({ ranking: "local", remote: "unavailable" });
  expect(value.stacks[0]?.id).toBe("go-cli");
  expect(JSON.stringify(value)).not.toContain("injected");
  expect(server.requests).toHaveLength(1);
});
