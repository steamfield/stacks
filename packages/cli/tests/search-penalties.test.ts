import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { runCli, terminal } from "./helpers/cli";
import { hit, options, searched } from "./helpers/search-command";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

test("SaaS with Postgres and auth ranks a web app ahead of the mobile stack", async () => {
  const { value } = await searched("postgres auth for a saas", options(space.dir()), [
    "--local",
    "--limit",
    "20",
  ]);
  expect([
    "cloudflare-react-router",
    "react-router",
    "python-react",
    "nextjs",
    "sveltekit",
  ]).toContain(value.stacks[0]?.id);
  expect(hit(value.stacks, "mobile-expo").penalties).toContainEqual({
    kind: "productKind",
    request: "saas (web-app)",
    entry: "mobile-app, fullstack, api",
  });
});

test("an add request does not show stacks matched only by its constraint", async () => {
  const opts = options(space.dir());
  const { value } = await searched("add authentication", opts, ["--local"]);
  for (const id of ["python-react", "mobile-expo"])
    expect(value.stacks.map((hit) => hit.id)).not.toContain(id);
  const text = await runCli(["search", "add authentication", "--local"], opts);
  expect(text.status, text.stderr).toBe(0);
  expect(text.stderr).toBe("");
  expect(text.stdout).toMatch(
    /Next: confirm with the user before using a weak match; then stacks show clerk, then stacks add clerk\./,
  );
});

test("TUI exclusions name the matched rule in JSON, agent and human output", async () => {
  const opts = options(space.dir());
  const request = "a cli with a good TUI experience";
  const { value } = await searched(request, opts, ["--local"]);
  for (const id of ["go-cli", "typescript-cli"])
    expect(hit(value.stacks, id).penalties).toContainEqual({
      kind: "notFor",
      request: "TUI",
      entry: "a terminal user interface",
    });
  for (const host of [{}, terminal]) {
    const text = await runCli(["search", request, "--local"], {
      ...opts,
      host: { ...opts?.host, ...host },
    });
    expect(text.status, text.stderr).toBe(0);
    expect(text.stderr).toBe("");
    expect(text.stdout.replace(/\s+/g, " ")).toContain(
      "Penalties: notFor (TUI; entry: a terminal user interface)",
    );
  }
});

test("schema search describes structured penalties for both hit lists", async () => {
  const result = await runCli(["schema", "search", "--json"], options(space.dir()));
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  const penalty = Schema.Struct({
    type: Schema.Literal("object"),
    required: Schema.Array(Schema.String),
    properties: Schema.Struct({
      kind: Schema.Struct({ enum: Schema.Array(Schema.String) }),
      request: Schema.Struct({ type: Schema.Literal("string") }),
      entry: Schema.Struct({ type: Schema.Literal("string") }),
    }),
  });
  const list = Schema.Struct({
    items: Schema.Struct({
      properties: Schema.Struct({ penalties: Schema.Struct({ items: penalty }) }),
    }),
  });
  const schema = Schema.Struct({ properties: Schema.Struct({ stacks: list, fragments: list }) });
  const document = Schema.decodeUnknownSync(schema)(JSON.parse(result.stdout));
  for (const list of [document.properties.stacks, document.properties.fragments]) {
    expect(list.items.properties.penalties.items.required).toEqual(["kind", "request", "entry"]);
    expect(list.items.properties.penalties.items.properties.kind.enum).toEqual([
      "platform",
      "language",
      "productKind",
      "notFor",
      "untrusted",
    ]);
  }
});
