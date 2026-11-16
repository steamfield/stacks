import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { encodeManifest, MANIFEST_PATH } from "../src/core/manifest";
import { ProjectState } from "../src/core/project-state";
import { countAsked } from "../src/core/runs";
import { ProjectRuns } from "../src/schemas/runs";
import { quiet, runCli, terminal } from "./helpers/cli";
import { ledgerRegistry, registryFingerprint, runRecord, startedAt } from "./helpers/ledger";
import {
  readRecord,
  recordPath,
  stateEnv,
  workspace,
  writeRecordedProject,
} from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

async function project() {
  const home = space.dir();
  const root = space.dir();
  const fingerprint = await registryFingerprint(ledgerRegistry(space.dir()));
  const manifest = writeRecordedProject(root, home, [], {
    stack: { id: "sample", origin: "bundled", trusted: true },
    createdAt: startedAt,
    fingerprint,
    briefWords: 123,
    handoff: { kind: "print", at: startedAt },
  });
  const file = recordPath(home, manifest.projectId);
  writeFileSync(
    file,
    JSON.stringify(
      Schema.encodeSync(ProjectState)({
        ...readRecord(file),
        firstGreenAt: "2026-10-27T09:10:00.000Z",
        firstTestPassAt: "2026-10-27T09:04:30.000Z",
      }),
    ),
  );
  const state = join(root, ".stacks", "state");
  mkdirSync(state);
  const notes = join(root, ".stacks", "NOTES.md");
  writeFileSync(
    notes,
    "# Notes\n\n## Asked\n\n- Which module?\n- Which port?\n\n## Findings\n- A finding, not a question.\n",
  );
  return { home, root, file, notes, runs: join(state, "runs.jsonl"), manifest };
}

type Project = Awaited<ReturnType<typeof project>>;
const runs = (p: Project, args = ["--json"], cwd = p.root) =>
  runCli(["runs", ...args], {
    home: p.home,
    env: { ...quiet, ...stateEnv(p.home), AI_AGENT: "claude" },
    host: { cwd },
  });
const decode = (stdout: string) =>
  Schema.decodeUnknownSync(ProjectRuns, { onExcessProperty: "error" })(JSON.parse(stdout));

test("runs uses trusted state timing, counts decoded lines, and counts Asked lists [2.0c#3]", async () => {
  const p = await project();
  const first = runRecord({ at: "2026-10-27T09:01:00.000Z" });
  const last = runRecord({ at: "2026-10-27T09:12:00.000Z", outcome: "failed" });
  writeFileSync(
    p.runs,
    [
      JSON.stringify(first),
      "{ truncated",
      JSON.stringify({ ...first, schemaVersion: 2 }),
      JSON.stringify(last),
      "",
    ].join("\n"),
  );
  const before = [p.file, p.notes, p.runs].map((file) => readFileSync(file, "utf8"));
  const result = await runs(p);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(decode(result.stdout)).toEqual({
    stack: "sample",
    fingerprint: p.manifest.fingerprint,
    createdAt: startedAt,
    handoff: "print",
    briefWords: 123,
    verifyRuns: 2,
    lastOutcome: "failed",
    minutesToGreen: 10,
    minutesToLastGreen: 1,
    minutesToFirstTest: 4.5,
    interventions: 2,
    stateRecord: true,
    skippedLines: 2,
  });
  expect([p.file, p.notes, p.runs].map((file) => readFileSync(file, "utf8"))).toEqual(before);
});

test("no NOTES means unknown interventions; no state means unknown timings despite green history [2.0c#3]", async () => {
  const p = await project();
  writeFileSync(p.runs, `${JSON.stringify(runRecord())}\n`);
  rmSync(p.notes);
  rmSync(p.file);
  const result = await runs(p);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(decode(result.stdout)).toMatchObject({
    verifyRuns: 1,
    lastOutcome: "green",
    interventions: null,
    stateRecord: false,
    minutesToGreen: null,
    minutesToFirstTest: null,
  });
});

