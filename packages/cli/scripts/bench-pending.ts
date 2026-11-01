#!/usr/bin/env bun
// `bun run bench:pending [--list] [bench options]`: bench every bundled stack whose default
// composition has no green run on record or changed since its last one. The list comes from
// `validate`'s ledger notes (`ledger-unproven`, `ledger-changed`), so it matches what validate
// reports. Remaining arguments pass to each `bun run bench <stack>`; runs go one at a time, and
// an interrupted run (exit 130) stops the rest.
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const benchArgs = args.filter((arg) => arg !== "--list");

const PENDING = new Set(["ledger-unproven", "ledger-changed"]);

function pendingStacks(): string[] {
  const validate = Bun.spawnSync(["bun", "scripts/dev.ts", "validate", "--json"], {
    cwd: root,
    stdout: "pipe",
    stderr: "inherit",
  });
  const report = JSON.parse(validate.stdout.toString()) as unknown;
  if (typeof report !== "object" || report === null || !("findings" in report))
    throw new Error("validate --json printed no findings");
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const ids = new Set<string>();
  for (const finding of findings) {
    if (typeof finding !== "object" || finding === null) continue;
    if (finding.kind === "stack" && PENDING.has(finding.check) && typeof finding.entry === "string")
      ids.add(finding.entry);
  }
  return [...ids].sort();
}

const stacks = pendingStacks();
if (listOnly || stacks.length === 0) {
  console.log(stacks.length ? stacks.join("\n") : "Every bundled stack has a current green run.");
  process.exit(0);
}

console.log(`Benching ${stacks.length} stacks: ${stacks.join(", ")}`);
const failed: string[] = [];
for (const [index, stack] of stacks.entries()) {
  console.log(`\n[${index + 1}/${stacks.length}] bun run bench ${[stack, ...benchArgs].join(" ")}`);
  const run = Bun.spawnSync(["bun", "scripts/bench.ts", stack, ...benchArgs], {
    cwd: root,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (run.exitCode === 130 || run.signalCode) {
    console.log(
      `Interrupted at ${stack}; skipped ${stacks.slice(index + 1).join(", ") || "none"}.`,
    );
    process.exit(130);
  }
  if (run.exitCode !== 0) failed.push(stack);
}
console.log(
  failed.length
    ? `\n${failed.length} of ${stacks.length} failed: ${failed.join(", ")}`
    : `\nAll ${stacks.length} benched.`,
);
process.exit(failed.length ? 1 : 0);
