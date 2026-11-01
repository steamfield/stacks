import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { Manifest } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterAll, test as baseTest, describe, expect, vi } from "vitest";
import type { AgentAdapter } from "../scripts/bench/agents";
import { AgentMarkers } from "../src/config";
import { shellArg } from "../src/core/shell";
import { NewResult } from "../src/schemas/new";
import { ProjectRuns } from "../src/schemas/runs";
import { projectFiles } from "./fixtures/composed-files";
import { type BenchFixture, benchCli, benchFixture, NOTES, passed } from "./helpers/bench";
import { alive, runCli } from "./helpers/cli";
import { readManifestAt, readPid, runRecords, workspace } from "./helpers/verify";

/** Every file under a root with its sha256: a kept root holds the compiled binary, too big to diff. */
const digests = (root: string) =>
  projectFiles(root).map((path) => [
    path,
    createHash("sha256")
      .update(readFileSync(join(root, path)))
      .digest("hex"),
  ]);

const artifacts = workspace();
const compiled = benchCli(artifacts);
// Bound child-process load; the build group runs after the shared-artifact cases.
vi.setConfig({ maxConcurrency: 8 });
const benchTest = baseTest.extend("space", async ({ task: _task }, { onCleanup }) => {
  const space = workspace();
  onCleanup(() => space.release());
  return space;
});
const test = benchTest.concurrent;
afterAll(() => {
  artifacts.release();
  vi.resetConfig();
});

function kept(f: BenchFixture, agent = "claude") {
  return dirname(f.observe(agent).cwd);
}
function record(f: BenchFixture) {
  const records = f.ledger();
  expect(records).toHaveLength(1);
  const first = records[0];
  if (!first) throw new Error("bench wrote no record");
  return first;
}
function assertNoWrites(f: BenchFixture, before: ReturnType<BenchFixture["snapshot"]>) {
  expect(f.snapshot()).toEqual(before);
  expect(readdirSync(f.tmp)).toEqual([]);
  expect(f.cliCalls()).toEqual([]);
  expect(existsSync(join(f.observations, "claude.json"))).toBe(false);
  expect(existsSync(join(f.observations, "codex.json"))).toBe(false);
}
async function baseline(f: BenchFixture, preset = "sandbox") {
  const result = await runCli(
    [
      "new",
      "sample",
      "preview",
      "--dry-run",
      "--agents",
      "claude",
      "--no-launch",
      "--json",
      ...(preset === "sandbox" ? ["--sandbox"] : ["--yes"]),
    ],
    // From the throwaway directory, as the bench scaffolds: inside the repo the brief would
    // describe a parent repository and count different words.
    { home: f.home, env: f.env, host: { cwd: f.tmp, registry: f.registry } },
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return Schema.decodeUnknownSync(NewResult)(JSON.parse(result.stdout));
}
async function summary(f: BenchFixture, root: string) {
  const call = f.cliCalls().find((call) => call.args.includes("runs"));
  if (!call) throw new Error("bench did not call runs --json");
  const result = await runCli(["runs", "--json"], {
    home: call.env.HOME,
    env: call.env,
    host: { cwd: join(root, "run"), registry: f.registry },
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return Schema.decodeUnknownSync(ProjectRuns)(JSON.parse(result.stdout));
}
function note(f: BenchFixture) {
  const row = record(f);
  expect(row.note).toBeDefined();
  if (!row.note) throw new Error("record has no note path");
  expect(isAbsolute(row.note)).toBe(false);
  return readFileSync(join(f.root, row.note), "utf8");
}
function commitRun(f: BenchFixture) {
  f.git("add", "packages/cli/registry/runs.json", "plans/runs");
  f.git("commit", "--quiet", "-m", "fixture: save first bench run");
}

// Import inside each test so every acceptance case reports the missing entry point independently.
test("editing the manifest fails the independent tamper check [2.0b#2]", async ({ space }) => {
  const f = benchFixture(space, compiled);
  f.configure("tamper");
  passed(await f.invoke(["--keep"]));
  expect(record(f)).toMatchObject({ result: "fail", run: { outcome: "changed" } });
  expect(record(f).run).toEqual(runRecords(join(kept(f), "run")).at(-1));
}, 60_000);

test("a fractional-minute timeout kills the agent and its descendant, then verifies [2.0b#3]", async ({
  space,
}) => {
  const f = benchFixture(space, compiled);
  f.configure("block");
  await import("../scripts/bench");
  const unrelated = spawn(
    process.execPath,
    ["-e", "process.stdout.write('ready'); setInterval(() => {}, 1000)"],
    { stdio: ["ignore", "pipe", "ignore"], env: f.env },
  );
  const closed = new Promise<void>((resolve, reject) => {
    unrelated.once("close", () => resolve());
    unrelated.once("error", reject);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      unrelated.stdout.once("data", () => resolve());
      unrelated.once("error", reject);
    });
    passed(await f.invoke(["--max-minutes", "0.05", "--keep"]));
    expect(unrelated.pid).toBeDefined();
    if (!unrelated.pid) throw new Error("unrelated process did not start");
    expect(alive(unrelated.pid)).toBe(true);
  } finally {
    unrelated.kill("SIGKILL");
    await closed;
  }
  expect(readFileSync(f.blocked, "utf8")).toBe("ready");
  for (const file of [f.parentPid, f.childPid]) {
    const pid = readPid(file);
    expect(pid).toBeDefined();
    if (!pid) throw new Error("fake did not start its process tree before timeout");
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5_000 });
  }
  expect(record(f)).toMatchObject({
    result: "fail",
    agentEnded: "timeout",
    run: { outcome: "failed" },
  });
  expect(runRecords(join(kept(f), "run"))).toHaveLength(1);
}, 60_000);

