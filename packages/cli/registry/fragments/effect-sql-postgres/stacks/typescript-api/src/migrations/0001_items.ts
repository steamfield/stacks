import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// One statement per call: a prepared statement can't hold several.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE items (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT items_name_key UNIQUE (name)
    )
  `;
  yield* sql`CREATE INDEX items_created_at_id_idx ON items (created_at, id)`;
});
