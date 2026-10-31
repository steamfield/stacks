import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { ProjectRuns } from "../src/schemas/runs";
import { quiet, runCli } from "./helpers/cli";
import { runRecord } from "./helpers/ledger";
import { recordPath, stateEnv, workspace, writeRecordedProject } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

function project() {
  const home = space.dir();
  const root = space.dir();
  const manifest = writeRecordedProject(root, home, []);
  const notes = join(root, ".stacks/NOTES.md");
  const history = join(root, ".stacks/state/runs.jsonl");
  mkdirSync(join(root, ".stacks/state"));
  const invoke = (args = ["--json"], human = false) =>
    runCli(["runs", ...args], {
      home,
      env: { ...quiet, ...stateEnv(home) },
      host: { cwd: root, stdoutIsTTY: human },
    });
  return { home, root, notes, history, state: recordPath(home, manifest.projectId), invoke };
}

test.each([
  { label: "backticks", fence: "```", close: "```" },
  { label: "tildes", fence: "~~~", close: "~~~~" },
  { label: "long backticks", fence: "````", close: "`````" },
])("Asked ignores $label examples, nested bullets and later headings", async ({ fence, close }) => {
  const p = project();
  const text = [
    "# Notes",
    `${fence}markdown`,
    "## Asked",
    "- Example before the real section",
    close,
    "## Asked ##",
    "1. Which database?",
    "2) Which port?",
    "    - Nested detail, not another question",
    `${fence}markdown`,
    "## Findings",
    "- Example inside Asked",
    fence[0] === "`" ? "~~~" : "```",
    "- A mismatched fence does not end the example",
    close,
    "+ Which layout?",
    "### Resolution",
    "- Not a question",
    "",
  ].join("\r\n");
  writeFileSync(p.notes, text);
  const result = await p.invoke();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(Schema.decodeUnknownSync(ProjectRuns)(JSON.parse(result.stdout))).toMatchObject({
    interventions: 3,
    verifyRuns: 0,
  });
  expect(readFileSync(p.notes, "utf8")).toBe(text);
});

test.each(["json", "human", "agent"])(
  "%s reports the last usable history line after truncated and future records",
  async (audience) => {
    const p = project();
    writeFileSync(p.notes, "## Asked\n- Which API?\n");
    const history = [
      "  ",
      JSON.stringify(runRecord({ at: "2026-10-29T09:00:00Z" })),
      "null",
      JSON.stringify({ ...runRecord(), schemaVersion: 2 }),
      JSON.stringify(runRecord({ outcome: "partial" })),
      "{ truncated final write",
      "",
    ].join("\r\n");
    writeFileSync(p.history, history);
    const result = await p.invoke(audience === "json" ? ["--json"] : [], audience === "human");
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    if (audience === "json") {
      expect(Schema.decodeUnknownSync(ProjectRuns)(JSON.parse(result.stdout))).toMatchObject({
        verifyRuns: 2,
        lastOutcome: "partial",
        skippedLines: 3,
        interventions: 1,
      });
    } else {
      expect(result.stdout).toContain("Verify runs: 2\n");
      expect(result.stdout).toContain("Last outcome: partial\n");
      expect(result.stdout).toContain("Skipped lines: 3\n");
      expect(result.stdout).toContain("Interventions: 1\n");
    }
    expect(readFileSync(p.history, "utf8")).toBe(history);
  },
);

test.each(["{ truncated", "{}", '{"schemaVersion":1,"unexpected":true}'])(
  "a damaged state record %j leaves history usable without inventing timings",
  async (state) => {
    const p = project();
    writeFileSync(p.state, state);
    writeFileSync(p.history, JSON.stringify(runRecord()));
    const result = await p.invoke();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(Schema.decodeUnknownSync(ProjectRuns)(JSON.parse(result.stdout))).toMatchObject({
      verifyRuns: 1,
      lastOutcome: "green",
      minutesToGreen: null,
      minutesToFirstTest: null,
      stateRecord: false,
    });
    expect(readFileSync(p.state, "utf8")).toBe(state);
  },
);

test.skipIf(process.getuid?.() === 0)(
  // Unreadable history is PermissionDenied (tests/discovery-access.test.ts); unreadable notes stay unknown.
  "unreadable notes are unknown without losing history or trusted state",
  async () => {
    const p = project();
    writeFileSync(p.notes, "## Asked\n- Private question\n");
    writeFileSync(p.history, JSON.stringify(runRecord()));
    chmodSync(p.notes, 0o000);
    try {
      const result = await p.invoke();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(Schema.decodeUnknownSync(ProjectRuns)(JSON.parse(result.stdout))).toMatchObject({
        interventions: null,
        verifyRuns: 1,
        lastOutcome: "green",
        skippedLines: 0,
        stateRecord: true,
      });
    } finally {
      chmodSync(p.notes, 0o600);
    }
    expect(readFileSync(p.notes, "utf8")).toContain("Private question");
    expect(JSON.parse(readFileSync(p.history, "utf8"))).toEqual(runRecord());
  },
);
