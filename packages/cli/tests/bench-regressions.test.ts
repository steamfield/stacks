import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Clock, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { runBench } from "../scripts/bench";
import { agents } from "../scripts/bench/agents";
import { SOURCE_BUILD } from "../src/config";
import { NetLayer } from "../src/platform/net";
import { AppLayer, runInvocation } from "../src/runtime";
import { Host } from "../src/services/host";
import { Output } from "../src/services/output";
import { Foreground } from "../src/services/processes";
import { type BenchFixture, benchCli, benchFixture, passed, sample } from "./helpers/bench";
import { runRecords, workspace } from "./helpers/verify";

const space = workspace();
const artifacts = workspace();
const compiled = benchCli(artifacts);
afterAll(() => artifacts.release());
afterEach(() => space.release());

// The fake records comparisons and metadata only, never credential contents.
function observeLogin(f: BenchFixture) {
  const auth = '{"access_token":"dummy-login-for-tests"}\n';
  const directory = join(f.home, ".codex");
  mkdirSync(directory);
  writeFileSync(join(directory, "auth.json"), auth);
  for (const name of ["config.toml", "AGENTS.md", "mcp.json"])
    writeFileSync(join(directory, name), "must stay in the invoking home\n");
  const binary = join(f.bin, "codex");
  writeFileSync(
    binary,
    readFileSync(binary, "utf8").replace(
      "const cwd = process.cwd();",
      `const cwd = process.cwd();
const authFs = require("node:fs");
const authDir = join(process.env.HOME, ".codex");
const authPath = join(authDir, "auth.json");
const present = authFs.existsSync(authPath);
writeFileSync(${JSON.stringify(join(f.observations, "login.json"))}, JSON.stringify({
  present,
  matches: present && readFileSync(authPath, "utf8") === ${JSON.stringify(auth)},
  mode: present ? authFs.statSync(authPath).mode & 0o777 : null,
  files: authFs.existsSync(authDir) ? authFs.readdirSync(authDir) : [],
}));`,
    ),
  );
  return () =>
    Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({
          present: Schema.Boolean,
          matches: Schema.Boolean,
          mode: Schema.NullOr(Schema.Number),
          files: Schema.Array(Schema.String),
        }),
      ),
    )(readFileSync(join(f.observations, "login.json"), "utf8"));
}

