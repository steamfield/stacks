import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Applies the checked-in migrations to a test-owned persistence directory, the
// one the HTTP test then passes to `wrangler dev --persist-to`. Always local:
// the developer's `.wrangler/` state and the remote database are never touched.
export async function migrateLocalD1(persistTo: string): Promise<void> {
  await run(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      persistTo,
    ],
    { env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" } },
  );
}
