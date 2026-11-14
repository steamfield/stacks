import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { RunRecord } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { projectFiles } from "./fixtures/composed-files";
import { ledgerRegistry, registryFingerprint, stackBody } from "./helpers/ledger";
import { minimal, writeEntry } from "./helpers/registry";
import { workspace } from "./helpers/verify";

// Each scenario builds two git commits, fingerprints both registries and starts real importer
// processes. Keep a local 30 s budget for that work when another gate competes for the machine.
const space = workspace();
afterEach(() => space.release());
const script = join(import.meta.dirname, "../scripts/ledger-import.ts");
const template = readFileSync(join(import.meta.dirname, "fixtures/ledger-run-note.md"), "utf8");

async function repository() {
  const home = space.dir();
  const root = join(space.dir(), "repo with spaces café");
  mkdirSync(root);
  const env = {
    HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_STATE_HOME: join(home, "state"),
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    NO_COLOR: "1",
    LOG_LEVEL: "none",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_AUTHOR_DATE: "2026-10-27T09:00:00Z",
    GIT_COMMITTER_DATE: "2026-10-27T09:00:00Z",
  };
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();
  git("init", "--quiet");
  const registry = ledgerRegistry(join(root, "packages", "cli", "registry"));
  git("add", ".");
  git("commit", "--quiet", "-m", "fixture: original registry");
  const commit = git("rev-parse", "HEAD");
  const original = await registryFingerprint(registry);
  writeEntry({
    root: registry,
    kind: "stack",
    dir: "sample",
    frontmatter: minimal("stack", "sample"),
    body: `${stackBody}Changed guidance.\n`,
  });
  git("add", ".");
  git("commit", "--quiet", "-m", "fixture: changed body");
  const current = await registryFingerprint(registry);
  expect(current).not.toBe(original);
  const notes = join(root, "plans", "runs");
  mkdirSync(notes, { recursive: true });
  const note = join(notes, "2026-10-27-sample.md");
  writeFileSync(note, template.replace("{{COMMIT}}", commit));
  const invoke = (args: string[], cwd = root) =>
    new Promise<{ status: number; stdout: string; stderr: string }>((resolve) => {
      execFile(
        "bun",
        ["--no-env-file", "--config=/dev/null", script, ...args],
        {
          cwd,
          env,
          timeout: 15_000,
        },
        (error, stdout, stderr) => {
          let status = 0;
          if (error !== null) status = typeof error.code === "number" ? error.code : -1;
          resolve({ status, stdout, stderr });
        },
      );
    });
  return { root, registry, note, commit, original, current, git, invoke };
}

test("import fingerprints the note's commit and rerunning appends nothing [2.0c#5]", async () => {
  const f = await repository();
  const before = f.git("status", "--porcelain");
  const head = f.git("rev-parse", "HEAD");
  const body = readFileSync(join(f.registry, "stacks/sample/STACK.md"), "utf8");
  const result = await f.invoke([f.note]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).not.toContain("Module not found");
  const { Ledger, LedgerRecord } = await import("../src/schemas/ledger");
  const file = join(f.registry, "runs.json");
  const loaded = Schema.decodeUnknownSync(Ledger)(JSON.parse(readFileSync(file, "utf8")));
  expect(loaded.records).toHaveLength(1);
  const record = Schema.decodeUnknownSync(LedgerRecord, { onExcessProperty: "error" })(
    loaded.records[0],
  );
  const final = template.match(/```json\n([^\n]+)\n```/)?.[1];
  if (!final) throw new Error("fixture has no final verify record");
  expect(record).toMatchObject({
    date: "2026-10-27",
    stack: "sample",
    with: [],
    preset: "sandbox",
    repoCommit: f.commit,
    fingerprint: f.original,
    cli: "0.1.0",
    agent: "claude",
    agentVersion: "2.1.311",
    mode: "headless",
    briefWords: 123,
    result: "pass",
    agentEnded: "exit",
    verifyRuns: 2,
    minutesToGreen: 2.5,
    minutesToFirstTest: 1.5,
    interventions: 0,
    agentMinutes: 2,
    run: Schema.decodeUnknownSync(RunRecord)(JSON.parse(final)),
  });
  expect(record.fingerprint).not.toBe(f.current);
  const first = readFileSync(file, "utf8");
  const again = await f.invoke([f.note]);
  expect(again.status).toBe(0);
  expect(again.stderr).toBe("");
  expect(again.stdout).not.toBe("");
  expect(readFileSync(file, "utf8")).toBe(first);
  expect(f.git("rev-parse", "HEAD")).toBe(head);
  expect(readFileSync(join(f.registry, "stacks/sample/STACK.md"), "utf8")).toBe(body);
  expect(
    f
      .git("status", "--porcelain")
      .split("\n")
      .filter((line) => !line.endsWith("runs.json")),
  ).toEqual(before.split("\n"));

  const nextNote = join(f.root, "plans/runs/2026-10-28-sample.md");
  writeFileSync(nextNote, readFileSync(f.note, "utf8").replaceAll("2026-10-27", "2026-10-28"));
  const next = await f.invoke([nextNote]);
  expect(next.status).toBe(0);
  expect(next.stderr).toBe("");
  expect(next.stdout).not.toContain("Module not found");
  const appended = Schema.decodeUnknownSync(Ledger)(JSON.parse(readFileSync(file, "utf8")));
  expect(appended.records).toHaveLength(2);
  expect(Schema.decodeUnknownSync(LedgerRecord)(appended.records[0])).toEqual(record);
  expect(Schema.decodeUnknownSync(LedgerRecord)(appended.records[1])).toMatchObject({
    date: "2026-10-28",
    stack: "sample",
    repoCommit: f.commit,
    fingerprint: f.original,
  });
  const twoRecords = readFileSync(file, "utf8");
  const repeated = await f.invoke([f.note, nextNote]);
  expect(repeated.status).toBe(0);
  expect(repeated.stderr).toBe("");
  expect(repeated.stdout).not.toContain("Module not found");
  expect(readFileSync(file, "utf8")).toBe(twoRecords);
  // Four importer processes each read historical registry files through git, beyond a single command.
}, 30_000);