test.for([
  { scenario: "infra", result: "infra" },
  { scenario: "write-error", result: "fail" },
] as const)(
  "$scenario is classified by actual project writes [2.0b#4]",
  { timeout: 60_000 },
  async ({ scenario, result }, { space }) => {
    const f = benchFixture(space, compiled);
    f.configure(scenario);
    passed(await f.invoke(["--keep"]));
    expect(record(f)).toMatchObject({ result, agentEnded: "error" });
    expect(runRecords(join(kept(f), "run"))).toHaveLength(1);
  },
);

test("missing notes produce unknown interventions [2.0b#5]", async ({ space }) => {
  const f = benchFixture(space, compiled);
  f.configure("no-notes");
  passed(await f.invoke());
  expect(record(f)).toMatchObject({ result: "pass", interventions: null });
}, 60_000);

test("the agent sees only the selected fake token and a fresh home [2.0b#6]", async ({ space }) => {
  const f = benchFixture(space, compiled);
  const markers = Object.fromEntries(
    AgentMarkers.map((marker) => [marker.name, marker.equals ?? "1"]),
  );
  passed(
    await f.invoke(["--agent", "claude", "--keep"], {
      env: {
        ...markers,
        GH_TOKEN: "fake-github-secret",
        ANTHROPIC_API_KEY: "fake-api-key",
        OPENAI_API_KEY: "fake-other-api-key",
        CODEX_API_KEY: "fake-codex-api-key",
        UNRELATED_WRAPPER_VALUE: "not-for-children",
      },
    }),
  );
  const env = f.observe().env;
  expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(f.env.CLAUDE_CODE_OAUTH_TOKEN);
  for (const name of [
    ...AgentMarkers.map((marker) => marker.name),
    "GH_TOKEN",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "CODEX_ACCESS_TOKEN",
    "UNRELATED_WRAPPER_VALUE",
  ])
    expect(env[name], name).toBeUndefined();
  expect(env.PORT_BENCH).toMatch(/^\d+$/);
  expect(Number(env.PORT_BENCH)).toBeGreaterThan(0);
  expect(Number(env.PORT_BENCH)).toBeLessThan(65536);
  // A bare PORT (go-api, spring-boot-api) is a port too, so a busy 8080 can't fail the serve step.
  expect(env.PORT).toMatch(/^\d+$/);
  expect(env.PORT).not.toBe("8080");
  expect(env.PORT).not.toBe(env.PORT_BENCH);
  for (const call of f
    .cliCalls()
    .filter((call) => ["new", "verify"].some((command) => call.args.includes(command))))
    expect(call.env.PORT_BENCH).toBe(env.PORT_BENCH);
  const root = realpathSync(kept(f));
  expect(realpathSync(env.HOME ?? "")).toBe(join(root, "home"));
  for (const key of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) {
    const value = env[key];
    expect(value, key).toBeDefined();
    if (!value) throw new Error(`missing ${key}`);
    expect(isAbsolute(value)).toBe(true);
    expect(relative(env.HOME ?? "", value)).not.toMatch(/^\.\./);
  }
  expect(projectFiles(join(root, "home"))).not.toContain(".codex/auth.json");
}, 60_000);

