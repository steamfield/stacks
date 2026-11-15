import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { AgentId } from "@steamfield/stacks-format";
import { Effect, Exit, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { fingerprint, proofFingerprint } from "../src/core/fingerprint";
import type { LedgerRecord } from "../src/schemas/ledger";
import { bundledAt, composeExit } from "./helpers/compose";
import { ledgerRecord, ledgerRegistry, writeLedger } from "./helpers/ledger";
import {
  findingsAre,
  fragment,
  rotWorkspace,
  setupBody,
  ship,
  stack,
  validateRot,
} from "./helpers/rot";
import { missingSearchNotes } from "./helpers/search-fixture";

const space = rotWorkspace();
afterEach(() => space.cleanup());
const validate = (root: string) => validateRot(root, { home: space.temp() });

function registry() {
  const root = ledgerRegistry(space.temp());
  // Keep the ledger helper's files but supply the D7 layers and Setup section validate needs.
  stack(root);
  return root;
}

async function record(root: string, overrides: Partial<LedgerRecord> = {}) {
  const base = await ledgerRecord(root, overrides);
  if (base.preset !== "default" && base.preset !== "sandbox")
    throw new Error(`Unsupported fixture preset: ${base.preset}`);
  const exit = await composeExit(
    {
      stack: base.stack,
      with: [...base.with],
      preset: base.preset,
      agents: [Schema.decodeUnknownSync(AgentId)(base.agent)],
    },
    { roots: bundledAt(root) },
  );
  if (Exit.isFailure(exit))
    throw new Error(`Ledger fixture did not compose: ${JSON.stringify(exit)}`);
  return {
    ...base,
    fingerprint: await Effect.runPromise(
      proofFingerprint(exit.value).pipe(Effect.provide(NodeServices.layer)),
    ),
  };
}

test("a current sandbox pass is clean, and a body edit names the affected key and green date [2.2#7]", async () => {
  const root = registry();
  const pass = await record(root);
  writeLedger(root, [pass]);
  const before = await validate(root);
  findingsAre(before.report.findings, [...missingSearchNotes({ stacks: ["sample"] })]);
  stack(root, "sample", "", setupBody.replace("project", "application"));
  const after = await validate(root);
  findingsAre(after.report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    ["ledger-changed", "note", { entry: "sample", text: ["sample"] }],
  ]);
  expect([after.status, after.warnings]).toEqual([before.status, before.warnings]);
  for (const value of ["sample", "sandbox", "claude", pass.date])
    expect(after.report.findings[1]?.message).toContain(value);
});

test("changing only a codex adapter leaves the claude ledger key current [2.2#7]", async () => {
  const root = registry();
  const entry = join(root, "stacks", "sample");
  ship(entry, "adapters/claude/CLAUDE.md", "Use the brief.\n");
  const codex = ship(entry, "adapters/codex/AGENTS.md", "Use the brief.\n");
  writeLedger(root, [await record(root), await record(root, { agent: "codex" })]);
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
  ]);
  writeFileSync(codex, "Read the brief.\n");
  const { report, status, warnings } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    ["ledger-changed", "note", { entry: "sample", text: ["sample"] }],
  ]);
  expect(report.findings[1]?.message).toContain("codex");
  expect(report.findings[1]?.message).not.toContain("claude");
  expect([status, warnings]).toEqual([0, 0]);
});

test("a default pass doesn't prove sandbox, and each preset compares its own last pass [2.2#7]", async () => {
  const root = registry();
  const normal = await record(root, { preset: "default" });
  writeLedger(root, [normal]);
  const unproven = await validate(root);
  findingsAre(unproven.report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    ["ledger-unproven", "note", { entry: "sample", text: ["sample"] }],
  ]);
  expect([unproven.status, unproven.warnings]).toEqual([0, 0]);
  stack(root, "sample", "", `${setupBody}\nKeep it small.\n`);
  writeLedger(root, [normal, await record(root)]);
  const changed = await validate(root);
  findingsAre(changed.report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    ["ledger-changed", "note", { entry: "sample", text: ["sample"] }],
  ]);
  expect(changed.report.findings[1]?.message).toContain("default");
});

