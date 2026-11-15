#!/usr/bin/env bun
// `bun run prove <stack>... [--preset sandbox|default] [--agents <a,b>] [--cli <entry>] [--ledger <dir>]
// [--no-record] [--keep]`:
// a zero-edit proof with no agent and no inference. For each stack: scaffold with the working
// registry in a throwaway root and a fresh HOME, run the brief's install command (step 1 of
// "Start here", when it has one), then `verify` (code checks; hygiene checks need an agent to fill
// the markers). The result is appended to registry/runs.json as a `scaffold` record, which the
// index accepts as proof. Stacks run one at a time; a failed proof is recorded as `fail`.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { NodeServices } from "@effect/platform-node";
import { RunRecord } from "@steamfield/stacks-format";
import { Effect, Schema } from "effect";
import { compose } from "../src/core/compose/compose";
import type { Composition } from "../src/core/compose/types";
import { proofFingerprint } from "../src/core/fingerprint";
import { appendRecord } from "../src/core/ledger";
import { Registry } from "../src/core/registry/registry";
import { LedgerRecord } from "../src/schemas/ledger";
import { NewResult } from "../src/schemas/new";

const usage =
  "Usage: bun run prove <stack>... [--preset sandbox|default] [--agents claude] [--cli <entry>] [--ledger <dir>] [--no-record] [--keep]";
const packageRoot = join(import.meta.dirname, "..");
const registry = join(packageRoot, "registry");

const { values, positionals } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  allowPositionals: true,
  options: {
    preset: { type: "string", default: "sandbox" },
    agents: { type: "string", default: "claude" },
    cli: { type: "string" },
    "no-record": { type: "boolean", default: false },
    ledger: { type: "string" },
    keep: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
if (values.help || positionals.length === 0 || !["sandbox", "default"].includes(values.preset)) {
  console.error(usage);
  process.exit(values.help ? 0 : 2);
}
const preset = values.preset as "sandbox" | "default";
const agents = values.agents.split(",").filter(Boolean) as Array<"claude" | "codex">;

function run(argv: string[], cwd: string, env: Record<string, string>, timeoutMs = 20 * 60_000) {
  const result = Bun.spawnSync(argv, {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

const freePort = () =>
  new Promise<string>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(String(address.port))
          : reject(new Error("no port")),
      );
    });
  });

/** Step 1 of the brief's "Start here" list: its indented sh fence, if the stack has one. */
function installScript(brief: string): string | null {
  const match = /^ {3}```sh\n([\s\S]*?)\n {3}```$/m.exec(brief);
  return match?.[1] ? match[1].replace(/^ {3}/gm, "") : null;
}

const git = (...args: string[]) =>
  run(["git", ...args], packageRoot, process.env as Record<string, string>).stdout.trim();

const cli =
  (values.cli && resolve(values.cli)) ??
  (() => {
    const built = run(["bun", "run", "build"], packageRoot, process.env as Record<string, string>);
    if (built.code !== 0) throw new Error(`bun run build failed:\n${built.stderr}`);
    return join(packageRoot, "dist/stacks");
  })();
const version = (
  JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version: string }
).version;
const repoCommit = git("rev-parse", "HEAD");
if (values.ledger) mkdirSync(resolve(values.ledger), { recursive: true });
if (git("status", "--porcelain", "--", "registry").length > 0 && !values["no-record"]) {
  console.error("prove: registry has uncommitted changes and a record names HEAD; commit first.");
  process.exit(2);
}

// `--ledger <dir>` writes <dir>/runs.json instead, for CI artifacts that `ledger:import` reads.
const ledgerDir = values.ledger ? resolve(values.ledger) : registry;
const layer = Registry.layer([{ origin: "bundled", path: registry }]);
const runEffect = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

/** A throwaway root with a fresh HOME and free ports for the composition's PORT variables. */
async function workspace(stack: string, composition: Composition) {
  const root = mkdtempSync(join(tmpdir(), `stacks-prove-${stack}-`));
  const home = join(root, "home");
  for (const dir of ["config", "data", "state", "cache"])
    mkdirSync(join(home, dir), { recursive: true });
  mkdirSync(join(root, "tmp"));
  const ports: Record<string, string> = {};
  for (const key of Object.keys(composition.env))
    if (key === "PORT" || key.startsWith("PORT_")) ports[key] = await freePort();
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    ...(process.env.LANG ? { LANG: process.env.LANG } : {}),
    HOME: home,
    TMPDIR: join(root, "tmp"),
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
    XDG_STATE_HOME: join(home, "state"),
    XDG_CACHE_HOME: join(home, "cache"),
    DO_NOT_TRACK: "1",
    ...ports,
  };
  return { root, env, project: join(root, "run") };
}

