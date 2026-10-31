// drizzle-kit runs on Node outside Next's env loading, so it reads .env.local and .env itself.
// Variables already set (verify's PORT_DB, CI's DATABASE_URL) win over the files.
import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

for (const file of [".env.local", ".env"])
  if (existsSync(file)) process.loadEnvFile(file);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/server/db/schema.ts",
  // db:check generates into a temporary copy through DRIZZLE_OUT; everything else uses drizzle/.
  out: process.env.DRIZZLE_OUT ?? "./drizzle",
  strict: true,
  verbose: true,
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      `postgres://app:app@localhost:${process.env.PORT_DB ?? "5432"}/app`,
  },
});