test("a valid relative leading-dash note is imported after the option terminator [2.0c#10]", async () => {
  const f = await repository();
  const name = "-2026-10-29-sample café.md";
  const note = join(f.root, "plans/runs", name);
  writeFileSync(
    note,
    template.replace("{{COMMIT}}", f.commit).replaceAll("2026-10-27", "2026-10-29"),
  );
  const result = await f.invoke(["--", name], dirname(note));
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).not.toContain("Module not found");
  const { Ledger, LedgerRecord } = await import("../src/schemas/ledger");
  const ledger = Schema.decodeUnknownSync(Ledger)(
    JSON.parse(readFileSync(join(f.registry, "runs.json"), "utf8")),
  );
  expect(ledger.records).toHaveLength(1);
  expect(Schema.decodeUnknownSync(LedgerRecord)(ledger.records[0])).toMatchObject({
    date: "2026-10-29",
    stack: "sample",
    repoCommit: f.commit,
    fingerprint: f.original,
  });
}, 30_000);

test("a note missing Repo commit is reported, skipped and exits 1 [2.0c#5]", async () => {
  const f = await repository();
  writeFileSync(f.note, template.replace(/^\| Repo commit .*\n/m, ""));
  const result = await f.invoke([f.note]);
  expect(result.status).toBe(1);
  expect(`${result.stdout}${result.stderr}`).toContain("Repo commit");
  expect(`${result.stdout}${result.stderr}`).toContain("2026-10-27-sample.md");
  expect(result.stderr).not.toContain("Defect");
  expect(existsSync(join(f.registry, "runs.json"))).toBe(false);
}, 30_000);

test.each(["unknown commit", "old invalid registry"])(
  "%s skips only that note and continues with a valid one [2.0c#10]",
  async (kind) => {
    const f = await repository();
    let badCommit = "0".repeat(40);
    if (kind === "old invalid registry") {
      writeEntry({
        root: f.registry,
        kind: "stack",
        dir: "sample",
        frontmatter: minimal("stack", "sample", "unknown_key: true"),
      });
      f.git("add", "packages/cli/registry");
      f.git("commit", "--quiet", "-m", "fixture: invalid old registry");
      badCommit = f.git("rev-parse", "HEAD");
    }
    const badNote = join(f.root, "plans/runs/-invalid café.md");
    writeFileSync(badNote, template.replace("{{COMMIT}}", badCommit));
    const result = await f.invoke([badNote, f.note]);
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("-invalid café.md");
    expect(result.stderr).not.toContain("Defect");
    const { Ledger, LedgerRecord } = await import("../src/schemas/ledger");
    const ledger = Schema.decodeUnknownSync(Ledger)(
      JSON.parse(readFileSync(join(f.registry, "runs.json"), "utf8")),
    );
    expect(ledger.records).toHaveLength(1);
    expect(Schema.decodeUnknownSync(LedgerRecord)(ledger.records[0])).toMatchObject({
      repoCommit: f.commit,
      fingerprint: f.original,
    });
  },
  30_000,
);

