import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Clock, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";
import type { AgentAdapter } from "../../scripts/bench/agents";
import { AppConfig, type Environment, SOURCE_BUILD } from "../../src/config";
import { NetLayer } from "../../src/platform/net";
import { AppLayer, runInvocation } from "../../src/runtime";
import { Ledger, LedgerRecord } from "../../src/schemas/ledger";
import { Host } from "../../src/services/host";
import { Output } from "../../src/services/output";
import { Foreground } from "../../src/services/processes";
import { minimal, writeEntry } from "./registry";
import type { workspace } from "./verify";

const cli = resolve(import.meta.dirname, "../..");
const fixtures = join(cli, "tests/fixtures/bench");
export const sample = (file: string) => readFileSync(join(fixtures, file), "utf8");
export const NOTES =
  "# Notes\n\n## Findings\n- Built both files.\n\n## Asked\n- Which layout? default: flat.\n";
const ChildObservation = Schema.Struct({
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  env: Schema.Record(Schema.String, Schema.String),
});
const CliObservation = Schema.Struct({
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  executable: Schema.String,
  env: Schema.Record(Schema.String, Schema.String),
});
export type Scenario =
  | "success"
  | "tamper"
  | "block"
  | "infra"
  | "write-error"
  | "notes-error"
  | "no-notes"
  | "version-error"
  | "malformed"
  | "nonzero";

function onDate(date: string | undefined) {
  return <A, E, R>(program: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      if (date === undefined) return yield* program;
      const clock = yield* TestClock.make();
      yield* clock.setTime(Date.parse(`${date}T12:00:00Z`));
      const live = yield* Clock.Clock;
      const started = live.monotonicTimeNanosUnsafe();
      // Anchor the date with TestClock; real child timeouts and cleanup retain live scheduling.
      const millis = () =>
        clock.currentTimeMillisUnsafe() +
        Number(live.monotonicTimeNanosUnsafe() - started) / 1_000_000;
      const nanos = () => BigInt(Math.floor(millis() * 1_000_000));
      return yield* program.pipe(
        Effect.provideService(Clock.Clock, {
          monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
          monotonicTimeNanos: live.monotonicTimeNanos,
          sleep: (duration) => live.sleep(duration),
          currentTimeMillisUnsafe: millis,
          currentTimeMillis: Effect.sync(millis),
          currentTimeNanosUnsafe: nanos,
          currentTimeNanos: Effect.sync(nanos),
        }),
      );
    });
}

/** Lazily compile one observing binary in the test file's artifact workspace. */
export function benchCli(space: ReturnType<typeof workspace>) {
  let binary: string | undefined;
  return () => {
    if (binary) return binary;
    const fixture = benchFixture(space);
    execFileSync("bun", ["run", "build"], {
      cwd: fixture.root,
      env: fixture.env,
      timeout: 60_000,
    });
    binary = join(fixture.packageRoot, "dist/stacks");
    return binary;
  };
}

