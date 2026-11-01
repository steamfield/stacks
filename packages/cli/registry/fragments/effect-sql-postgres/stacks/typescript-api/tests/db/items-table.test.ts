// The first migration's table, through the SQL client alone. The service and HTTP tests for
// items sit beside this file and use the same harness.
import { Effect, Exit, Redacted } from "effect";
import { SqlClient, SqlError } from "effect/sql";
import { expect, it } from "vitest";
import { pgLayer } from "../../src/platform/database.ts";
import { sessionsNamed } from "./databases.ts";
import { testDatabase } from "./harness.ts";

const db = testDatabase("table");
const unique = (label: string) => `${label} ${crypto.randomUUID()}`;
const insert = (name: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`INSERT INTO items (id, name) VALUES (${crypto.randomUUID()}, ${name})`,
  );
const rowsNamed = (name: string) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) => sql`SELECT name FROM items WHERE name = ${name}`);
const run = <A, E>(program: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromiseExit(program.pipe(Effect.provide(db.sql)));

it("stores a row and reads it back", async () => {
  const name = unique("round trip");
  const exit = await run(Effect.andThen(insert(name), rowsNamed(name)));
  expect(Exit.isSuccess(exit) && exit.value).toEqual([{ name }]);
});

it("rejects a duplicate name as a UniqueViolation", async () => {
  const name = unique("duplicate");
  const exit = await run(Effect.andThen(insert(name), insert(name)).pipe(Effect.flip));
  expect(Exit.isSuccess(exit) && SqlError.isSqlError(exit.value) && exit.value.reason._tag).toBe(
    "UniqueViolation",
  );
});

it("rolls back a transaction that fails after an insert", async () => {
  const name = unique("rollback");
  const exit = await run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql
        .withTransaction(Effect.andThen(insert(name), Effect.fail("abort")))
        .pipe(Effect.ignore);
      return yield* rowsNamed(name);
    }),
  );
  expect(Exit.isSuccess(exit) && exit.value).toEqual([]);
});

it("leaves no session behind once the client's scope closes", async () => {
  await run(Effect.flatMap(SqlClient.SqlClient, (sql) => sql`SELECT 1`));
  expect(await sessionsNamed(db.name)).toBe(0);
});

it("fails fast with a ConnectionError when the server is down", async () => {
  const started = performance.now();
  const exit = await Effect.runPromiseExit(
    Effect.flatMap(SqlClient.SqlClient, (sql) => sql`SELECT 1`).pipe(
      Effect.flip,
      Effect.provide(pgLayer(Redacted.make("postgres://app:app@127.0.0.1:1/app"))),
    ),
  );
  expect(Exit.isSuccess(exit) && SqlError.isSqlError(exit.value) && exit.value.reason._tag).toBe(
    "ConnectionError",
  );
  expect(performance.now() - started).toBeLessThan(5_000);
});