test("dry-run prints records and leaves the ledger and working tree unchanged [2.0c#10]", async () => {
  const f = await repository();
  const before = f.git("status", "--porcelain");
  const contents = projectFiles(f.root).map((path) => [path, readFileSync(join(f.root, path))]);
  const head = f.git("rev-parse", "HEAD");
  const result = await f.invoke([f.note, "--dry-run"]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  const { LedgerRecord } = await import("../src/schemas/ledger");
  const records: unknown = JSON.parse(result.stdout);
  expect(records).toHaveLength(1);
  if (!Array.isArray(records)) throw new Error("dry-run must print a JSON array");
  expect(Schema.decodeUnknownSync(LedgerRecord)(records[0])).toMatchObject({
    repoCommit: f.commit,
    fingerprint: f.original,
  });
  expect(existsSync(join(f.registry, "runs.json"))).toBe(false);
  expect(f.git("status", "--porcelain")).toBe(before);
  expect(f.git("rev-parse", "HEAD")).toBe(head);
  expect(projectFiles(f.root).map((path) => [path, readFileSync(join(f.root, path))])).toEqual(
    contents,
  );
}, 30_000);

test.each([
  { outcome: "green", tamperCheck: "manifest-only", expected: "fail" },
  { outcome: "partial", tamperCheck: "full", expected: "partial" },
  { outcome: "failed", tamperCheck: "full", expected: "fail" },
  { outcome: "infra", tamperCheck: "full", expected: "infra" },
])(
  "import maps $outcome/$tamperCheck honestly without optional measurements [2.0c#13]",
  async ({ outcome, tamperCheck, expected }) => {
    const f = await repository();
    const note = template
      .replace("{{COMMIT}}", f.commit)
      .replace(
        '`green`, `tamperCheck: "full"`',
        `\`${outcome}\`, \`tamperCheck: "${tamperCheck}"\``,
      )
      .replace(/^\| Agent minutes .*\n/m, "")
      .replace(/\n## Run record[\s\S]*$/, "\n");
    writeFileSync(f.note, note);
    const result = await f.invoke([f.note]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toBe("");
    const { Ledger, LedgerRecord } = await import("../src/schemas/ledger");
    const ledger = Schema.decodeUnknownSync(Ledger)(
      JSON.parse(readFileSync(join(f.registry, "runs.json"), "utf8")),
    );
    expect(ledger.records).toHaveLength(1);
    expect(Schema.decodeUnknownSync(LedgerRecord)(ledger.records[0])).toMatchObject({
      result: expected,
      run: null,
      agentMinutes: null,
      fingerprint: f.original,
    });
  },
  30_000,
);

test("a runs.json ledger file imports its scaffold records once and rejects unknown commits", async () => {
  const f = await repository();
  const { ledgerRecord } = await import("./helpers/ledger");
  const record = await ledgerRecord(f.registry, {
    repoCommit: f.commit,
    agent: "none",
    agentVersion: "none",
    mode: "scaffold",
    compositionFingerprint: `sha256:${"2".repeat(64)}`,
  });
  const artifact = join(f.root, "artifact", "runs.json");
  mkdirSync(dirname(artifact), { recursive: true });
  writeFileSync(artifact, JSON.stringify({ schemaVersion: 1, records: [record] }));
  const file = join(f.registry, "runs.json");
  const imported = await f.invoke([artifact]);
  expect(imported.stderr).toBe("");
  expect(imported.stdout).toBe("Imported 1 record(s).\n");
  expect(JSON.parse(readFileSync(file, "utf8")).records).toEqual([record]);
  const again = await f.invoke([artifact]);
  expect(again.stdout).toBe("Imported 0 record(s).\n");

  const before = readFileSync(file, "utf8");
  writeFileSync(
    artifact,
    JSON.stringify({ schemaVersion: 1, records: [{ ...record, repoCommit: "f".repeat(40) }] }),
  );
  const unknown = await f.invoke([artifact]);
  expect(unknown.status).toBe(1);
  expect(unknown.stderr).toContain("unknown commit");
  expect(readFileSync(file, "utf8")).toBe(before);
}, 30_000);
