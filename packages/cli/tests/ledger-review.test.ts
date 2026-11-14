import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { RunRecord } from "@steamfield/stacks-format";
import { Effect, Exit, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { proofFingerprint } from "../src/core/fingerprint";
import { Ledger, LedgerRecord } from "../src/schemas/ledger";
import { ProjectRuns } from "../src/schemas/runs";
import { quiet, runCli } from "./helpers/cli";
import { bundledAt, composeExit } from "./helpers/compose";
import { ledgerRegistry, registryFingerprint, startedAt } from "./helpers/ledger";
import {
  readRecord,
  recordPath,
  stateEnv,
  workspace,
  writeRecordedProject,
} from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());
const template = readFileSync(join(import.meta.dirname, "fixtures/ledger-run-note.md"), "utf8");
const script = join(import.meta.dirname, "../scripts/ledger-import.ts");

async function repository() {
  const home = space.dir();
  const root = space.dir();
  const registry = ledgerRegistry(join(root, "packages/cli/registry"));
  for (const [agent, file] of [
    ["claude", "CLAUDE.md"],
    ["codex", "AGENTS.md"],
  ]) {
    if (!agent || !file) throw new Error("Missing adapter fixture");
    const directory = join(registry, "stacks/sample/adapters", agent);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, file), `Instructions for ${agent}.\n`);
  }
  const env = {
    HOME: home,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LOG_LEVEL: "none",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("add", ".");
  git("commit", "--quiet", "-m", "fixture: adapters");
  const note = join(root, "note.md");
  const text = template.replace("{{COMMIT}}", git("rev-parse", "HEAD"));
  const invoke = () =>
    new Promise<{ status: number; stdout: string; stderr: string }>((resolve) => {
      execFile(
        "bun",
        ["--no-env-file", "--config=/dev/null", script, note],
        { cwd: root, env, timeout: 15_000 },
        (error, stdout, stderr) => {
          let status = 0;
          if (error !== null) status = typeof error.code === "number" ? error.code : -1;
          resolve({ status, stdout, stderr });
        },
      );
    });
  const records = () =>
    Schema.decodeUnknownSync(Ledger)(
      JSON.parse(readFileSync(join(registry, "runs.json"), "utf8")),
    ).records.map((record) => Schema.decodeUnknownSync(LedgerRecord)(record));
  return { registry, note, text, invoke, records };
}

test.each([
  { outcome: "failed", tamperCheck: "full" },
  { outcome: "partial", tamperCheck: "full" },
  { outcome: "green", tamperCheck: "manifest-only" },
])("a contradictory final record ($outcome/$tamperCheck) cannot create proof", async (change) => {
  const f = await repository();
  writeFileSync(
    f.note,
    f.text.replace(/```json\n([^\n]+)\n```/, (_, json: string) => {
      const record = Schema.decodeUnknownSync(RunRecord)(JSON.parse(json));
      return `\`\`\`json\n${JSON.stringify({ ...record, ...change })}\n\`\`\``;
    }),
  );
  const result = await f.invoke();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("Imported 0 record(s).\n");
  expect(result.stderr).toContain("Outcome");
  expect(result.stderr).toContain("note.md");
  expect(existsSync(join(f.registry, "runs.json"))).toBe(false);
});

test("an explicit maintainer partial survives a green independent verify", async () => {
  const f = await repository();
  writeFileSync(
    f.note,
    f.text.replace('`green`, `tamperCheck: "full"`', '`partial`, `tamperCheck: "full"`'),
  );
  const result = await f.invoke();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe("Imported 1 record(s).\n");
  expect(f.records()).toMatchObject([{ result: "partial", run: { outcome: "green" } }]);
});

test.each([false, true])(
  "driving agent is independent of adapter targets (explicit: %s)",
  async (explicit) => {
    const f = await repository();
    let text = f.text.replace(
      "Claude Code 2.1.311",
      explicit ? "Claude Code 2.1.311" : "Codex 2.1.311",
    );
    if (explicit) text += "\n| Target agents | `codex` |\n";
    writeFileSync(f.note, text);
    const defaultFingerprint = await registryFingerprint(f.registry);
    const composed = await composeExit(
      { stack: "sample", agents: ["codex"], preset: "sandbox" },
      { roots: bundledAt(f.registry) },
    );
    if (Exit.isFailure(composed)) throw new Error("Could not compose adapter fixture");
    const codexFingerprint = await Effect.runPromise(
      proofFingerprint(composed.value).pipe(Effect.provide(NodeServices.layer)),
    );
    expect(defaultFingerprint).not.toBe(codexFingerprint);
    const result = await f.invoke();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("Imported 1 record(s).\n");
    expect(f.records()).toMatchObject([
      {
        agent: explicit ? "claude" : "codex",
        fingerprint: explicit ? codexFingerprint : defaultFingerprint,
      },
    ]);
  },
);

function recordedProject() {
  const home = space.dir();
  const root = join(space.dir(), "original");
  const manifest = writeRecordedProject(root, home, [], { createdAt: startedAt });
  const file = recordPath(home, manifest.projectId);
  writeFileSync(
    file,
    JSON.stringify({ ...readRecord(file), firstGreenAt: "2026-10-27T09:10:00.000Z" }),
  );
  return { root, home, file };
}

test("runs refuses a state record written by a newer CLI", async () => {
  const p = recordedProject();
  writeFileSync(p.file, JSON.stringify({ ...readRecord(p.file), schemaVersion: 2 }));
  const result = await runCli(["runs", "--json"], {
    home: p.home,
    env: { ...quiet, ...stateEnv(p.home) },
    host: { cwd: p.root },
  });
  expect(result.status).toBe(3);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim().split("\n")).toHaveLength(1);
  expect(JSON.parse(result.stderr)).toEqual({
    error: {
      tag: "InvalidConfig",
      message: "Configuration is invalid.",
      retryable: false,
      next: "upgrade @steamfield/stacks, then run this command again.",
      details: { path: p.file, schemaVersion: 2 },
    },
  });
});

test("runs keeps state timings after the project is moved", async () => {
  const p = recordedProject();
  const moved = join(space.dir(), "renamed café");
  renameSync(p.root, moved);
  const result = await runCli(["runs", "--json"], {
    home: p.home,
    env: { ...quiet, ...stateEnv(p.home) },
    host: { cwd: moved },
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(Schema.decodeUnknownSync(ProjectRuns)(JSON.parse(result.stdout))).toMatchObject({
    stateRecord: true,
    minutesToGreen: 10,
  });
});
