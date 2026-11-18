#!/usr/bin/env node
/**
 * Writes the app's OpenAPI document to openapi.json, or with --check fails when the committed
 * file no longer matches it. The document comes from the app's own /openapi.json route, called
 * in process with no server or port, so the file and the served document can't differ.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createLogger } from "../src/logging.ts";

const FILE = "openapi.json";

process.chdir(join(import.meta.dirname, ".."));

const app = createApp({ config: loadConfig({}), logger: createLogger("silent") });
const response = await app.request("/openapi.json");
if (!response.ok) throw new Error(`/openapi.json answered ${response.status}`);
const document: unknown = await response.json();

if (!process.argv.includes("--check")) {
  // `bun run openapi` formats the file with Biome afterwards, so lint accepts it.
  writeFileSync(FILE, `${JSON.stringify(document, null, 2)}\n`);
} else if (!existsSync(FILE)) {
  console.error(`${FILE} is missing: run bun run openapi, then commit it`);
  process.exitCode = 1;
} else if (JSON.stringify(JSON.parse(readFileSync(FILE, "utf8"))) !== JSON.stringify(document)) {
  // Parsed JSON, not bytes: Biome owns the file's formatting.
  console.error(`${FILE} is stale: run bun run openapi, then commit it`);
  process.exitCode = 1;
}
