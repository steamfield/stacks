// SELECT 1 through the pool, bounded so a dead database answers 503 in seconds. test:db covers
// this file, so the Docker-free coverage run excludes it.
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { Unavailable } from "../errors.ts";
import { Readiness } from "./readiness.ts";

export const ReadinessSql = Layer.effect(
  Readiness,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return Readiness.of({
      check: sql`SELECT 1`.pipe(
        Effect.timeout("2 seconds"),
        Effect.as({ status: "ready" } as const),
        Effect.catch(() => Effect.fail(new Unavailable())),
      ),
    });
  }),
);
