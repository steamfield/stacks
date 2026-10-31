import { defineConfig } from "drizzle-kit";

// Generates SQL migrations only. Wrangler applies them (`migrations_dir: "drizzle"`);
// drizzle-kit never connects to a database here, local or remote.
export default defineConfig({
  dialect: "sqlite",
  schema: "./app/.server/db/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
