import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import type { RunRecord } from "@steamfield/stacks-format";
import { Effect, Exit } from "effect";
import { proofFingerprint } from "../../src/core/fingerprint";
import type { LedgerRecord } from "../../src/schemas/ledger";
import { bundledAt, composeExit } from "./compose";
import { minimal, writeEntry } from "./registry";

export const startedAt = "2026-10-27T09:00:00.000Z";
export const stackBody = "# Build it\n\nKeep the public API small.\n";

export function ledgerRegistry(root: string) {
  const stack = writeEntry({
    root,
    kind: "stack",
    dir: "sample",
    frontmatter: minimal("stack", "sample"),
    body: stackBody,
  });
  mkdirSync(join(stack, "files"));
  writeFileSync(join(stack, "files", "README.md.tmpl"), "# {{ project_name }}\n");
  return root;
}

export async function registryFingerprint(root: string) {
  const exit = await composeExit(
    { stack: "sample", agents: ["claude"], preset: "sandbox" },
    { roots: bundledAt(root) },
  );
  if (Exit.isFailure(exit)) throw new Error(`Fixture did not compose: ${JSON.stringify(exit)}`);
  return Effect.runPromise(proofFingerprint(exit.value).pipe(Effect.provide(NodeServices.layer)));
}

export function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    schemaVersion: 1,
    at: startedAt,
    cli: "0.1.0",
    agent: "none",
    outcome: "green",
    scope: "full",
    tamperCheck: "full",
    acceptedChanges: false,
    durationMs: 20,
    secondsSinceCreated: 60,
    steps: [{ name: "test", phase: "check", layer: "test", status: "passed", durationMs: 20 }],
    ...overrides,
  };
}

export async function ledgerRecord(root: string, overrides: Partial<LedgerRecord> = {}) {
  const record: LedgerRecord = {
    schemaVersion: 1,
    date: "2026-10-27",
    stack: "sample",
    with: [],
    preset: "sandbox",
    agent: "claude",
    agentVersion: "2.1.311",
    mode: "headless",
    repoCommit: "1".repeat(40),
    cli: "0.1.0",
    fingerprint: await registryFingerprint(root),
    briefWords: 123,
    result: "pass",
    agentEnded: "exit",
    run: runRecord(),
    verifyRuns: 2,
    minutesToGreen: 2.5,
    minutesToFirstTest: 1.5,
    agentMinutes: 2,
    interventions: 0,
    ...overrides,
  };
  return record;
}

export function writeLedger(root: string, records: readonly unknown[]) {
  writeFileSync(
    join(root, "runs.json"),
    `${JSON.stringify({ schemaVersion: 1, records }, null, 2)}\n`,
  );
}