test("latest infra doesn't report stack failure and doesn't hide a changed last green [2.2#7]", async () => {
  const root = registry();
  const pass = await record(root, { date: "2026-10-20" });
  const infra = await record(root, { result: "infra", date: "2026-10-22" });
  writeLedger(root, [infra, pass]);
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
  ]);
  stack(root, "sample", "", `${setupBody}\nKeep it small.\n`);
  const { report, status, warnings } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    ["ledger-changed", "note", { entry: "sample", text: ["sample"] }],
  ]);
  expect(report.findings[1]?.message).toContain(pass.date);
  expect([status, warnings]).toEqual([0, 0]);
});

test.each(["fail", "partial"] as const)(
  "a latest %s reports ledger-failed without changing status or warning counts [2.2#7]",
  async (result) => {
    const root = registry();
    const pass = await record(root, { date: "2026-10-20" });
    writeLedger(root, [await record(root, { result, date: "2026-10-22" }), pass]);
    const got = await validate(root);
    findingsAre(got.report.findings, [
      ...missingSearchNotes({ stacks: ["sample"] }),
      ["ledger-failed", "note", { entry: "sample", text: ["sample"] }],
    ]);
    expect(got.report.findings[1]?.message).toContain("sample");
    expect([got.status, got.warnings]).toEqual([0, 0]);
  },
);

test.each(["fail", "partial"] as const)(
  "a newer %s at the current fingerprint doesn't hide a change since the last pass [2.2#7]",
  async (result) => {
    const root = registry();
    const pass = await record(root, { date: "2026-10-20" });
    stack(root, "sample", "", `${setupBody}\nChanged.\n`);
    const failed = await record(root, { result, date: "2026-10-22" });
    expect(failed.fingerprint).not.toBe(pass.fingerprint);
    writeLedger(root, [pass, failed]);
    const { report, status, warnings } = await validate(root);
    findingsAre(report.findings, [
      ...missingSearchNotes({ stacks: ["sample"] }),
      ["ledger-changed", "note", { entry: "sample", text: ["sandbox", "claude", pass.date] }],
      ["ledger-failed", "note", { entry: "sample", text: ["sample"] }],
    ]);
    expect([status, warnings]).toEqual([0, 0]);
  },
);

test.each(["{broken", '{"schemaVersion":2,"records":[]}', '{"schemaVersion":1,"records":{}}'])(
  "an undecodable ledger %s reports ledger-schema and skips all ledger notes [2.2#8]",
  async (text) => {
    const root = registry();
    writeFileSync(join(root, "runs.json"), text);
    const { report, status } = await validate(root);
    findingsAre(report.findings, [
      ...missingSearchNotes({ stacks: ["sample"] }),
      ["ledger-schema", "error", { file: "runs.json" }],
    ]);
    expect(status).toBe(2);
  },
);

test("a newer record alone is skipped without a schema finding [2.2#8]", async () => {
  const root = space.temp();
  mkdirSync(join(root, "stacks"));
  // No v1 stack exists to generate ledger-unproven; this isolates forward compatibility.
  writeLedger(root, [{ schemaVersion: 2 }]);
  const { report, status } = await validate(root);
  findingsAre(report.findings, []);
  expect(status).toBe(0);
});

test("an invalid v1 record makes the whole ledger unsuitable for notes even beside valid passes [2.2#14]", async () => {
  const root = registry();
  const pass = await record(root);
  writeLedger(root, [pass, { ...pass, agent: "unknown-agent" }]);
  stack(root, "sample", "", `${setupBody}\nChanged.\n`);
  const { report } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    ["ledger-schema", "error", { file: "runs.json" }],
  ]);
});

test("a missing ledger is normal, an empty one is unproven, and newer records don't hide a valid pass [2.2#14]", async () => {
  const root = registry();
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
  ]);
  writeLedger(root, []);
  const empty = await validate(root);
  findingsAre(empty.report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    ["ledger-unproven", "note", { entry: "sample", text: ["sample"] }],
  ]);
  expect([empty.status, empty.warnings]).toEqual([0, 0]);
  writeLedger(root, [await record(root), { schemaVersion: 2, date: "2099-01-01", result: "fail" }]);
  findingsAre((await validate(root)).report.findings, missingSearchNotes({ stacks: ["sample"] }));
});