test("a pre-fingerprint manifest and unfinished state retain unknown values [2.0c#8]", async () => {
  const p = await project();
  const { fingerprint, handoff, ...legacy } = p.manifest;
  writeFileSync(join(p.root, MANIFEST_PATH), encodeManifest(legacy));
  writeFileSync(
    p.file,
    JSON.stringify(
      Schema.encodeSync(ProjectState)({
        ...readRecord(p.file),
        firstGreenAt: null,
        firstTestPassAt: null,
      }),
    ),
  );
  const result = await runs(p);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  const summary = decode(result.stdout);
  expect(summary).toMatchObject({
    fingerprint: null,
    stateRecord: true,
    minutesToGreen: null,
    minutesToFirstTest: null,
  });
  expect(summary).not.toHaveProperty("handoff");
});

test("outside a project, runs returns NotFound with one envelope and empty stdout [2.0c#3]", async () => {
  const home = space.dir();
  const result = await runCli(["runs", "--json"], { home, env: quiet, host: { cwd: home } });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim().split("\n")).toHaveLength(1);
  expect(JSON.parse(result.stderr)).toEqual({
    error: {
      tag: "NotFound",
      message: "Not found.",
      retryable: false,
      next: "run this command again from inside a project stacks new created, or create one with stacks new <stack> <dir>.",
      details: { kind: "project", looked: home, suggestions: [] },
    },
  });
});

test("runs finds state from a symlinked nested cwd with spaces and non-ASCII names [2.0c#7]", async () => {
  const p = await project();
  writeFileSync(p.runs, `${JSON.stringify(runRecord())}\n`);
  const nested = join(p.root, "naïve project", "-nested");
  mkdirSync(nested, { recursive: true });
  const link = join(space.dir(), "project link");
  symlinkSync(p.root, link);
  const result = await runs(p, ["--json"], join(link, "naïve project", "-nested"));
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(decode(result.stdout)).toMatchObject({
    stack: "sample",
    stateRecord: true,
    minutesToGreen: 10,
    verifyRuns: 1,
  });
});

test.each(["missing", "empty", "invalid-only"])(
  "%s run history still reports state and has no last outcome [2.0c#8]",
  async (kind) => {
    const p = await project();
    if (kind !== "missing") writeFileSync(p.runs, kind === "empty" ? "" : "not JSON\n{}\n");
    const result = await runs(p);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(decode(result.stdout)).toMatchObject({
      verifyRuns: 0,
      lastOutcome: null,
      minutesToGreen: 10,
      stateRecord: true,
      skippedLines: kind === "invalid-only" ? 2 : 0,
    });
  },
);

test("Asked counts nonempty list items, not wrapped prose or later sections [2.0c#9]", async () => {
  const p = await project();
  const notes =
    "# Notes\n\n## Findings\n- Ignore this.\n\n## Asked\n\n- First question\n  continuation, not another question\n-   \n* Second question\n+ Third question\n\nA paragraph is not an intervention.\n\n## Later\n- Ignore this too.\n";
  writeFileSync(p.notes, notes);
  expect(countAsked(notes)).toBe(3);
  expect(countAsked("# Notes\n\n## Asked\n\n## Findings\n- Not asked.\n")).toBe(0);
  expect(countAsked("# Notes\n\n## Findings\n- Not asked.\n")).toBe(0);
  const result = await runs(p);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(decode(result.stdout).interventions).toBe(3);
});

test("an app failure after a green base stays failed and the ledger preserves stages [2.0c#12]", async () => {
  const p = await project();
  const run = runRecord({ outcome: "failed", stages: { base: "green", app: "failed" } });
  writeFileSync(p.runs, `${JSON.stringify(run)}\n`);
  const result = await runs(p);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(decode(result.stdout)).toMatchObject({ verifyRuns: 1, lastOutcome: "failed" });
  const { LedgerRecord } = await import("../src/schemas/ledger");
  const { ledgerRecord } = await import("./helpers/ledger");
  const base = await ledgerRecord(ledgerRegistry(space.dir()), { result: "fail", run });
  expect(Schema.decodeUnknownSync(LedgerRecord)(base).run).toEqual(run);
});

