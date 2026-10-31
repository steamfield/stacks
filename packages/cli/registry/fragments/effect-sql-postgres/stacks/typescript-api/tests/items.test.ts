// The items and readiness routes over the in-memory services, with no database. tests/db runs
// the same routes against Postgres.
import { Schema } from "effect";
import { expect, it } from "vitest";
import { Item, ItemList, ReadyStatus } from "../src/schemas/items.ts";
import { testServer } from "./helpers/server.ts";

const post = (app: Awaited<ReturnType<typeof testServer>>, body: unknown) =>
  app.request("/v1/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

it("creates an item with 201, lists it and rejects a duplicate with 409", async () => {
  const app = await testServer();

  const created = await post(app, { name: "Read the code" });
  expect(created.status).toBe(201);
  const item = Schema.decodeUnknownSync(Item)(await created.json());
  expect(item.name).toBe("Read the code");

  const list = await app.request("/v1/items");
  expect(list.status).toBe(200);
  expect(Schema.decodeUnknownSync(ItemList)(await list.json())).toEqual({ items: [item] });

  const duplicate = await post(app, { name: "Read the code" });
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toEqual({
    error: { tag: "Conflict", message: "Resource already exists.", retryable: false },
  });
});

it.each([{}, { name: "" }, { name: "x".repeat(81) }])("rejects %j with 400", async (body) => {
  const app = await testServer();
  const response = await post(app, body);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { tag: "BadInput" } });
});

it("answers /readyz with ready", async () => {
  const app = await testServer();
  const response = await app.request("/readyz");
  expect(response.status).toBe(200);
  expect(Schema.decodeUnknownSync(ReadyStatus)(await response.json())).toEqual({
    status: "ready",
  });
});
