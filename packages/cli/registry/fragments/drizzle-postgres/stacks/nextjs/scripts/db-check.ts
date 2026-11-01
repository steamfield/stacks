#!/usr/bin/env bun
// db:check: fails when the migration history is inconsistent or when the schema has changes no
// committed migration covers. It writes nothing to drizzle/ and needs no database: it generates
// into a temporary copy of drizzle/ and fails if the copy gains anything.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

process.chdir(join(import.meta.dirname, ".."));

const kit = join("node_modules", ".bin", "drizzle-kit");

function run(args: string[], env: Record<string, string> = {}) {
  // stdin closed: an interactive rename prompt fails instead of waiting forever.
  const result = spawnSync(kit, args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`,
  };
}

const entries = (dir: string) =>
  new Set(readdirSync(dir, { recursive: true, encoding: "utf8" }));

function drift(): string | undefined {
  if (!existsSync("drizzle"))
    return "No drizzle/ migrations. Run bun run db:generate and commit the result.";
  const check = run(["check"]);
  if (!check.ok)
    return `drizzle-kit check found an inconsistent migration history:\n${check.output}`;

  const copy = mkdtempSync(".drizzle-check-");
  try {
    cpSync("drizzle", copy, { recursive: true });
    const before = entries(copy);
    const generate = run(["generate"], { DRIZZLE_OUT: `./${copy}` });
    const added = [...entries(copy)].filter((entry) => !before.has(entry));
    if (added.length > 0)
      return `The schema has changes no migration covers (${added.join(", ")}). Run bun run db:generate, review the SQL and commit it.`;
    // Some releases report errors while exiting 0, so require the generator's own confirmation.
    if (!generate.ok || !/no schema changes/i.test(generate.output))
      return `drizzle-kit generate didn't confirm the migrations match the schema:\n${generate.output}`;
    return undefined;
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

const problem = drift();
if (problem) {
  console.error(`db:check: ${problem}`);
  process.exitCode = 1;
} else {
  console.log("db:check: the migrations match the schema.");
}