test("human and agent text include the project's run numbers [2.0c#3]", async () => {
  const p = await project();
  writeFileSync(p.runs, `${JSON.stringify(runRecord())}\n`);
  for (const host of [terminal, { stdoutIsTTY: false }]) {
    const result = await runCli(["runs"], {
      home: p.home,
      env: { ...quiet, ...stateEnv(p.home) },
      host: { ...host, cwd: p.root },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const fields: ReadonlyArray<{ label: RegExp; value: string | RegExp }> = [
      { label: /^\s*\|?\s*stack\b/i, value: "sample" },
      { label: /^\s*\|?\s*fingerprint\b/i, value: p.manifest.fingerprint ?? "missing fingerprint" },
      { label: /^\s*\|?\s*created(?:\s+at)?\b/i, value: startedAt },
      { label: /^\s*\|?\s*handoff\b/i, value: "print" },
      { label: /^\s*\|?\s*brief\s+words\b/i, value: /^123(?:\s+words)?$/i },
      { label: /^\s*\|?\s*verify\s+runs\b/i, value: /^1$/ },
      { label: /^\s*\|?\s*last\s+outcome\b/i, value: "green" },
      { label: /^\s*\|?\s*minutes\s+to\s+green\b/i, value: /^10(?:\.0+)?(?:\s+min(?:utes)?)?$/i },
      { label: /^\s*\|?\s*minutes\s+to\s+last\s+green\b/i, value: /^1(?:\.0+)?$/ },
      {
        label: /^\s*\|?\s*minutes to first successful test command \(run completion\)/i,
        value: /^4\.5(?:\s+min(?:utes)?)?$/i,
      },
      { label: /^\s*\|?\s*interventions\b/i, value: /^2$/ },
      { label: /^\s*\|?\s*state\s+record\b/i, value: /^(?:true|yes|present|available)$/i },
      { label: /^\s*\|?\s*skipped\s+lines\b/i, value: /^0$/ },
    ];
    for (const { label, value } of fields) {
      const line = result.stdout.split("\n").find((line) => label.test(line));
      expect(line, `missing summary field ${label.source}`).toBeDefined();
      const shown = line
        ?.replace(label, "")
        .replace(/^\s*[:|]?\s*/, "")
        .replace(/\s*\|?\s*$/, "");
      if (typeof value === "string") expect(shown).toBe(value);
      else expect(shown).toMatch(value);
    }
  }
});

test("text rounds minutes to one decimal while JSON keeps the exact value", async () => {
  const p = await project();
  writeFileSync(p.runs, `${JSON.stringify(runRecord({ secondsSinceCreated: 13 }))}\n`);
  const text = await runs(p, []);
  expect(text.status).toBe(0);
  expect(text.stderr).toBe("");
  expect(text.stdout).toContain("Minutes to last green: 0.2\n");
  expect(text.stdout).toContain("Minutes to green: 10\n");
  const json = await runs(p);
  expect(decode(json.stdout).minutesToLastGreen).toBe(13 / 60);
});

test.each([
  {
    name: "two full green runs use the later completion",
    history: [
      runRecord({ secondsSinceCreated: 600 }),
      runRecord({ at: "2026-10-27T09:11:00.000Z", secondsSinceCreated: 765 }),
      runRecord({ outcome: "failed", secondsSinceCreated: 900 }),
    ],
    expected: 12.75,
  },
  {
    name: "one full green has the same first and last green minutes",
    history: [runRecord({ secondsSinceCreated: 600 })],
    expected: 10,
  },
  {
    name: "no green run has unknown last green minutes",
    history: [runRecord({ outcome: "failed", secondsSinceCreated: 600 })],
    expected: null,
  },
  {
    name: "a later manifest-only green does not replace the last full green",
    history: [
      runRecord({ secondsSinceCreated: 600 }),
      runRecord({ tamperCheck: "manifest-only", secondsSinceCreated: 900 }),
    ],
    expected: 10,
  },
  {
    name: "a manifest-only green alone has unknown last green minutes",
    history: [runRecord({ tamperCheck: "manifest-only", secondsSinceCreated: 600 })],
    expected: null,
  },
])("$name", async ({ history, expected }) => {
  const p = await project();
  writeFileSync(p.runs, `${history.map((run) => JSON.stringify(run)).join("\n")}\n`);
  const result = await runs(p);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(decode(result.stdout)).toMatchObject({
    verifyRuns: history.length,
    minutesToGreen: 10,
    minutesToLastGreen: expected,
  });
});
