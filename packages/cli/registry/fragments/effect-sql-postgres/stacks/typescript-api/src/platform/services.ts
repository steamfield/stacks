import { Effect, Layer } from "effect";
import { AppConfig } from "../config.ts";
import { ItemsSql } from "../services/items-sql.ts";
import { ReadinessSql } from "../services/readiness-sql.ts";
import { pgLayer } from "./database.ts";

/** The SQL-backed services, on one pool. */
export const sqlServices = (pg: ReturnType<typeof pgLayer>) =>
  Layer.mergeAll(ItemsSql, ReadinessSql).pipe(Layer.provide(pg));

/** What the platform entry provides to App: the SQL services on AppConfig's DATABASE_URL. */
export const DatabaseLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig;
    return sqlServices(pgLayer(config.databaseUrl));
  }),
).pipe(Layer.provide(AppConfig.layer));
