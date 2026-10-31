// The Postgres layer of Items, through the SQL client service only; the platform supplies the
// driver. test:db covers this file, so the Docker-free coverage run excludes it.
import { Effect, Layer, Schema } from "effect";
import { SqlClient, SqlError, SqlSchema } from "effect/sql";
import { Conflict, Unavailable } from "../errors.ts";
import { ItemId, ItemName } from "../schemas/items.ts";
import { Items, type ItemValue } from "./items.ts";

// A row the schema rejects is a defect: the database holds data the API never accepted.
const ItemRow = Schema.Struct({
  id: ItemId,
  name: ItemName,
  created_at: Schema.DateTimeUtcFromDate,
});

const toItem = (row: typeof ItemRow.Type): ItemValue => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
});

/** The one place driver errors are classified. Anything unexpected is a defect. */
function classify(error: unknown): "conflict" | "unavailable" | "defect" {
  if (!SqlError.isSqlError(error)) return "defect";
  switch (error.reason._tag) {
    case "UniqueViolation":
      return "conflict";
    case "ConnectionError":
    case "StatementTimeoutError":
    case "LockTimeoutError":
      return "unavailable";
    default:
      return "defect";
  }
}

export const ItemsSql = Layer.effect(
  Items,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const listRows = SqlSchema.findAll({
      Request: Schema.Void,
      Result: ItemRow,
      execute: () => sql`SELECT id, name, created_at FROM items ORDER BY created_at, id LIMIT 100`,
    });
    const insertRow = SqlSchema.findOne({
      Request: Schema.Struct({ id: Schema.String, name: Schema.String }),
      Result: ItemRow,
      execute: (row) => sql`INSERT INTO items ${sql.insert(row)} RETURNING id, name, created_at`,
    });
    return Items.of({
      list: listRows(undefined).pipe(
        Effect.map((rows) => rows.map(toItem)),
        Effect.catch((error) =>
          classify(error) === "unavailable" ? Effect.fail(new Unavailable()) : Effect.die(error),
        ),
      ),
      create: (name) =>
        insertRow({ id: crypto.randomUUID(), name }).pipe(
          Effect.map(toItem),
          Effect.catch((error): Effect.Effect<never, Conflict | Unavailable> => {
            const kind = classify(error);
            if (kind === "conflict") return Effect.fail(new Conflict());
            if (kind === "unavailable") return Effect.fail(new Unavailable());
            return Effect.die(error);
          }),
        ),
    });
  }),
);