test.each(["token", "codex login"] as const)(
  "Codex uses %s and records the selected model without retaining credentials",
  async (route) => {
    const f = benchFixture(space, compiled);
    const login = observeLogin(f);
    let authAfterExit: boolean | undefined;
    const adapters = agents.map((adapter) => ({
      ...adapter,
      readResult: (tail: string) => {
        authAfterExit = existsSync(join(f.observe("codex").env.HOME ?? "", ".codex/auth.json"));
        return adapter.readResult(tail);
      },
    }));
    passed(
      await f.invoke(["--agent", "codex", "--model", "gpt-6.1-terra", "--keep"], {
        env: route === "token" ? {} : { CODEX_ACCESS_TOKEN: "" },
        adapters,
      }),
    );
    expect(login()).toEqual(
      route === "token"
        ? { present: false, matches: false, mode: null, files: [] }
        : { present: true, matches: true, mode: 0o600, files: ["auth.json"] },
    );
    const observed = f.observe("codex");
    expect(
      observed.args.slice(observed.args.indexOf("--model"), observed.args.indexOf("--model") + 2),
    ).toEqual(["--model", "gpt-6.1-terra"]);
    expect(observed.env.CODEX_ACCESS_TOKEN).toBe(
      route === "token" ? f.env.CODEX_ACCESS_TOKEN : undefined,
    );
    expect(observed.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(authAfterExit).toBe(false);
    expect(existsSync(join(observed.env.HOME ?? "", ".codex/auth.json"))).toBe(false);
    expect(existsSync(join(f.home, ".codex/auth.json"))).toBe(true);
    const note = f.ledger()[0]?.note;
    if (!note) throw new Error("Missing run note");
    const markdown = readFileSync(join(f.root, note), "utf8");
    expect(markdown).toContain(`| Credentials | ${route} |`);
    expect(markdown).toContain("| Model | gpt-6.1-terra |");
  },
  60_000,
);

test("Claude receives the selected model and records token credentials", async () => {
  const f = benchFixture(space, compiled);
  passed(await f.invoke(["--agent", "claude", "--model", "claude_model.1-test"]));
  const args = f.observe().args;
  expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual([
    "--model",
    "claude_model.1-test",
  ]);
  const note = f.ledger()[0]?.note;
  if (!note) throw new Error("Missing run note");
  expect(readFileSync(join(f.root, note), "utf8")).toContain("| Credentials | token |");
}, 60_000);

test("Claude defaults to Haiku and names it in the note", async () => {
  const f = benchFixture(space, compiled);
  passed(await f.invoke(["--agent", "claude"]));
  const args = f.observe().args;
  expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual([
    "--model",
    "haiku",
  ]);
  const note = f.ledger()[0]?.note;
  if (!note) throw new Error("Missing run note");
  expect(readFileSync(join(f.root, note), "utf8")).toContain("| Model | haiku |");
}, 60_000);

test("the default model adds no flag and is named in the note", async () => {
  const f = benchFixture(space, compiled);
  passed(await f.invoke(["--agent", "codex"]));
  expect(f.observe("codex").args).not.toContain("--model");
  const note = f.ledger()[0]?.note;
  if (!note) throw new Error("Missing run note");
  expect(readFileSync(join(f.root, note), "utf8")).toContain("| Model | agent default |");
}, 60_000);

test("missing Codex credentials name both login routes before writing anything", async () => {
  const f = benchFixture(space, compiled);
  const result = await f.invoke(["--agent", "codex"], { env: { CODEX_ACCESS_TOKEN: "" } });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(
    "Set CODEX_ACCESS_TOKEN using codex login --with-access-token, or sign in using codex login\n",
  );
  expect(readdirSync(f.tmp)).toEqual([]);
  expect(f.cliCalls()).toEqual([]);
}, 60_000);

test.each(["infra", "block"] as const)(
  "Codex login credentials are removed after %s before independent verification",
  async (scenario) => {
    const f = benchFixture(space, compiled);
    f.configure(scenario);
    const login = observeLogin(f);
    let removedBeforeVerification = false;
    const adapters = agents.map((adapter) => ({
      ...adapter,
      readResult: (tail: string) => {
        removedBeforeVerification = !existsSync(
          join(f.observe("codex").env.HOME ?? "", ".codex/auth.json"),
        );
        return adapter.readResult(tail);
      },
    }));
    passed(
      await f.invoke(["--agent", "codex", "--keep", "--max-minutes", "0.05"], {
        env: { CODEX_ACCESS_TOKEN: "" },
        adapters,
      }),
    );
    expect(login().matches).toBe(true);
    expect(removedBeforeVerification).toBe(true);
    expect(f.cliCalls().some((call) => call.args.includes("verify"))).toBe(true);
    expect(f.ledger()[0]?.agentEnded).toBe(scenario === "infra" ? "error" : "timeout");
  },
  60_000,
);

test("interrupting Codex removes login credentials even from a kept root", async () => {
  const f = benchFixture(space, compiled);
  f.configure("block");
  const login = observeLogin(f);
  const controller = new AbortController();
  const pending = f.invoke(["--agent", "codex", "--keep"], {
    env: { CODEX_ACCESS_TOKEN: "" },
    signal: controller.signal,
  });
  try {
    await vi.waitFor(() => expect(existsSync(f.blocked)).toBe(true), { timeout: 15_000 });
    expect(login().matches).toBe(true);
  } finally {
    controller.abort();
    await pending;
  }
  expect(await pending).toEqual({ status: 130, stdout: "", stderr: "" });
  expect(existsSync(join(f.observe("codex").env.HOME ?? "", ".codex/auth.json"))).toBe(false);
  expect(f.notes()).toEqual([]);
  expect(f.cliCalls().some((call) => call.args.includes("verify"))).toBe(false);
}, 60_000);

test.each(["claude", "codex"] as const)(
  "%s accepts diagnostics around structured results",
  (id) => {
    const adapter = agents.find((candidate) => candidate.id === id);
    if (!adapter) throw new Error("Missing adapter");
    const success = sample(id === "claude" ? "claude-success.json" : "codex-success.jsonl");
    expect(
      adapter.readResult(`Warning: continuing without an optional feature\n${success}`),
    ).toMatchObject({ ended: "exit" });
    expect(adapter.readResult(`${success}\nWarning: cleanup completed\n`)).toMatchObject({
      ended: "exit",
    });
  },
);

test("a run crossing UTC midnight retains its start date", async () => {
  const f = benchFixture(space, compiled);
  let ended = false;
  const adapters = agents.map((adapter) => ({
    ...adapter,
    readResult: (tail: string) => {
      ended = true;
      return adapter.readResult(tail);
    },
  }));
  const output = Output.memory("agent");
  const platform = Layer.mergeAll(
    NodeServices.layer,
    NetLayer,
    Foreground.layer(Foreground.make()),
    Host.memory({ cwd: f.root, registry: f.registry }),
  );
  const program = Effect.gen(function* () {
    const live = yield* Clock.Clock;
    const before = yield* TestClock.make();
    const after = yield* TestClock.make();
    yield* before.setTime(Date.parse("2026-10-27T23:59:59Z"));
    yield* after.setTime(Date.parse("2026-10-28T00:00:01Z"));
    const current = () => (ended ? after : before);
    const millis = () => current().currentTimeMillisUnsafe();
    return yield* runBench(["sample", "--cli", compiled()], adapters).pipe(
      f.observeChildren,
      Effect.provideService(Clock.Clock, {
        monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
        monotonicTimeNanos: live.monotonicTimeNanos,
        sleep: (duration) => live.sleep(duration),
        currentTimeMillisUnsafe: millis,
        currentTimeMillis: Effect.sync(millis),
        currentTimeNanosUnsafe: () => BigInt(millis()) * 1_000_000n,
        currentTimeNanos: Effect.sync(() => BigInt(millis()) * 1_000_000n),
      }),
    );
  });
  const status = await runInvocation(
    program.pipe(
      Effect.tap(() => Effect.flatMap(Output, (out) => out.flush)),
      Effect.orDie,
      Effect.provide(Layer.provideMerge(AppLayer(output.layer, f.env, SOURCE_BUILD), platform)),
      Effect.scoped,
    ),
  );
  passed({ status, stdout: output.stdout.join(""), stderr: output.stderr.join("") });
  expect(f.ledger()).toMatchObject([
    { date: "2026-10-27", note: "plans/runs/2026-10-27-sample.md" },
  ]);
}, 60_000);

test("time to a green base uses the elapsed completion time once", async () => {
  const f = benchFixture(space, compiled);
  const entry = join(f.registry, "fragments/extra/FRAGMENT.md");
  writeFileSync(
    entry,
    readFileSync(entry, "utf8").replace(
      "category: tooling",
      "category: app\napplies_to: [sample]\nverify:\n  - name: application\n    layer: test\n    run: 'true'",
    ),
  );
  f.git("add", "packages/cli/registry");
  f.git("commit", "--quiet", "-m", "fixture: add application stage");
  passed(await f.invoke(["--with", "extra", "--keep"]));
  const first = runRecords(f.observe().cwd)[0];
  const note = f.ledger()[0]?.note;
  if (!first || !note) throw new Error("Missing run evidence");
  expect(first.stages?.base).toBe("green");
  expect(first.durationMs).toBeGreaterThan(0);
  const markdown = readFileSync(join(f.root, note), "utf8");
  expect(markdown).toContain(
    `| Time to green base | ${(first.secondsSinceCreated / 60).toFixed(1)} min |`,
  );
}, 60_000);

test("requesting a default fragment preserves the default ledger key [2.0b#1]", async () => {
  const f = benchFixture(space, compiled);
  const entry = join(f.registry, "stacks/sample/STACK.md");
  writeFileSync(
    entry,
    readFileSync(entry, "utf8").replace(
      "  optional: [extra]",
      "  default: [extra]\n  optional: [extra]",
    ),
  );
  f.git("add", "packages/cli/registry");
  f.git("commit", "--quiet", "-m", "fixture: select extra by default");
  passed(await f.invoke(["--with", "extra"]));
  expect(f.ledger()).toMatchObject([{ with: [], result: "pass" }]);
}, 60_000);

test("an agent replacing the metadata directory still records a failed run [2.0b#4]", async () => {
  const f = benchFixture(space, compiled);
  f.configure("write-error");
  const binary = join(f.bin, "claude");
  writeFileSync(
    binary,
    readFileSync(binary, "utf8").replace(
      "  const error =",
      '  rmSync(".stacks", { recursive: true, force: true });\n' +
        '  writeFileSync(".stacks", "broken metadata\\n");\n  const error =',
    ),
  );
  passed(await f.invoke());
  expect(f.cliCalls().some((call) => call.args.includes("verify"))).toBe(true);
  expect(f.ledger()).toMatchObject([
    {
      result: "fail",
      agentEnded: "error",
      run: null,
      interventions: null,
    },
  ]);
}, 60_000);
