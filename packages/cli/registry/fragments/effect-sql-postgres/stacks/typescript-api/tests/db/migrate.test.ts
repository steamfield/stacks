import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { cloneName, createEmpty, databaseUrl, dropDatabase, newRunId } from "./databases.ts";

const created: string[] = [];
afterEach(async () => {
  for (const name of created.splice(0)) await dropDatabase(name);
});

async function emptyDatabase() {
  const name = cloneName(newRunId(), "migrate");
  await createEmpty(name);
  created.push(name);
  return databaseUrl(name);
}

// The real entry point, as a release runs it: a child process with DATABASE_URL set.
function run(url: string, ...args: string[]) {
  const result = spawnSync(process.execPath, ["src/platform/migrate.ts", ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, DATABASE_URL: url, NODE_ENV: "production" },
    timeout: 60_000,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

it("db:migrate applies every migration once, and db:check then passes", async () => {
  const url = await emptyDatabase();

  const first = run(url);
  expect(first.status, first.output).toBe(0);
  expect(first.output).toContain("migration applied");

  const second = run(url);
  expect(second.status, second.output).toBe(0);
  expect(second.output).toContain("migrations up to date");

  const check = run(url, "--check");
  expect(check.status, check.output).toBe(0);
});

it("db:check fails on a database with pending migrations and applies nothing", async () => {
  const url = await emptyDatabase();

  const check = run(url, "--check");
  expect(check.status).not.toBe(0);
  expect(check.output).toContain("is not applied");
  expect(run(url, "--check").output).toContain("is not applied");
});