/** Build cases own their sources; other cases install the file's shared observing binary. */
export function benchFixture(space: ReturnType<typeof workspace>, compiled?: () => string) {
  const base = space.dir();
  const root = join(base, "repo with spaces café");
  const home = join(base, "maintainer-home");
  const tmp = join(base, "throwaway roots");
  const bin = join(base, "tool-bin");
  const observations = join(base, "observations");
  const cliLog = join(observations, "cli.jsonl");
  for (const dir of [root, home, tmp, bin, observations]) mkdirSync(dir, { recursive: true });
  const env: Record<string, string> = {
    HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
    XDG_STATE_HOME: join(home, "state"),
    XDG_CACHE_HOME: join(home, "cache"),
    PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    TMPDIR: tmp,
    LANG: "C.UTF-8",
    NO_COLOR: "1",
    LOG_LEVEL: "none",
    STACKS_BENCH_OBSERVE: cliLog,
    CLAUDE_CODE_OAUTH_TOKEN: "fake-claude-token-for-tests",
    CODEX_ACCESS_TOKEN: "fake-codex-token-for-tests",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();
  const packageRoot = join(root, "packages/cli");
  mkdirSync(join(packageRoot, "scripts"), { recursive: true });
  if (!compiled) cpSync(join(cli, "src"), join(packageRoot, "src"), { recursive: true });
  for (const file of ["package.json", "tsconfig.base.json"])
    cpSync(resolve(cli, "../..", file), join(root, file));
  for (const file of [
    "package.json",
    "tsconfig.json",
    "scripts/build.ts",
    "scripts/node-entry.mjs",
  ])
    cpSync(join(cli, file), join(packageRoot, file));
  cpSync(join(cli, "skills"), join(packageRoot, "skills"), { recursive: true });
  mkdirSync(join(packageRoot, "docs"));
  cpSync(join(cli, "docs/authoring.md"), join(packageRoot, "docs/authoring.md"));
  symlinkSync(join(cli, "node_modules"), join(packageRoot, "node_modules"), "dir");
  symlinkSync(resolve(cli, "../../node_modules"), join(root, "node_modules"), "dir");
  writeFileSync(join(root, ".gitignore"), "node_modules\ndist/\n");
  // The probe is compiled into the real artifact. It doesn't replace commands or their outputs.
  if (!compiled) {
    const sourceBin = join(packageRoot, "src/bin.ts");
    const source = readFileSync(sourceBin, "utf8");
    const firstLine = source.indexOf("\n");
    const shebang = source.startsWith("#!") ? source.slice(0, firstLine + 1) : "";
    const body = source.slice(shebang.length);
    writeFileSync(
      sourceBin,
      `${shebang}import { appendFileSync as observeBenchChild } from "node:fs";\n` +
        `if (process.env.STACKS_BENCH_OBSERVE) observeBenchChild(process.env.STACKS_BENCH_OBSERVE, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), executable: process.argv[1], env: process.env }) + "\\n");\n${body}`,
    );
  }
  const registry = join(packageRoot, "registry");
  const stack = writeEntry({
    root: registry,
    kind: "stack",
    dir: "sample",
    frontmatter: minimal(
      "stack",
      "sample",
      `fragments:\n  optional: [extra]\nenv:\n  PORT_BENCH: "4321"\nverify:\n  - name: files\n    layer: test\n    run: node -e 'const fs = require("node:fs"); for (const f of ["one.txt", "two.txt"]) if (!fs.existsSync(f)) process.exit(1)'`,
    ),
    body: "# Build\n\nWrite one.txt and two.txt, then run verify.\n",
  });
  const settings = join(stack, "files/.claude/settings.json");
  mkdirSync(dirname(settings), { recursive: true });
  writeFileSync(
    settings,
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/session-start.sh' },
            ],
          },
        ],
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              {
                type: "command",
                command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/block-destructive.sh',
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: "Write|Edit",
            hooks: [{ type: "command", command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/format.sh' }],
          },
        ],
      },
    }),
  );
  for (const name of ["session-start.sh", "block-destructive.sh", "format.sh"]) {
    const file = join(stack, "files/.claude/hooks", name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  writeEntry({
    root: registry,
    kind: "fragment",
    dir: "extra",
    frontmatter: minimal("fragment", "extra"),
    body: "# Extra\n",
  });
  mkdirSync(join(root, "plans/runs"), { recursive: true });
  git("init", "--quiet");
  git("add", ".");
  git("commit", "--quiet", "-m", "fixture: bench source and registry");
  const commit = git("rev-parse", "HEAD");
  const parentPid = space.trackPid(join(observations, "parent.pid"));
  const childPid = space.trackPid(join(observations, "child.pid"));
  const blocked = join(observations, "blocked");
  const configure = (scenario: Scenario, notes = NOTES) => {
    for (const agent of ["claude", "codex"]) {
      const file = join(bin, agent);
      cpSync(join(fixtures, "agent.cjs"), file);
      chmodSync(file, 0o755);
      writeFileSync(
        `${file}.json`,
        JSON.stringify({
          agent,
          scenario,
          notes,
          parentPid,
          childPid,
          blocked,
          observation: join(observations, `${agent}.json`),
          success: sample(agent === "claude" ? "claude-success.json" : "codex-success.jsonl"),
          error: sample(agent === "claude" ? "claude-error.json" : "codex-error.jsonl"),
          hooks: sample("claude-hooks.txt"),
        }),
      );
    }
  };
  configure("success");
  const observe = (agent = "claude") =>
    Schema.decodeUnknownSync(ChildObservation)(
      JSON.parse(readFileSync(join(observations, `${agent}.json`), "utf8")),
    );
  const cliCalls = () =>
    existsSync(cliLog)
      ? readFileSync(cliLog, "utf8")
          .trim()
          .split("\n")
          .map((line) => Schema.decodeUnknownSync(CliObservation)(JSON.parse(line)))
      : [];
  const ledger = () => {
    const decoded = Schema.decodeUnknownSync(Ledger)(
      JSON.parse(readFileSync(join(registry, "runs.json"), "utf8")),
    );
    return decoded.records.map((record) =>
      Schema.decodeUnknownSync(LedgerRecord, { onExcessProperty: "error" })(record),
    );
  };
  const snapshot = () =>
    git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
      .split("\0")
      .filter(Boolean)
      .sort()
      .map((file) => [file, readFileSync(join(root, file)).toString("base64")]);
  // Retain only this observation variable beyond the bench's production environment allowlist.
  const observeChildren = <A, E, R>(program: Effect.Effect<A, E, R>) =>
    program.pipe(
      Effect.provideServiceEffect(
        AppConfig,
        Effect.map(AppConfig, (config) => ({
          ...config,
          childEnv: (remove, set) =>
            config.childEnv(remove, {
              ...set,
              STACKS_BENCH_OBSERVE: cliLog,
            }),
        })),
      ),
    );
  const invoke = async (
    args: readonly string[] = [],
    options: {
      env?: Environment;
      cwd?: string;
      signal?: AbortSignal;
      adapters?: readonly AgentAdapter[];
      date?: string;
    } = {},
  ) => {
    const { runBench } = await import("../../scripts/bench");
    const output = Output.memory("agent");
    const platform = Layer.mergeAll(
      NodeServices.layer,
      NetLayer,
      Foreground.layer(Foreground.make()),
      Host.memory({ cwd: options.cwd ?? root, registry }),
    );
    const status = await runInvocation(
      runBench(
        ["sample", ...(compiled && !args.includes("--cli") ? ["--cli", compiled()] : []), ...args],
        options.adapters,
      ).pipe(
        observeChildren,
        onDate(options.date),
        Effect.tap(() => Effect.flatMap(Output, (out) => out.flush)),
        Effect.provide(
          Layer.provideMerge(
            AppLayer(output.layer, { ...env, ...options.env }, SOURCE_BUILD),
            platform,
          ),
        ),
        Effect.scoped,
        // The bench maps its own failures to a status; the memory Output's flush and the
        // layers' typed failures can't happen here, so any that did is a defect.
        Effect.orDie,
      ),
      options.signal,
    );
    return { status, stdout: output.stdout.join(""), stderr: output.stderr.join("") };
  };
  const notes = () => readdirSync(join(root, "plans/runs")).sort();
  return {
    base,
    root,
    home,
    tmp,
    bin,
    registry,
    packageRoot,
    env,
    git,
    commit,
    configure,
    observe,
    cliCalls,
    ledger,
    snapshot,
    invoke,
    notes,
    parentPid,
    childPid,
    blocked,
    observations,
    observeChildren,
  };
}
export type BenchFixture = ReturnType<typeof benchFixture>;

export function passed(result: { status: number; stdout: string; stderr: string }) {
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.trim()).not.toBe("");
}