test.for(["token", "dirty"])(
  "preflight refuses %s without writing anything [2.0b#7]",
  { timeout: 60_000 },
  async (kind, { space }) => {
    const f = benchFixture(space, compiled);
    if (kind === "dirty") writeFileSync(join(f.packageRoot, "uncommitted.txt"), "dirty\n");
    const before = f.snapshot();
    const result = await f.invoke(["--agent", "claude"], {
      env: kind === "token" ? { CLAUDE_CODE_OAUTH_TOKEN: undefined } : {},
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(
      kind === "token" ? /CLAUDE_CODE_OAUTH_TOKEN/ : /uncommitted|dirty/i,
    );
    assertNoWrites(f, before);
  },
);

test("an earlier run's uncommitted ledger doesn't block the next run", async ({ space }) => {
  const f = benchFixture(space, compiled);
  passed(await f.invoke([]));
  passed(await f.invoke([]));
  expect(f.ledger()).toHaveLength(2);
}, 120_000);

test("a read-only module cache in the fresh HOME is still removed after the run", async ({
  space,
}) => {
  const f = benchFixture(space, compiled);
  f.configure("read-only-cache");
  passed(await f.invoke([]));
  const home = f.observe().env.HOME;
  if (!home) throw new Error("Missing agent HOME");
  expect(existsSync(dirname(home))).toBe(false);
  expect(f.ledger()).toHaveLength(1);
}, 60_000);

test("no-record still runs the full bench and writes neither ledger nor note [2.0b#8]", async ({
  space,
}) => {
  const f = benchFixture(space, compiled);
  passed(await f.invoke(["--no-record", "--keep"]));
  expect(existsSync(join(f.registry, "runs.json"))).toBe(false);
  expect(f.notes()).toEqual([]);
  expect(runRecords(join(kept(f), "run"))).toHaveLength(2);
  expect(f.cliCalls().some((call) => call.args.includes("runs"))).toBe(true);
}, 60_000);

test("telemetry opt-out reaches the agent and every real CLI invocation [2.0b#11]", async ({
  space,
}) => {
  const f = benchFixture(space, compiled);
  passed(await f.invoke(["--keep"], { env: { DO_NOT_TRACK: "0" } }));
  expect(f.observe().env.DO_NOT_TRACK).toBe("1");
  const calls = f.cliCalls();
  for (const command of ["new", "verify", "runs"])
    expect(
      calls.some((call) => call.args.includes(command)),
      command,
    ).toBe(true);
  for (const call of calls) expect(call.env.DO_NOT_TRACK, call.args.join(" ")).toBe("1");
}, 60_000);

test("continuing a kept run reuses its home and artifact and counts an intervention [2.0b#12]", async ({
  space,
}) => {
  const f = benchFixture(space, compiled);
  passed(await f.invoke(["--keep"]));
  const first = record(f);
  const root = kept(f);
  const original = readManifestAt(join(root, "run"));
  const oldEnv = f.observe().env;
  const callCount = f.cliCalls().length;
  commitRun(f);
  passed(await f.invoke(["--existing", root, "--keep"]));
  const rows = f.ledger();
  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual(first);
  expect(rows[1]).toMatchObject({ continued: true, interventions: 2, result: "pass" });
  expect(readManifestAt(join(root, "run"))).toEqual(original);
  expect(realpathSync(f.observe().env.HOME ?? "")).toBe(realpathSync(oldEnv.HOME ?? ""));
  expect(f.observe().env.PORT_BENCH).toBe(oldEnv.PORT_BENCH);
  expect(
    f
      .cliCalls()
      .slice(callCount)
      .some((call) => call.args.includes("new")),
  ).toBe(false);
  expect(
    f
      .cliCalls()
      .slice(callCount)
      .every(
        (call) => realpathSync(call.executable) === realpathSync(f.cliCalls()[0]?.executable ?? ""),
      ),
  ).toBe(true);
  expect(rows[1]?.minutesToGreen).toBe((await summary(f, root)).minutesToGreen);
  expect(f.notes()).toHaveLength(2);
  const second = rows[1];
  if (!first.note || !second?.note) throw new Error("continuation notes missing");
  const markdown = readFileSync(join(f.root, second.note), "utf8");
  expect(markdown).toMatch(/continu/i);
  expect(markdown).toContain(first.note.split("/").at(-1));
}, 60_000);

test.for(["stack", "fingerprint"])(
  "a kept root with stale %s is refused unchanged [2.0b#12]",
  { timeout: 60_000 },
  async (field, { space }) => {
    const f = benchFixture(space, compiled);
    passed(await f.invoke(["--no-record", "--keep"]));
    const root = kept(f);
    const file = join(root, "run/.stacks/manifest.json");
    const manifest = readManifestAt(join(root, "run"));
    const changed: Manifest =
      field === "stack"
        ? { ...manifest, stack: { id: "another-stack", origin: "bundled", trusted: true } }
        : { ...manifest, fingerprint: `sha256:${"0".repeat(64)}` };
    writeFileSync(file, JSON.stringify(Schema.encodeSync(Manifest)(changed)));
    const before = digests(root);
    const result = await f.invoke(["--existing", root]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(
      field === "stack" ? /stack|match/i : /fingerprint|composition|content/i,
    );
    expect(digests(root)).toEqual(before);
    expect(f.notes()).toEqual([]);
    expect(existsSync(join(f.registry, "runs.json"))).toBe(false);
  },
);

test("a continuation refuses a previous note symlink without changing its target", async ({
  space,
}) => {
  const f = benchFixture(space, compiled);
  passed(await f.invoke(["--keep"]));
  const first = record(f);
  if (!first.note) throw new Error("missing first note");
  const root = kept(f);
  const sentinel = join(f.root, "outside.md");
  writeFileSync(sentinel, "keep this sentinel\n");
  rmSync(join(f.root, first.note));
  symlinkSync(sentinel, join(f.root, first.note));
  commitRun(f);
  f.git("add", "outside.md");
  f.git("commit", "--quiet", "-m", "fixture: preserve outside sentinel");
  const before = f.snapshot();
  const result = await f.invoke(["--existing", root, "--keep"]);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toMatch(/note|plans\/runs/i);
  expect(readFileSync(sentinel, "utf8")).toBe("keep this sentinel\n");
  expect(f.snapshot()).toEqual(before);
}, 60_000);

test.for(["../outside.md", "/tmp/outside.md", "plans/runs/nested/note.md"])(
  "a continuation refuses an unsafe state note: %s",
  { timeout: 60_000 },
  async (note, { space }) => {
    const f = benchFixture(space, compiled);
    passed(await f.invoke(["--no-record", "--keep"]));
    const root = kept(f);
    const file = join(root, "bench/state.json");
    const state = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...state, note }));
    const before = digests(root);
    const repoBefore = f.snapshot();
    const result = await f.invoke(["--existing", root, "--keep"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/Invalid existing bench manifest or kept state/);
    expect(digests(root)).toEqual(before);
    expect(f.snapshot()).toEqual(repoBefore);
  },
);

test("only executed shipped hooks are recorded, without duplicates [2.0b#13]", async ({
  space,
}) => {
  const f = benchFixture(space, compiled);
  passed(await f.invoke());
  expect(record(f)).toMatchObject({ hooksFired: expect.any(Array) });
  const row = record(f);
  const hooks = Schema.decodeUnknownSync(Schema.Array(Schema.String))(
    "hooksFired" in row ? row.hooksFired : undefined,
  );
  expect(hooks.toSorted()).toEqual(["block-destructive.sh", "session-start.sh"]);
}, 60_000);

test("an adapter that cannot read hooks records unknown rather than an empty list [2.0b#13]", async ({
  space,
}) => {
  const f = benchFixture(space, compiled);
  const { agents } = await import("../scripts/bench/agents");
  const adapters = agents.map((adapter: AgentAdapter) => ({ ...adapter, readHooks: undefined }));
  passed(await f.invoke(["--agent", "codex"], { adapters }));
  const row = record(f);
  expect("hooksFired" in row ? row.hooksFired : undefined).toBeNull();
}, 60_000);

test.for([
  // With no --agent the bench always runs Codex, whichever agent's shell started it.
  { env: { CODEX_THREAD_ID: "fixture-thread" }, flag: [], agent: "codex" },
  { env: { CLAUDECODE: "1" }, flag: [], agent: "codex" },
  { env: { AI_AGENT: "other-tool" }, flag: [], agent: "codex" },
  { env: {}, flag: [], agent: "codex" },
  { env: { CODEX_THREAD_ID: "fixture-thread" }, flag: ["--agent", "claude"], agent: "claude" },
  { env: { CLAUDECODE: "1" }, flag: ["--agent", "codex"], agent: "codex" },
])(
  "auto-pick $agent with $env and $flag [2.0b#14]",
  { timeout: 60_000 },
  async ({ env, flag, agent }, { space }) => {
    const f = benchFixture(space, compiled);
    passed(await f.invoke(flag, { env, benchDefaultAgent: flag.length === 0 }));
    expect(record(f)).toMatchObject({ agent, agentVersion: "1.2.3" });
    const observed = f.observe(agent);
    expect(observed.args[0]).toBe(agent === "codex" ? "exec" : "-p");
    expect(observed.env[agent === "codex" ? "CODEX_ACCESS_TOKEN" : "CLAUDE_CODE_OAUTH_TOKEN"]).toBe(
      f.env[agent === "codex" ? "CODEX_ACCESS_TOKEN" : "CLAUDE_CODE_OAUTH_TOKEN"],
    );
    expect(
      observed.env[agent === "codex" ? "CLAUDE_CODE_OAUTH_TOKEN" : "CODEX_ACCESS_TOKEN"],
    ).toBeUndefined();
    expect(note(f)).toMatch(flag.length ? /explicit|--agent/i : /detect|marker|default|fallback/i);
  },
);

test.for(["default", "sandbox"])(
  "preset %s selects the matching new flags and ledger key [2.0b#16]",
  { timeout: 60_000 },
  async (preset, { space }) => {
    const f = benchFixture(space, compiled);
    passed(await f.invoke(preset === "default" ? ["--preset", "default"] : []));
    expect(record(f).preset).toBe(preset);
    const call = f
      .cliCalls()
      .find((call) => call.args.includes("new") && !call.args.includes("--dry-run"));
    expect(call).toBeDefined();
    expect(call?.args).toContain(preset === "default" ? "--yes" : "--sandbox");
    expect(call?.args).not.toContain(preset === "default" ? "--sandbox" : "--yes");
    expect(call?.args).toEqual(
      expect.arrayContaining(["--no-launch", "--json", "--agents", "claude"]),
    );
  },
);

test("a symlinked kept root with quotes, spaces and Unicode works from another cwd [2.0b#17]", async ({
  space,
}) => {
  const f = benchFixture(space, compiled);
  passed(await f.invoke(["--no-record", "--keep"]));
  const root = kept(f);
  const link = join(f.base, "-kept 'café' root");
  symlinkSync(root, link, "dir");
  const caller = join(f.root, "plans");
  passed(await f.invoke(["--existing", relative(caller, link), "--keep"], { cwd: caller }));
  expect(realpathSync(kept(f))).toBe(realpathSync(root));
  expect(record(f)).toMatchObject({ result: "pass", continued: true, interventions: 2 });
}, 60_000);

test("git wrapper variables and relative XDG values cannot redirect the bench [2.0b#18]", async ({
  space,
}) => {
  const f = benchFixture(space, compiled);
  passed(
    await f.invoke(["--keep"], {
      cwd: join(f.root, "plans"),
      env: {
        GIT_DIR: join(f.base, "missing.git"),
        GIT_WORK_TREE: f.base,
        GIT_INDEX_FILE: join(f.base, "unrelated-index"),
        XDG_CONFIG_HOME: "relative-config",
        XDG_DATA_HOME: undefined,
        XDG_STATE_HOME: "relative-state",
      },
    }),
  );
  expect(record(f)).toMatchObject({ repoCommit: f.commit, result: "pass" });
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"])
    expect(f.observe().env[key]).toBeUndefined();
  expect(existsSync(join(f.base, "unrelated-index"))).toBe(false);
  expect(f.git("rev-parse", "HEAD")).toBe(f.commit);
}, 60_000);

test.for(["missing", "invalid", "file"])(
  "a partial kept root with %s manifest is left intact [2.0b#19]",
  { timeout: 60_000 },
  async (kind, { space }) => {
    const f = benchFixture(space, compiled);
    const root = join(f.base, "partial-root");
    const run = join(root, "run");
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "keep.txt"), "previous work\n");
    if (kind === "file") writeFileSync(join(run, ".stacks"), "not a directory\n");
    else {
      mkdirSync(join(run, ".stacks"));
      if (kind === "invalid") writeFileSync(join(run, ".stacks/manifest.json"), "{unfinished");
    }
    const before = digests(root);
    const result = await f.invoke(["--existing", root]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/manifest|kept|existing/i);
    expect(digests(root)).toEqual(before);
    expect(f.notes()).toEqual([]);
    expect(existsSync(join(f.registry, "runs.json"))).toBe(false);
    expect(f.cliCalls()).toEqual([]);
  },
);