test("runs with added fragments neither prove nor dirty the default composition [2.2#14]", async () => {
  const root = registry();
  stack(root, "sample", "fragments:\n  optional: [extra]");
  fragment(root, "extra");
  const extra = await record(root, { with: ["extra"] });
  writeLedger(root, [extra]);
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["extra"] }),
    ["ledger-unproven", "note", { entry: "sample", text: ["sample"] }],
  ]);
  writeLedger(root, [await record(root), { ...extra, result: "fail", date: "2099-01-01" }]);
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["extra"] }),
  ]);
});

test("last pass uses date then file order, and a current green clears an earlier failed key [2.2#14]", async () => {
  const root = registry();
  const old = await record(root, { date: "2026-10-20" });
  stack(root, "sample", "", `${setupBody}\nChanged.\n`);
  const current = await record(root, { date: "2026-10-22" });
  const fail = { ...current, result: "fail", date: "2026-10-21" };
  writeLedger(root, [current, fail, old]);
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
  ]);
  writeLedger(root, [current, { ...old, date: current.date }]);
  const { report } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    ["ledger-changed", "note", { entry: "sample", text: ["sample"] }],
  ]);
  expect(report.findings[1]?.message).toContain(current.date);
});

test("a scaffold proof of the current content clears another agent's stale pass of that preset", async () => {
  const root = registry();
  const pass = await record(root);
  stack(root, "sample", "", `${setupBody}\nChanged.\n`);
  const scaffold = { ...(await record(root)), agent: "none", mode: "scaffold", date: "2026-10-28" };
  writeLedger(root, [pass]);
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    ["ledger-changed", "note", { entry: "sample", text: ["sample"] }],
  ]);
  writeLedger(root, [pass, scaffold]);
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
  ]);
});

test("only a canary reports a shared fragment change, and a pass of the whole composition clears it", async () => {
  const root = registry();
  stack(root, "sample", "fragments:\n  default: [shared]");
  stack(root, "other", "fragments:\n  default: [shared]");
  const shared = fragment(root, "shared");
  writeFileSync(join(root, "canaries.json"), JSON.stringify({ stacks: ["sample"] }));
  const whole = async (id: string) => {
    const exit = await composeExit(
      { stack: id, preset: "sandbox", agents: ["claude"] },
      { roots: bundledAt(root) },
    );
    if (Exit.isFailure(exit)) throw new Error("Canary fixture did not compose");
    return Effect.runPromise(fingerprint(exit.value).pipe(Effect.provide(NodeServices.layer)));
  };
  const proofOf = async (id: string) => ({
    ...(await record(root, { stack: id })),
    compositionFingerprint: await whole(id),
  });
  writeLedger(root, [await proofOf("sample"), await proofOf("other")]);
  const clean = missingSearchNotes({ stacks: ["other", "sample"], fragments: ["shared"] });
  findingsAre((await validate(root)).report.findings, [...clean]);

  writeFileSync(
    join(shared, "FRAGMENT.md"),
    `${readFileSync(join(shared, "FRAGMENT.md"), "utf8")}\nChanged.\n`,
  );
  const before = [await proofOf("other")];
  const { report } = await validate(root);
  findingsAre(report.findings, [
    ...clean,
    ["ledger-canary", "note", { entry: "sample", text: ["sample", "canary"] }],
  ]);
  writeLedger(root, [...before, await proofOf("sample")]);
  findingsAre((await validate(root)).report.findings, [...clean]);
});

test("a canaries.json naming an unknown stack is a warning", async () => {
  const root = registry();
  writeLedger(root, [await record(root)]);
  writeFileSync(join(root, "canaries.json"), JSON.stringify({ stacks: ["missing"] }));
  const { report } = await validate(root);
  expect(report.findings.find((finding) => finding.check === "ledger-canaries")).toMatchObject({
    severity: "warning",
    message: expect.stringContaining("unknown: missing"),
  });
});
