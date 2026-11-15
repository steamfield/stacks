import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Exit, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { appendRecord, type LedgerRead, latestRecord, readLedger } from "../src/core/ledger";
import { InvalidConfig } from "../src/errors";
import { Ledger, LedgerRecord } from "../src/schemas/ledger";
import { NewResult } from "../src/schemas/new";
import { VerifyResult } from "../src/schemas/verify";
import { quiet, runCli } from "./helpers/cli";
import { ledgerRecord, ledgerRegistry, writeLedger } from "./helpers/ledger";
import { newRegistry } from "./helpers/registry";
import { runRecords, splitEvents, stateEnv, verify, workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());
const key = { stack: "sample", with: [], preset: "sandbox", agent: "claude" } as const;
const read = (root: string): Promise<LedgerRead> =>
  Effect.runPromise(readLedger(root).pipe(Effect.provide(NodeServices.layer)));

test("latest date wins, later position breaks ties, and every key component matters [2.0c#1]", async () => {
  const root = ledgerRegistry(space.dir());
  const old = await ledgerRecord(root, { date: "2026-10-25" });
  const later = { ...old, date: "2026-10-26", result: "fail" as const };
  const tie = { ...later, result: "partial" as const };
  const others = [
    { ...old, stack: "another" },
    { ...old, with: ["extra"] },
    { ...old, preset: "default" },
    { ...old, agent: "codex" as const },
  ].map((r) => ({ ...r, date: "2026-10-28" }));
  writeLedger(root, [
    later,
    old,
    tie,
    ...others,
    { ...old, schemaVersion: 2 },
    { ...old, result: "unknown" },
    { ...old, run: { schemaVersion: 1 } },
  ]);
  const loaded = await read(root);
  expect(loaded).toEqual({
    present: true,
    fileValid: true,
    records: [later, old, tie, ...others],
    skipped: { newer: 1, invalid: 2 },
  });
  expect(latestRecord(loaded.records, key)).toEqual(tie);
  expect(latestRecord([later, old], key)).toEqual(later);
  expect(latestRecord([later, tie], key)).toEqual(tie);
  expect(latestRecord(loaded.records, { ...key, stack: "absent" })).toBeNull();
});

test("append creates a missing ledger and preserves existing records in file order [2.0c#1]", async () => {
  const root = ledgerRegistry(space.dir());
  const record = await ledgerRecord(root);
  expect(await read(root)).toMatchObject({
    present: false,
    records: [],
    skipped: { newer: 0, invalid: 0 },
  });
  await Effect.runPromise(appendRecord(root, record).pipe(Effect.provide(NodeServices.layer)));
  const text = readFileSync(join(root, "runs.json"), "utf8");
  expect(text).toBe(`${JSON.stringify({ schemaVersion: 1, records: [record] }, null, 2)}\n`);
  expect(Schema.decodeUnknownSync(Ledger)(JSON.parse(text))).toEqual({
    schemaVersion: 1,
    records: [record],
  });
  const next = { ...record, date: "2026-10-28" };
  // Future and invalid records must survive an append even though readers skip them.
  const unknown = { schemaVersion: 2, future: "keep" };
  writeLedger(root, [record, unknown, { malformed: true }]);
  await Effect.runPromise(appendRecord(root, next).pipe(Effect.provide(NodeServices.layer)));
  expect(JSON.parse(readFileSync(join(root, "runs.json"), "utf8"))).toEqual({
    schemaVersion: 1,
    records: [record, unknown, { malformed: true }, next],
  });
});

test.each([
  "",
  "{ unfinished",
  '{"schemaVersion":2,"records":[]}',
  '{"schemaVersion":1,"records":{}}',
])(
  "an undecodable ledger is readable as empty but cannot be overwritten: %s [2.0c#1] [2.0c#8]",
  async (text) => {
    const root = ledgerRegistry(space.dir());
    const record = await ledgerRecord(root);
    const file = join(root, "runs.json");
    writeFileSync(file, text);
    expect(await read(root)).toEqual({
      present: true,
      fileValid: false,
      records: [],
      skipped: { newer: 0, invalid: 0 },
    });
    const exit = await Effect.runPromiseExit(
      appendRecord(root, record).pipe(Effect.provide(NodeServices.layer)),
    );
    expect(exit).toEqual(Exit.fail(new InvalidConfig({ details: { path: file } })));
    expect(readFileSync(file, "utf8")).toBe(text);
  },
);

