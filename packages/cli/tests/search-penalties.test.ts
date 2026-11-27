import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { runCli } from "./helpers/cli";
import { options } from "./helpers/search-command";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

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
