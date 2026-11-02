#!/usr/bin/env bun
// `bun run bench:pending [--list] [bench options]`: bench every bundled stack that has no current
// green run from the bench's agent (Codex unless `--agent` says otherwise). The list comes from
// `validate`'s ledger notes (`ledger-unproven`, `ledger-changed`), so it matches what validate
// reports. `ledger-changed` is keyed by agent, so a stale proof from another agent counts only
// while this agent has no sandbox run of the stack at all; once it has one, its own note says
// whether that run is current. Remaining arguments pass to each `bun run bench <stack>`; runs go
// one at a time, and an interrupted run (exit 130) stops the rest.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_AGENT } from "./bench/prepare";

const root = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const benchArgs = args.filter((arg) => arg !== "--list");
const agentAt = benchArgs.indexOf("--agent");
const agent = (agentAt >= 0 ? benchArgs[agentAt + 1] : undefined) ?? DEFAULT_AGENT;

// validate names the stale proof's key in its message: "<id> (<preset>, <agent>) changed since...".
const CHANGED_AGENT = /^\S+ \([a-z]+, ([a-z]+)\) changed since/;

type Note = { stack: string; agent: string | undefined };

function ledgerNotes(): Note[] {
  const validate = Bun.spawnSync(["bun", "scripts/dev.ts", "validate", "--json"], {
    cwd: root,
    stdout: "pipe",
    stderr: "inherit",
  });
  const report = JSON.parse(validate.stdout.toString()) as unknown;
  if (typeof report !== "object" || report === null || !("findings" in report))
    throw new Error("validate --json printed no findings");
  const findings = Array.isArray(report.findings) ? report.findings : [];
  return findings.flatMap((finding) => {
    const note = ledgerNote(finding);
    return note ? [note] : [];
  });
}

function ledgerNote(finding: unknown): Note | undefined {
  if (typeof finding !== "object" || finding === null) return undefined;
  if (!("kind" in finding) || finding.kind !== "stack") return undefined;
  if (!("entry" in finding) || typeof finding.entry !== "string") return undefined;
  const check = "check" in finding ? finding.check : undefined;
  if (check === "ledger-unproven") return { stack: finding.entry, agent: undefined };
  if (check !== "ledger-changed") return undefined;
  const message =
    "message" in finding && typeof finding.message === "string" ? finding.message : "";
  const changed = CHANGED_AGENT.exec(message)?.[1];
  if (changed === undefined) throw new Error(`Unrecognized ledger-changed note: ${message}`);
  return { stack: finding.entry, agent: changed };
}

/** Stacks with a sandbox run from `agent` on record, current or not. */
function sandboxRuns(): Set<string> {
  const ledger = JSON.parse(readFileSync(join(root, "registry/runs.json"), "utf8")) as unknown;
  const records =
    typeof ledger === "object" &&
    ledger !== null &&
    "records" in ledger &&
    Array.isArray(ledger.records)
      ? ledger.records
      : [];
  const stacks = new Set<string>();
  for (const record of records)
    if (
      typeof record === "object" &&
      record !== null &&
      record.agent === agent &&
      record.preset === "sandbox" &&
      typeof record.stack === "string"
    )
      stacks.add(record.stack);
  return stacks;
}

function pendingStacks(): string[] {
  const ran = sandboxRuns();
  const pending = new Set<string>();
  for (const note of ledgerNotes())
    if (note.agent === undefined || note.agent === agent || !ran.has(note.stack))
      pending.add(note.stack);
  return [...pending].sort();
}

const stacks = pendingStacks();
if (listOnly || stacks.length === 0) {
  console.log(
    stacks.length ? stacks.join("\n") : `Every bundled stack has a current green ${agent} run.`,
  );
  process.exit(0);
}

console.log(`Benching ${stacks.length} stacks on ${agent}: ${stacks.join(", ")}`);
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
