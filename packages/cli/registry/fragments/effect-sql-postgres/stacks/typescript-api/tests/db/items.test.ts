// The Items and Readiness SQL layers, and the routes over them, on this file's own database.
import { Effect, Exit, Layer, Redacted, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { expect, it } from "vitest";
import { pgLayer } from "../../src/platform/database.ts";
import { sqlServices } from "../../src/platform/services.ts";
import { Item } from "../../src/schemas/items.ts";
import { Items } from "../../src/services/items.ts";
import { ItemsSql } from "../../src/services/items-sql.ts";
import { Readiness } from "../../src/services/readiness.ts";
import { ReadinessSql } from "../../src/services/readiness-sql.ts";
import { testServer } from "../helpers/server.ts";
import { testDatabase } from "./harness.ts";

const db = testDatabase("items");
const closed = () => pgLayer(Redacted.make("postgres://app:app@127.0.0.1:1/app"));
const unique = (label: string) => `${label} ${crypto.randomUUID()}`.slice(0, 80);
const withItems = <A, E>(program: Effect.Effect<A, E, Items>) =>
  Effect.runPromiseExit(program.pipe(Effect.provide(ItemsSql.pipe(Layer.provide(db.sql)))));

it("creates an item and reads it back decoded", async () => {
  const name = unique("round trip");
  const exit = await withItems(
    Effect.gen(function* () {
      const items = yield* Items;
      const created = yield* items.create(name);
      return { created, listed: yield* items.list };
    }),
  );
  expect(Exit.isSuccess(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    expect(exit.value.created.name).toBe(name);
    expect(exit.value.listed).toContainEqual(exit.value.created);
  }
});

it("maps a duplicate name to Conflict", async () => {
  const name = unique("duplicate");
  const exit = await withItems(
    Effect.gen(function* () {
      const items = yield* Items;
      yield* items.create(name);
      return yield* items.create(name);
    }),
  );
  expect(Exit.isFailure(exit) && String(exit.cause)).toContain("Conflict");
});

it("is ready on its database and Unavailable on a closed port, within the timeout", async () => {
  const check = (layer: typeof db.sql) =>
    Effect.runPromiseExit(
      Effect.flatMap(Readiness, (readiness) => readiness.check).pipe(
        Effect.provide(ReadinessSql.pipe(Layer.provide(layer))),
      ),
    );
  expect(Exit.isSuccess(await check(db.sql))).toBe(true);
  const started = performance.now();
  const down = await check(closed());
  expect(Exit.isFailure(down) && String(down.cause)).toContain("Unavailable");
  expect(performance.now() - started).toBeLessThan(5_000);
});

it("serves items, conflicts and readiness over real HTTP", async () => {
  const app = await testServer(sqlServices(db.sql));
  const name = unique("http");
  const post = () =>
    app.request("/v1/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });

  const created = await post();
  expect(created.status).toBe(201);
  const item = Schema.decodeUnknownSync(Item)(await created.json());
  expect(item.name).toBe(name);

  const list = await app.request("/v1/items");
  expect(list.status).toBe(200);
  expect(JSON.stringify(await list.json())).toContain(item.id);

  const duplicate = await post();
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toEqual({
    error: { tag: "Conflict", message: "Resource already exists.", retryable: false },
  });

  expect((await app.request("/readyz")).status).toBe(200);
  expect((await app.request("/healthz")).status).toBe(200);
});

it("answers 503 on /readyz and 200 on /healthz when the database is down", async () => {
  const app = await testServer(sqlServices(closed()));
  const ready = await app.request("/readyz");
  expect(ready.status).toBe(503);
  expect(await ready.json()).toEqual({
    error: { tag: "Unavailable", message: "Service unavailable.", retryable: true },
  });
  expect((await app.request("/healthz")).status).toBe(200);
});

it("treats a stored row the schema rejects as a defect and leaks no row data", async () => {
  const tooLong = `invalid ${"x".repeat(100)}`;
  await Effect.runPromise(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`INSERT INTO items (id, name) VALUES (${crypto.randomUUID()}, ${tooLong})`,
    ).pipe(Effect.provide(db.sql)),
  );
  const app = await testServer(sqlServices(db.sql));
  const response = await app.request("/v1/items");
  expect(response.status).toBe(500);
  const body = await response.text();
  expect(body).not.toContain(tooLong);
  expect(JSON.parse(body)).toEqual({
    error: { tag: "Defect", message: "Internal server error.", retryable: false },
  });
});
