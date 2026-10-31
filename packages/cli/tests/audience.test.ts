import { cpSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Option } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import { ndjson, quiet, runCli, tempDir, terminal } from "./helpers/cli";
import { minimal, newRegistry, smallRegistry, writeEntry } from "./helpers/registry";
import { decodeResult, writeProject } from "./helpers/verify";

// Who reads the output: a human only at a terminal with no agent detected; an agent everywhere
// else (its shell, a pipe, CI); `--json` is the machine contract either way.

const dirs: Array<{ cleanup: () => void }> = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});
function temp() {
  const dir = tempDir();
  dirs.push(dir);
  return dir.path;
}
const agentShell = { CLAUDECODE: "1" };

describe("the audience is picked once per invocation from the terminal and agent detection", () => {
  // `doctor` at info level writes one command record; where it lands shows the audience.
  const cases = [
    { name: "a terminal with no agent is human", host: terminal, env: {}, human: true },
    {
      name: "a terminal under an agent is an agent",
      host: terminal,
      env: agentShell,
      human: false,
    },
    { name: "a pipe with no agent is an agent", host: {}, env: {}, human: false },
    { name: "a pipe under an agent is an agent", host: {}, env: agentShell, human: false },
  ];
  test.each(cases)("$name", async ({ host, env, human }) => {
    const home = temp();
    const file = join(home, "cli.jsonl");
    const result = await runCli(["doctor"], {
      home,
      host,
      env: { LOG_LEVEL: "info", STACKS_LOG_FILE: file, ...env },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Configuration: ok\n");
    if (human) expect(result.stderr).toMatch(/^\S+ INFO command success\s*\n$/);
    else expect(result.stderr).toBe("");
    // The log file gets the record whoever reads the output.
    expect(ndjson(readFileSync(file, "utf8"))).toEqual([
      expect.objectContaining({ msg: "command", outcome: "success" }),
    ]);
  });
  test.each(cases)("--json wins: $name", async ({ host, env }) => {
    const home = temp();
    const file = join(home, "cli.jsonl");
    const result = await runCli(["doctor", "--json"], {
      home,
      host,
      env: { LOG_LEVEL: "info", STACKS_LOG_FILE: file, ...env },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ configErrors: [] });
    expect(result.stderr).toBe("");
    expect(ndjson(readFileSync(file, "utf8"))).toHaveLength(1);
  });
});

describe("agent output carries no log lines", () => {
  test("a failure is its message and detail lines only, at the default level", async () => {
    const result = await runCli(["doctr"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Invalid command.\n  Command: doctr\n  Did you mean: doctor?\n  Next: run stacks --help to list the commands, or stacks <command> --help for one.\n",
    );
    // A person sees the same lines: the failure's log record goes to the file, so Next ends stderr.
    const human = await runCli(["doctr"], { host: terminal });
    expect(human.stderr).toBe(result.stderr);
  });
  test("a warning goes to the log file, not stderr", async () => {
    const home = temp();
    const file = join(home, "cli.jsonl");
    const missing = join(home, "nope");
    const result = await runCli(["list"], {
      home,
      env: { STACKS_REGISTRY_DIR: missing, LOG_LEVEL: "warn", STACKS_LOG_FILE: file },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(ndjson(readFileSync(file, "utf8"))).toEqual([
      expect.objectContaining({
        level: "warn",
        msg: `STACKS_REGISTRY_DIR is not a directory: ${missing}`,
      }),
    ]);
  });
});

describe("new for an agent", () => {
  const newCli = (home: string, args: string[], options: { cwd?: string; human?: boolean } = {}) =>
    runCli(["new", "fixture-stack", ...args], {
      home,
      env: quiet,
      host: {
        registry: newRegistry,
        cwd: options.cwd ?? home,
        ...(options.human ? terminal : {}),
      },
    });

  test("leaves out the absolute project path and the file listing the brief repeats", async () => {
    const home = temp();
    const agent = await newCli(home, ["app", "--sandbox"]);
    expect(agent.status).toBe(0);
    expect(agent.stderr).toBe("");
    expect(agent.stdout.split("\n")).toEqual([
      "Created app from fixture-stack (sandbox).",
      "Fragments: base-req, hooked, own-repo, ran-check, tooled",
      "Agents: claude",
      "Git: git not found; no repository",
      expect.stringMatching(/^Brief: \.stacks\/BRIEF\.md \(\d+ words\)$/),
      "Missing tools (the brief tells the agent):",
      "  qs-stack-tool not found (needed by fixture-stack)",
      "  qs-fragment-tool not found (needed by tooled; skip with --without tooled)",
      "",
      "Next: open app in your coding agent and give it this prompt:",
      "  Read .stacks/BRIEF.md and carry it out. It's your full task for this project; you're done when stacks verify passes.",
      "",
    ]);
    const human = await newCli(home, ["app2", "--sandbox"], { human: true });
    expect(human.stdout).toContain(`Project: ${join(home, "app2")}\n`);
    expect(human.stdout).toMatch(/\nWrote \d+ files:\n/);
    // A human also gets a command to paste; an agent has the prompt on the line above.
    expect(human.stdout).toContain('\nFor example: cd app2 && claude "Read .stacks/');
    const json = await newCli(home, ["app3", "--json"]);
    expect(JSON.parse(json.stdout).project).toBe(join(home, "app3"));
  });

  test("names untrusted entries' directories relative to the working directory", async () => {
    const home = temp();
    cpSync(newRegistry, join(home, "registry"), { recursive: true });
    const run = (args: string[], host = {}) =>
      runCli(["new", "fixture-stack", ...args], {
        home,
        env: { ...quiet, STACKS_REGISTRY_DIR: join(home, "registry") },
        host: { cwd: home, ...host },
      });
    const agent = await run(["app"]);
    expect(agent.status).toBe(0);
    expect(agent.stdout).toContain(": registry/stacks/fixture-stack\n");
    expect(agent.stdout).not.toContain(home);
    const human = await run(["app2"], terminal);
    expect(human.stdout).toContain(`: ${join(home, "registry", "stacks", "fixture-stack")}\n`);
  });

  test("a project outside the working directory keeps its absolute path", async () => {
    const home = temp();
    const app = join(temp(), "app");
    const agent = await newCli(home, [app]);
    expect(agent.status).toBe(0);
    expect(agent.stdout).toContain(`Created ${app} from fixture-stack.\n`);
    expect(agent.stdout).toContain(`Next: open ${app} in your coding agent`);
  });

  test("a directory whose name starts with two dots is still inside", async () => {
    const home = temp();
    const agent = await newCli(home, ["..app"]);
    expect(agent.status).toBe(0);
    expect(agent.stdout).toContain("Created ..app from fixture-stack.\n");
    expect(agent.stdout).toContain("Next: open ..app in your coding agent");
  });

  test("the working directory and the project reached by different real paths still nest", async () => {
    // macOS: the temp dir is /var/..., really /private/var/...; elsewhere a symlink plays /var.
    const home = temp();
    const real = realpathSync(home);
    const link = join(temp(), "link");
    symlinkSync(real, link);
    for (const [cwd, dir] of [
      [real, join(link, "via-link")],
      [link, join(real, "via-real")],
      [home, join(real, "from-given")],
    ] as const) {
      const agent = await newCli(home, [dir], { cwd });
      expect(agent.status).toBe(0);
      const name = dir.split("/").at(-1);
      expect(agent.stdout).toContain(`Created ${name} from fixture-stack.\n`);
      expect(agent.stdout).toContain(`Next: open ${name} in your coding agent`);
    }
  });

  test("a working directory that is a symlink to the project's parent", async () => {
    const parent = temp();
    const link = join(temp(), "parent-link");
    symlinkSync(parent, link);
    mkdirSync(join(parent, "sub"));
    const agent = await newCli(parent, ["app"], { cwd: link });
    expect(agent.status).toBe(0);
    expect(agent.stdout).toContain("Created app from fixture-stack.\n");
    expect(readFileSync(join(parent, "app", ".stacks", "BRIEF.md"), "utf8")).toMatch(/^# /);
  });
});

describe("verify for an agent", () => {
  const steps = [
    { name: "install", phase: "setup" as const, run: "echo installing" },
    { name: "lint", run: "echo lint broke; exit 1" },
    { name: "unit", run: "true" },
  ];
  const run = (root: string, args: string[], host = {}) =>
    runCli(["verify", ...args], {
      home: temp(),
      env: { ...quiet, PATH: process.env.PATH ?? "" },
      host: { cwd: root, ...host },
    });

  test("leaves out the passed rows and the progress lines; keeps failures, their output and Next", async () => {
    const root = temp();
    writeProject(root, steps);
    const agent = await run(root, []);
    expect(agent.status).toBe(5);
    expect(agent.stdout.split("\n")).toEqual([
      expect.stringMatching(
        /^verify: failed \(full run; 2 passed, 1 failed, 0 skipped; \d+\.\ds\)$/,
      ),
      "Tamper check: manifest only (no state record for this project on this machine), so this run can't count for the MVP gate.",
      "",
      expect.stringMatching(/^ {2}failed {3}check {5}lint {5}\(exit 1, \d+\.\ds\) {2}exited/),
      "      | lint broke",
      "",
      "Next: fix the code or config these steps exercise, not the steps, then run stacks verify again.",
      "",
    ]);
    // One `> name` event line per started step, then the failure; the report lists the failed
    // steps and carries Next.
    expect(agent.stderr).toBe("> install\n> lint\n> unit\nVerify failed.\n");
    const human = await run(root, [], terminal);
    expect(human.status).toBe(5);
    expect(human.stdout).toMatch(/\n {2}passed {3}setup {5}install/);
    expect(human.stdout).toMatch(/\n {2}passed {3}check {5}unit/);
    expect(human.stderr).toContain("> lint: echo lint broke; exit 1\n");
    const json = await run(root, ["--json"]);
    expect(decodeResult(json.stdout).steps.map((step) => step.status)).toEqual([
      "passed",
      "failed",
      "passed",
    ]);
  });

  test("a green run is its summary line alone", async () => {
    const root = temp();
    writeProject(root, [{ name: "unit", run: "true" }]);
    const agent = await run(root, []);
    expect(agent.status).toBe(0);
    expect(agent.stderr).toBe("> unit\n");
    expect(agent.stdout).toMatch(
      /^verify: green \(full run; 1 passed, 0 failed, 0 skipped; [^)]+\)\n/,
    );
    expect(agent.stdout).not.toContain("passed   check");
  });

  test("a skipped step keeps its row and reason", async () => {
    const root = temp();
    writeProject(root, steps);
    const agent = await run(root, ["--only", "unit"]);
    expect(agent.status).toBe(0);
    expect(agent.stdout).toContain("\n  skipped  check     lint     not selected by --only\n");
    expect(agent.stdout).not.toMatch(/\n {2}passed/);
  });

  test("changed steps: no per-step rows, the change named once on stderr", async () => {
    const root = temp();
    const file = writeProject(root, steps);
    const manifest = JSON.parse(readFileSync(file, "utf8")) as { verify: { run: string }[] };
    const lint = manifest.verify[1];
    if (lint) lint.run = "true";
    writeFileSync(file, JSON.stringify(manifest));
    const agent = await run(root, []);
    expect(agent.status).toBe(5);
    expect(agent.stdout).toMatch(/^verify: changed \(full run; 0 passed, 0 failed, 3 skipped; /);
    expect(agent.stdout).not.toContain("not run: the verify steps changed");
    expect(agent.stdout).toContain("\nNext: the verify steps changed since they were recorded.");
    expect(agent.stderr).toBe(
      "Verify steps changed since they were recorded.\n  Against: the manifest's own verifyDigest\n  Which steps changed is not itemized: there are no per-step digests to compare with.\n",
    );
    const human = await run(root, [], terminal);
    expect(human.stdout.match(/not run: the verify steps changed/g)).toHaveLength(3);
  });
});

describe("the guide by audience", () => {
  test("an agent gets the guide alone; a human first gets who it is for", async () => {
    for (const args of [[], ["guide"]]) {
      const agent = await runCli(args);
      expect(agent.status).toBe(0);
      expect(agent.stdout).toMatch(/^stacks starts projects for coding agents\./);
      const human = await runCli(args, { host: terminal });
      expect(human.stdout).toBe(
        `This guide is written for coding agents. To start a project yourself, run stacks search "<what you want to build>", then stacks new <stack> <dir>; stacks --help lists every command.\n\n${agent.stdout}`,
      );
      const json = await runCli([...args, "--json"], { host: terminal });
      expect(JSON.parse(json.stdout).guide).toBe(agent.stdout.trimEnd());
    }
  });
});

describe("list for an agent", () => {
  test("keeps each description whole on one line", async () => {
    const home = temp();
    const user = join(home, "config", "stacks");
    const description = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    writeEntry({
      root: user,
      kind: "stack",
      dir: "long",
      frontmatter: minimal("stack", "long").replace("long description.", description),
    });
    for (const host of [{}, { stdoutIsTTY: true, columns: Option.some(50) }]) {
      const agent = await runCli(["list", "stacks"], {
        home,
        env: { ...quiet, ...agentShell },
        host: { registry: smallRegistry, ...host },
      });
      expect(agent.status).toBe(0);
      expect(agent.stdout).toContain(`\n  long     user\n    ${description}\n`);
    }
  });

  test("names a rejected entry's directory relative to the working directory", async () => {
    const home = temp();
    const user = join(home, "config", "stacks");
    writeEntry({
      root: user,
      kind: "stack",
      dir: "broken",
      frontmatter: minimal("stack", "broken", "extra: 1"),
    });
    const agent = await runCli(["list"], {
      home,
      env: quiet,
      host: { registry: smallRegistry },
    });
    expect(agent.status).toBe(0);
    expect(agent.stdout).toContain("\n    config/stacks/stacks/broken\n");
  });
});

test("--help documents --json", async () => {
  const result = await runCli(["--help"]);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/--json +Write one JSON result to stdout/);
});
