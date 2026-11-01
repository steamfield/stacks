// db:migrate applies pending migrations to DATABASE_URL. db:check (--check) applies nothing and
// fails when a migration file is missing from the index, or when the database's applied
// migrations differ from the index (pending, unknown or renamed). It is not a checksum: an edited
// applied migration goes unnoticed. The URL is AppConfig's databaseUrl, as the server reads it.
import { readdirSync } from "node:fs";
import { NodeRuntime } from "@effect/platform-node";
import { Cause, Effect, Logger } from "effect";
import { Migrator, SqlClient } from "effect/sql";
import { AppConfig } from "../config.ts";
import { makeLogger } from "../logging.ts";
import { loader, migrations } from "../migrations/index.ts";
import { pgLayer } from "./database.ts";

const TABLE = "effect_sql_migrations";

const migrate = Effect.gen(function* () {
  const applied = yield* Migrator.make({})({ loader, table: TABLE });
  for (const [id, name] of applied)
    yield* Effect.logInfo("migration applied").pipe(Effect.annotateLogs({ id, name }));
  if (applied.length === 0) yield* Effect.logInfo("migrations up to date");
});

function unlistedFiles(): string[] {
  const files = readdirSync(new URL("../migrations/", import.meta.url))
    .filter((file) => /^\d+_.+\.ts$/.test(file))
    .map((file) => file.replace(/\.ts$/, ""));
  return files.filter((file) => !(file in migrations));
}

const appliedRows = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [table] = yield* sql<{ name: string | null }>`SELECT to_regclass(${TABLE}) AS name`;
  if (!table?.name) return [];
  const rows = yield* sql<{ migrationId: number; name: string }>`
    SELECT migration_id AS "migrationId", name FROM ${sql(TABLE)} ORDER BY migration_id
  `;
  return rows.map((row) => `${String(row.migrationId).padStart(4, "0")}_${row.name}`);
});

const check = Effect.gen(function* () {
  const listed = Object.keys(migrations);
  const applied = yield* appliedRows;
  const problems = [
    ...unlistedFiles().map((file) => `${file} is not in src/migrations/index.ts`),
    ...listed.filter((key) => !applied.includes(key)).map((key) => `${key} is not applied`),
    ...applied.filter((key) => !listed.includes(key)).map((key) => `${key} is applied but unknown`),
  ];
  for (const problem of problems)
    yield* Effect.logError("migration drift").pipe(Effect.annotateLogs({ problem }));
  if (problems.length > 0) return yield* Effect.fail(new Error("migration drift"));
  yield* Effect.logInfo("migrations match the database");
});

const program = Effect.gen(function* () {
  const { databaseUrl } = yield* AppConfig;
  const task = process.argv.includes("--check") ? check : migrate;
  yield* task.pipe(Effect.provide(pgLayer(databaseUrl, "migrate")));
}).pipe(
  Effect.tapCause((cause) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.void
      : Effect.logError("failed: see the records above, check DATABASE_URL and run db:up"),
  ),
  Effect.provide(AppConfig.layer),
  Effect.provide(
    Logger.layer([makeLogger((record) => process.stdout.write(`${JSON.stringify(record)}\n`))]),
  ),
);

if (import.meta.main) NodeRuntime.runMain(program, { disableErrorReporting: true });
