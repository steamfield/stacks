/**
 * From packages/cli, build once with `bun run build`, then run
 * `bun run behavior-snapshot --out <new-or-empty-dir>` twice with different directories.
 * Compare them with `diff -r`. Use the same OS and Node/Git installations for both runs.
 *
 * Captures exit codes, streams, filesystem changes and debug JSONL from the built Node CLI.
 * The main pass is offline. Human mode uses script(1), so its stdout includes terminal stderr.
 * The telemetry pass captures a four-command sequence with and without an accepted notice.
 * Hosted search, stats, the signed allowlist and signals other than the fixed verify interrupt
 * are covered by the CLI tests and installed-binary e2e checks.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { capture, environment, type Runner } from "./behavior-snapshot/capture";
import { cases } from "./behavior-snapshot/cases";
import { normalizeFor } from "./behavior-snapshot/normalize";
import { telemetryPass } from "./behavior-snapshot/telemetry";

function outputDirectory(args: ReadonlyArray<string>) {
  const [flag, dir] = args;
  if (args.length !== 2 || flag !== "--out" || !dir || dir.startsWith("-")) {
    throw new Error("Usage: bun run behavior-snapshot --out <new-or-empty-dir>");
  }
  return resolve(dir);
}

async function mainPass(runner: Runner, out: string, scratch: string) {
  for (const audience of ["json", "agent", "human"] as const) {
    const base = join(scratch, audience);
    const cwd = join(base, "workspace");
    const project = join(cwd, "app");
    mkdirSync(cwd, { recursive: true });
    let previousProjects: string | undefined;
    const normalize = normalizeFor({ scratch, packageRoot: runner.packageRoot });
    for (const scenario of cases) {
      const home = join(base, "homes", scenario.id);
      const env = environment(home, runner.node);
      scenario.prepare?.({ cwd, project, home });
      const projects = join(env.XDG_STATE_HOME, "stacks", "projects");
      if (scenario.project && previousProjects && existsSync(previousProjects)) {
        // Carry the real record from new/verify forward while each invocation gets fresh XDG dirs.
        cpSync(previousProjects, projects, { recursive: true });
      }
      await capture({
        runner,
        out: join(out, "main", audience, scenario.id),
        env,
        audience,
        args: scenario.args,
        cwd: scenario.project === "inside" ? project : cwd,
        workspace: cwd,
        normalize,
      });
      if (scenario.project) previousProjects = projects;
    }
  }
  return cases.length * 3;
}

const packageRoot = join(import.meta.dirname, "..");
const binary = join(packageRoot, "dist", "stacks");
if (!existsSync(binary) || !existsSync(join(dirname(binary), "cli.mjs"))) {
  throw new Error("The built Node bundle is missing. Run bun run build from packages/cli.");
}
// Resolve the installed executable before isolating PATH, including when node is a version shim.
const node = execFileSync("node", ["-p", "process.execPath"], { encoding: "utf8" }).trim();
const runner = { node, binary, packageRoot };
const out = outputDirectory(process.argv.slice(2));
const reservation = ".snapshot-lock";
mkdirSync(out, { recursive: true });
// Reserve before inspecting the directory so two invocations cannot both capture here.
mkdirSync(join(out, reservation));
try {
  if (readdirSync(out).some((name) => name !== reservation)) {
    throw new Error(`Output directory is not empty: ${out}`);
  }
  const scratch = mkdtempSync(join(realpathSync(tmpdir()), "stacks-behavior-"));
  process.umask(0o022);
  const started = performance.now();
  try {
    const mainCount = await mainPass(runner, out, scratch);
    const telemetryCount = await telemetryPass(runner, out, scratch);
    console.log(
      `Captured ${mainCount + telemetryCount} commands in ${((performance.now() - started) / 1000).toFixed(2)}s.`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
} finally {
  rmdirSync(join(out, reservation));
}
