#!/usr/bin/env bun
// `bun run bench:pending [--list] [bench options]`: bench every bundled stack whose default
// composition has no green run on record or changed since its last one. The list comes from
// `validate`'s ledger notes (`ledger-unproven`, `ledger-changed`), so it matches what validate
// reports. An unproven stack runs on the bench's default agent; a changed one reruns on the agent
// whose proof went stale, since only that agent's pass clears its note. `--agent <id>` keeps only
// the runs that agent can clear. Remaining arguments pass to each `bun run bench <stack>`; runs go
// one at a time, and an interrupted run (exit 130) stops the rest.
import { join } from "node:path";

type Run = { stack: string; agent: string | undefined };

const root = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const benchArgs = args.filter((arg) => arg !== "--list");
const agentAt = benchArgs.indexOf("--agent");
const chosenAgent = agentAt >= 0 ? benchArgs[agentAt + 1] : undefined;

// validate names the stale proof's key in its message: "<id> (<preset>, <agent>) changed since...".
const CHANGED_AGENT = /^\S+ \([a-z]+, ([a-z]+)\) changed since/;

function pendingRuns(): Run[] {
  const validate = Bun.spawnSync(["bun", "scripts/dev.ts", "validate", "--json"], {
    cwd: root,
    stdout: "pipe",
    stderr: "inherit",
  });
  const report = JSON.parse(validate.stdout.toString()) as unknown;
  if (typeof report !== "object" || report === null || !("findings" in report))
    throw new Error("validate --json printed no findings");
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const runs = new Map<string, Run>();
  for (const finding of findings) {
    const run = pendingRun(finding);
    if (run && (chosenAgent === undefined || (run.agent ?? chosenAgent) === chosenAgent))
      runs.set(`${run.stack}\0${run.agent ?? ""}`, run);
  }
  return [...runs.values()].sort((a, b) =>
    `${a.stack}\0${a.agent ?? ""}`.localeCompare(`${b.stack}\0${b.agent ?? ""}`),
  );
}

function pendingRun(finding: unknown): Run | undefined {
  if (typeof finding !== "object" || finding === null) return undefined;
  if (!("kind" in finding) || finding.kind !== "stack") return undefined;
  if (!("entry" in finding) || typeof finding.entry !== "string") return undefined;
  const check = "check" in finding ? finding.check : undefined;
  if (check === "ledger-unproven") return { stack: finding.entry, agent: undefined };
  if (check !== "ledger-changed") return undefined;
  const message =
    "message" in finding && typeof finding.message === "string" ? finding.message : "";
  const agent = CHANGED_AGENT.exec(message)?.[1];
  if (agent === undefined) throw new Error(`Unrecognized ledger-changed note: ${message}`);
  return { stack: finding.entry, agent };
}

function runArgs(run: Run): string[] {
  const agent = run.agent && chosenAgent === undefined ? ["--agent", run.agent] : [];
  return [run.stack, ...agent, ...benchArgs];
}

const label = (run: Run) => (run.agent ? `${run.stack} (${run.agent})` : run.stack);

const runs = pendingRuns();
if (listOnly || runs.length === 0) {
  console.log(
    runs.length ? runs.map(label).join("\n") : "Every bundled stack has a current green run.",
  );
  process.exit(0);
}

console.log(`Benching ${runs.length} runs: ${runs.map(label).join(", ")}`);
const failed: string[] = [];
for (const [index, run] of runs.entries()) {
  console.log(`\n[${index + 1}/${runs.length}] bun run bench ${runArgs(run).join(" ")}`);
  const result = Bun.spawnSync(["bun", "scripts/bench.ts", ...runArgs(run)], {
    cwd: root,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (result.exitCode === 130 || result.signalCode) {
    const rest = runs.slice(index + 1).map(label);
    console.log(`Interrupted at ${label(run)}; skipped ${rest.join(", ") || "none"}.`);
    process.exit(130);
  }
  if (result.exitCode !== 0) failed.push(label(run));
}
console.log(
  failed.length
    ? `\n${failed.length} of ${runs.length} failed: ${failed.join(", ")}`
    : `\nAll ${runs.length} benched.`,
);
process.exit(failed.length ? 1 : 0);