test("LedgerRecord keeps real verify records unchanged, including detected agent other [2.0c#2]", async () => {
  const home = space.dir();
  const created = await runCli(["new", "fixture-stack", "app", "--json"], {
    home,
    env: { ...quiet, ...stateEnv(home) },
    host: { registry: newRegistry },
  });
  expect(created.status).toBe(0);
  expect(created.stderr).toBe("");
  expect(Schema.decodeUnknownSync(NewResult)(JSON.parse(created.stdout))).toHaveProperty(
    "fingerprint",
  );
  const root = join(home, "app");
  const registry = ledgerRegistry(space.dir());
  const base = await ledgerRecord(registry);
  for (const agentEnv of [{}, { AI_AGENT: "unrecognised-agent" }]) {
    const result = await verify(["--json"], {
      cwd: root,
      home,
      env: { ...stateEnv(home), ...agentEnv },
    });
    expect(result.status).toBe(0);
    // `verify --json` streams one started and one finished event per step; nothing else.
    const { events, rest } = splitEvents(result.stderr);
    expect(rest).toBe("");
    expect(events).toEqual([
      { event: "step-started", name: "stack-ran", phase: "setup" },
      {
        event: "step-finished",
        name: "stack-ran",
        phase: "setup",
        status: "passed",
        durationMs: expect.any(Number),
      },
      { event: "step-started", name: "ran", phase: "check" },
      {
        event: "step-finished",
        name: "ran",
        phase: "check",
        status: "passed",
        durationMs: expect.any(Number),
      },
    ]);
    expect(Schema.decodeUnknownSync(VerifyResult)(JSON.parse(result.stdout)).outcome).toBe("green");
  }
  const records = runRecords(root);
  expect(records.map((record) => record.agent)).toEqual(["none", "other"]);
  for (const run of records) {
    const decoded = Schema.decodeUnknownSync(LedgerRecord, { onExcessProperty: "error" })({
      ...base,
      run,
    });
    expect(decoded.agent).toBe("claude");
    expect(decoded.run).toEqual(run);
  }
});

test("a ledger path that is a directory is not a valid file and append leaves it intact [2.0c#8]", async () => {
  const root = ledgerRegistry(space.dir());
  const record = await ledgerRecord(root);
  const file = join(root, "runs.json");
  mkdirSync(file);
  writeFileSync(join(file, "keep"), "keep\n");
  expect(await read(root)).toMatchObject({ fileValid: false, records: [] });
  expect(
    await Effect.runPromiseExit(
      appendRecord(root, record).pipe(Effect.provide(NodeServices.layer)),
    ),
  ).toEqual(Exit.fail(new InvalidConfig({ details: { path: file } })));
  expect(readFileSync(join(file, "keep"), "utf8")).toBe("keep\n");
});

test.skipIf(process.getuid?.() === 0)(
  "a failed append keeps the existing ledger and unrelated files [2.0c#11]",
  async () => {
    const root = ledgerRegistry(space.dir());
    const record = await ledgerRecord(root);
    writeLedger(root, [record]);
    const file = join(root, "runs.json");
    const before = readFileSync(file, "utf8");
    writeFileSync(join(root, "keep"), "keep\n");
    const names = readdirSync(root).sort();
    chmodSync(root, 0o500);
    try {
      const exit = await Effect.runPromiseExit(
        appendRecord(root, record).pipe(Effect.provide(NodeServices.layer)),
      );
      expect(exit).toEqual(Exit.fail(new InvalidConfig({ details: { path: file } })));
      expect(readFileSync(file, "utf8")).toBe(before);
      expect(readFileSync(join(root, "keep"), "utf8")).toBe("keep\n");
      expect(readdirSync(root).sort()).toEqual(names);
    } finally {
      chmodSync(root, 0o700);
    }
  },
);

test("parallel appends keep every record, and the lock is released", async () => {
  const root = ledgerRegistry(space.dir());
  const record = await ledgerRecord(root);
  writeLedger(root, []);
  const dates = Array.from({ length: 12 }, (_, n) => `2026-11-${String(n + 1).padStart(2, "0")}`);
  await Promise.all(
    dates.map((date) =>
      Effect.runPromise(
        appendRecord(root, { ...record, date }).pipe(Effect.provide(NodeServices.layer)),
      ),
    ),
  );
  const { records } = await read(root);
  expect(records.map((row) => row.date).sort()).toEqual(dates);
  expect(readdirSync(root)).not.toContain("runs.json.lock");
});