test("aborting a blocked agent cleans its process tree and root and preserves unrelated files [2.0b#21]", async ({
  space,
}) => {
  const f = benchFixture(space, compiled);
  f.configure("block");
  const sentinel = join(f.tmp, "unrelated.txt");
  writeFileSync(sentinel, "keep me\n");
  await import("../scripts/bench");
  const controller = new AbortController();
  const pending = f.invoke([], { signal: controller.signal });
  try {
    await vi.waitFor(() => expect(existsSync(f.blocked)).toBe(true), { timeout: 30_000 });
  } finally {
    controller.abort();
    await pending;
  }
  const result = await pending;
  expect(result.status).toBe(130);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
  for (const file of [f.parentPid, f.childPid]) {
    const pid = readPid(file);
    expect(pid).toBeDefined();
    if (!pid) throw new Error("blocked fake did not start");
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5_000 });
  }
  expect(existsSync(kept(f))).toBe(false);
  expect(readdirSync(f.tmp)).toEqual(["unrelated.txt"]);
  expect(readFileSync(sentinel, "utf8")).toBe("keep me\n");
  expect(f.notes()).toEqual([]);
  expect(existsSync(join(f.registry, "runs.json"))).toBe(false);
}, 60_000);

test("an undecodable ledger is preserved while the run note and recoverable record survive [2.0b#22]", async ({
  space,
}) => {
  const f = benchFixture(space, compiled);
  const file = join(f.registry, "runs.json");
  writeFileSync(file, "{broken ledger\n");
  f.git("add", "packages/cli/registry/runs.json");
  f.git("commit", "--quiet", "-m", "fixture: broken ledger");
  const result = await f.invoke(["--keep"]);
  expect(result.status).toBe(3);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toBe("");
  expect(readFileSync(file, "utf8")).toBe("{broken ledger\n");
  expect(f.notes()).toHaveLength(1);
  const recoverable = result.stderr.split("\n").filter((line) => line.startsWith("{"));
  expect(recoverable).toHaveLength(1);
  const { LedgerRecord } = await import("../src/schemas/ledger");
  const row = Schema.decodeUnknownSync(LedgerRecord, { onExcessProperty: "error" })(
    JSON.parse(recoverable[0] ?? ""),
  );
  expect(row).toMatchObject({
    result: "pass",
    repoCommit: f.git("rev-parse", "HEAD"),
    interventions: 1,
  });
  const markdown = readFileSync(join(f.root, "plans/runs", f.notes()[0] ?? ""), "utf8");
  expect(markdown).toContain(NOTES);
  expect(markdown).toContain(JSON.stringify(runRecords(join(kept(f), "run")).at(-1)));
}, 60_000);