/** Scaffold, the brief's install, then verify; the scaffold result and the verify run record. */
function scaffoldAndVerify(stack: string, space: Awaited<ReturnType<typeof workspace>>) {
  const { root, env, project } = space;
  const say = (line: string) => console.log(`[${stack}] ${line}`);
  const mode = preset === "sandbox" ? "--sandbox" : "--yes";
  const created = run(
    ["node", cli, "new", stack, "run", mode, "--agents", agents.join(","), "--no-launch", "--json"],
    root,
    env,
    5 * 60_000,
  );
  if (created.code !== 0)
    throw new Error(`new failed (${created.code}): ${created.stderr || created.stdout}`);
  const scaffold = Schema.decodeUnknownSync(Schema.fromJsonString(NewResult))(created.stdout);
  const install = installScript(readFileSync(join(project, ".stacks/BRIEF.md"), "utf8"));
  if (install !== null) {
    writeFileSync(join(root, "install.sh"), `${install}\n`);
    say(`install: ${install.split("\n").join(" && ")}`);
    const installed = run(["sh", "-e", join(root, "install.sh")], project, env);
    if (installed.code !== 0)
      say(`install failed (${installed.code}): ${installed.stderr.slice(-4000)}`);
  }
  const checked = run(["node", cli, "verify", "--json"], project, env, 30 * 60_000);
  writeFileSync(join(root, "verify.json"), checked.stdout);
  const last = readFileSync(join(project, ".stacks/state/runs.jsonl"), "utf8")
    .trim()
    .split("\n")
    .at(-1);
  const runRecord = last ? Schema.decodeUnknownSync(Schema.fromJsonString(RunRecord))(last) : null;
  return { scaffold, runRecord };
}

async function prove(stack: string): Promise<number> {
  const say = (line: string) => console.log(`[${stack}] ${line}`);
  const composition = await runEffect(
    compose({ stack, with: [], without: [], preset, agents, always: [], mode: "new" }).pipe(
      Effect.provide(layer),
      Effect.provide(NodeServices.layer),
    ),
  );
  const space = await workspace(stack, composition);
  const started = Date.now();
  let keep = values.keep;
  try {
    const { scaffold, runRecord } = scaffoldAndVerify(stack, space);
    const pass = runRecord?.outcome === "green" && runRecord.tamperCheck === "full";
    const record = Schema.decodeUnknownSync(LedgerRecord)({
      schemaVersion: 1,
      date: new Date().toISOString().slice(0, 10),
      stack,
      with: [],
      preset,
      agent: "none",
      agentVersion: "none",
      mode: "scaffold",
      repoCommit,
      cli: version,
      fingerprint: await runEffect(
        proofFingerprint(composition).pipe(Effect.provide(NodeServices.layer)),
      ),
      compositionFingerprint: scaffold.fingerprint,
      briefWords: scaffold.briefWords,
      result: pass ? "pass" : "fail",
      agentEnded: "exit",
      run: runRecord,
      verifyRuns: 1,
      minutesToGreen: null,
      minutesToFirstTest: null,
      agentMinutes: null,
      interventions: 0,
    });
    if (!pass) {
      keep = true;
      const failed = runRecord?.steps.filter((step) => step.status === "failed") ?? [];
      say(
        `verify ${runRecord?.outcome ?? "recorded no run"}; failed: ${failed.map((step) => step.name).join(", ") || "none"}`,
      );
    }
    if (!values["no-record"])
      await runEffect(appendRecord(ledgerDir, record).pipe(Effect.provide(NodeServices.layer)));
    const minutes = ((Date.now() - started) / 60_000).toFixed(1);
    say(
      `${record.result} in ${minutes} min${values["no-record"] ? " (not recorded)" : ", recorded"}`,
    );
    return pass ? 0 : 1;
  } catch (error) {
    keep = true;
    say(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    if (keep) say(`kept ${space.root}`);
    else rmSync(space.root, { recursive: true, force: true });
  }
}

let failed = 0;
for (const stack of positionals) failed += await prove(stack);
process.exit(failed ? 1 : 0);