test("writing only ignored NOTES before an error is fail rather than infra [2.0b#23]", async ({
  space,
}) => {
  const f = benchFixture(space, compiled);
  f.configure("notes-error");
  passed(await f.invoke());
  expect(record(f)).toMatchObject({ result: "fail", agentEnded: "error", interventions: 1 });
}, 60_000);

test("continuation refuses different added fragments without changing a kept root [2.0b#24]", async ({
  space,
}) => {
  const f = benchFixture(space, compiled);
  passed(await f.invoke(["--no-record", "--keep", "--with", "extra"]));
  const root = kept(f);
  const before = digests(root);
  const result = await f.invoke(["--existing", root]);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toMatch(/fragment|composition|match|with/i);
  expect(digests(root)).toEqual(before);
  expect(f.notes()).toEqual([]);
  expect(existsSync(join(f.registry, "runs.json"))).toBe(false);
}, 60_000);

test.for(["missing-binary", "version-error"])(
  "preflight reports %s and writes nothing [2.0b#25]",
  { timeout: 60_000 },
  async (kind, { space }) => {
    const f = benchFixture(space, compiled);
    if (kind === "missing-binary") {
      rmSync(join(f.bin, "claude"));
      // Restrict PATH so a real installed agent can never be used as fallback.
      const { execFileSync } = await import("node:child_process");
      for (const name of ["git", "bun"])
        symlinkSync(
          execFileSync("/bin/sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).trim(),
          join(f.bin, name),
        );
    } else f.configure("version-error");
    const before = f.snapshot();
    const result = await f.invoke(["--agent", "claude"], {
      env: kind === "missing-binary" ? { PATH: f.bin } : {},
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(
      kind === "missing-binary" ? /claude/ : /fixture agent version unavailable/,
    );
    assertNoWrites(f, before);
  },
);

test.for(["malformed", "nonzero"] as const)(
  "%s agent output cannot certify a passing run [2.0b#26]",
  { timeout: 60_000 },
  async (scenario, { space }) => {
    const f = benchFixture(space, compiled);
    f.configure(scenario);
    passed(await f.invoke());
    expect(record(f)).toMatchObject({
      result: scenario === "malformed" ? "infra" : "fail",
      agentEnded: "error",
    });
  },
);

test("default cleanup removes the root after writing a complete note [2.0b#27]", async ({
  space,
}) => {
  const f = benchFixture(space, compiled);
  passed(await f.invoke());
  expect(existsSync(kept(f))).toBe(false);
  expect(readdirSync(f.tmp)).toEqual([]);
  expect(note(f)).toContain(NOTES);
  expect(f.ledger()).toHaveLength(1);
}, 60_000);

test("a second same-day run appends a distinct note without overwriting the first [2.0b#28]", async ({
  space,
}) => {
  const f = benchFixture(space, compiled);
  const date = "2026-10-27";
  passed(await f.invoke([], { date }));
  const first = record(f);
  expect(first.date).toBe(date);
  if (!first.note) throw new Error("missing first note");
  const contents = readFileSync(join(f.root, first.note), "utf8");
  commitRun(f);
  passed(await f.invoke([], { date }));
  const rows = f.ledger();
  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual(first);
  expect(rows[1]?.date).toBe(first.date);
  expect(rows[1]?.note).not.toBe(first.note);
  expect(f.notes()).toHaveLength(2);
  expect(readFileSync(join(f.root, first.note), "utf8")).toBe(contents);
}, 60_000);

test("--cli installs a supplied Node entry and bundle without rebuilding it [2.0b#10]", async ({
  space,
}) => {
  const f = benchFixture(space, compiled);
  const binary = join(f.base, "supplied CLI café.mjs");
  cpSync(compiled(), binary);
  cpSync(join(dirname(compiled()), "cli.mjs"), join(f.base, "cli.mjs"));
  // Any unexpected rebuild fails loudly instead of silently exercising the default path.
  writeFileSync(join(f.bin, "bun"), "#!/bin/sh\necho unexpected-rebuild >&2\nexit 77\n", {
    mode: 0o755,
  });
  passed(await f.invoke(["--cli", binary, "--keep"]));
  expect(record(f)).toMatchObject({ result: "pass" });
  const installed = f.cliCalls()[0]?.executable;
  if (!installed) throw new Error("supplied binary was not invoked");
  const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  expect(hash(installed)).toBe(hash(binary));
  expect(hash(join(dirname(installed), "cli.mjs"))).toBe(hash(join(f.base, "cli.mjs")));
}, 60_000);

test("continuation compares against the current working registry, not the kept artifact [2.0b#12]", async ({
  space,
}) => {
  const f = benchFixture(space, compiled);
  passed(await f.invoke(["--no-record", "--keep"]));
  const root = kept(f);
  const manifest = readManifestAt(join(root, "run"));
  const entry = join(f.registry, "stacks/sample/STACK.md");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\nChanged composition guidance.\n`);
  f.git("add", "packages/cli/registry");
  f.git("commit", "--quiet", "-m", "fixture: changed current composition");
  expect((await baseline(f)).fingerprint).not.toBe(manifest.fingerprint);
  const before = digests(root);
  const result = await f.invoke(["--existing", root]);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toMatch(/fingerprint|composition|content/i);
  expect(digests(root)).toEqual(before);
  expect(f.notes()).toEqual([]);
  expect(existsSync(join(f.registry, "runs.json"))).toBe(false);
}, 60_000);

test("the bench resolves a Node shim before replacing HOME", async ({ space }) => {
  const f = benchFixture(space, compiled);
  writeFileSync(
    join(f.bin, "node"),
    `#!/bin/sh\n[ "$HOME" = ${shellArg(f.env.HOME ?? "")} ] || exit 77\nexec ${shellArg(process.execPath)} "$@"\n`,
    { mode: 0o755 },
  );
  passed(await f.invoke(["--keep"]));
  expect(record(f)).toMatchObject({ result: "pass" });
}, 60_000);

describe("build paths", () => {
  test("a successful agent is independently verified and recorded with real measurements [2.0b#1]", async ({
    space,
  }) => {
    const f = benchFixture(space);
    const expected = await baseline(f);
    passed(await f.invoke(["--agent", "claude", "--keep"]));
    const root = kept(f);
    const row = record(f);
    const history = runRecords(join(root, "run"));
    expect(history).toHaveLength(2);
    expect(row).toMatchObject({
      stack: "sample",
      with: [],
      preset: "sandbox",
      agent: "claude",
      agentVersion: "1.2.3",
      repoCommit: f.commit,
      fingerprint: expected.fingerprint,
      briefWords: expected.briefWords,
      mode: "headless",
      result: "pass",
      agentEnded: "exit",
      interventions: 1,
      verifyRuns: 1,
      run: history.at(-1),
    });
    expect(row.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(row.run).toMatchObject({ outcome: "green", tamperCheck: "full", scope: "full" });
    expect(row.agentMinutes).toEqual(expect.any(Number));
    expect(row.agentMinutes).toBeGreaterThanOrEqual(0);
    const runs = await summary(f, root);
    expect(row.minutesToGreen).toBe(runs.minutesToGreen);
    expect(row.minutesToFirstTest).toBe(runs.minutesToFirstTest);
    expect(row.minutesToGreen).not.toBeNull();
    expect(row.minutesToFirstTest).not.toBeNull();
    expect(row.verifyRuns).toBe(runs.verifyRuns - 1);
    const prompt = f.observe().args.find((arg) => arg.includes("BENCH.md"));
    expect(prompt).toContain(join(root, "bench/BENCH.md"));
    const benchBrief = readFileSync(join(root, "bench/BENCH.md"), "utf8");
    expect(benchBrief).toContain("## Asked");
    expect(benchBrief).toContain(".stacks/NOTES.md");
    expect(benchBrief).toContain(".stacks/manifest.json");
    expect(benchBrief).toContain(join(root, "bench/verify"));
    expect(
      projectFiles(join(root, "run")).some((path) => /BENCH\.md|bench\/verify/.test(path)),
    ).toBe(false);
    const markdown = note(f);
    expect(markdown).toContain(NOTES);
    expect(markdown).toContain(JSON.stringify(history.at(-1)));
    expect(readFileSync(join(root, "bench/verify.log"), "utf8").trim().split("\n")).toHaveLength(1);
    expect(f.cliCalls().filter((call) => call.args.includes("verify"))).toHaveLength(2);
  }, 60_000);

  test("the fresh prefix contains the Node bundle and registry with no source or scripts [2.0b#10]", async ({
    space,
  }) => {
    const f = benchFixture(space);
    passed(await f.invoke(["--keep"]));
    const calls = f.cliCalls();
    expect(calls.length).toBeGreaterThanOrEqual(4);
    const executables = [...new Set(calls.map((call) => realpathSync(call.executable)))];
    expect(executables).toHaveLength(1);
    const installed = executables[0];
    if (!installed) throw new Error("no installed binary was invoked");
    const prefix = dirname(dirname(installed));
    expect(installed).toBe(join(prefix, "dist/stacks"));
    expect(prefix).not.toBe(f.packageRoot);
    const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(hash(installed)).toBe(hash(join(f.packageRoot, "dist/stacks")));
    expect(hash(join(prefix, "dist/cli.mjs"))).toBe(hash(join(f.packageRoot, "dist/cli.mjs")));
    expect(readFileSync(join(prefix, "registry/stacks/sample/STACK.md"), "utf8")).toBe(
      readFileSync(join(f.registry, "stacks/sample/STACK.md"), "utf8"),
    );
    expect(
      projectFiles(prefix).filter((path) =>
        path.split("/").some((part) => ["scripts", "src"].includes(part)),
      ),
    ).toEqual([]);
    expect(existsSync(join(prefix, "registry"))).toBe(true);
  }, 60_000);

  test("aborting a blocked build cleans only the bench's temporary files [2.0b#20]", async ({
    space,
  }) => {
    const f = benchFixture(space);
    const { execFileSync } = await import("node:child_process");
    const realBun = execFileSync("/bin/sh", ["-c", "command -v bun"], { encoding: "utf8" }).trim();
    const shim = join(f.bin, "bun");
    const marker = join(f.observations, "build-blocked");
    const pidFile = space.trackPid(join(f.observations, "build.pid"));
    writeFileSync(
      shim,
      `#!${process.execPath}\nconst {writeFileSync}=require('node:fs');
if(process.argv.includes('build')) {
  writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
  writeFileSync(${JSON.stringify(marker)}, 'ready');
  setInterval(()=>{},1000);
} else {
  const r=require('node:child_process').spawnSync(${JSON.stringify(realBun)},process.argv.slice(2),{stdio:'inherit',env:process.env});
  process.exit(r.status ?? 1);
}\n`,
      { mode: 0o755 },
    );
    const controller = new AbortController();
    // Load before starting the owned promise: a missing module must be the red failure, not a marker timeout.
    await import("../scripts/bench");
    const pending = f.invoke([], { signal: controller.signal });
    try {
      await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 15_000 });
    } finally {
      controller.abort();
      await pending;
    }
    const result = await pending;
    expect(result.status).toBe(130);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    const pid = readPid(pidFile);
    expect(pid).toBeDefined();
    if (!pid) throw new Error("build shim did not start");
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5_000 });
    expect(readdirSync(f.tmp)).toEqual([]);
    expect(f.notes()).toEqual([]);
    expect(existsSync(join(f.registry, "runs.json"))).toBe(false);
  }, 60_000);
});
