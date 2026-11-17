import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Manifest } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import { MANIFEST_PATH } from "../src/core/project/manifest";
import { NewResult } from "../src/schemas/new";
import type { HostInfo } from "../src/services/host";
import { fakeAgent } from "./helpers/agents";
import { quiet, runCli, tempDir } from "./helpers/cli";
import { minimal, newRegistry, writeEntry } from "./helpers/registry";

const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});
function temp() {
  const dir = tempDir();
  dirs.push(dir);
  return dir.path;
}
const terminal = { stdinIsTTY: true, stdoutIsTTY: true } satisfies Partial<HostInfo>;
const PROMPT =
  "Read .stacks/BRIEF.md and carry it out. It's your full task for this project; you're done when stacks verify passes.";
const asRoot = process.getuid?.() === 0;

/** `new fixture-stack app --sandbox ...` in a fresh HOME (also its cwd) with `bin` as the whole PATH. */
async function newCli(
  args: string[],
  options: {
    env?: Record<string, string>;
    host?: Partial<HostInfo>;
    home?: string;
    stdout?: (text: string) => Promise<void>;
  } = {},
) {
  const home = options.home ?? temp();
  const result = await runCli(["new", "fixture-stack", "app", "--sandbox", ...args], {
    home,
    env: { ...quiet, XDG_STATE_HOME: join(home, "state"), PATH: join(home, "bin"), ...options.env },
    host: { registry: newRegistry, cwd: home, ...options.host },
    ...(options.stdout ? { stdout: options.stdout } : {}),
  });
  return { ...result, home, app: join(home, "app") };
}
const decode = (stdout: string) => Schema.decodeUnknownSync(NewResult)(JSON.parse(stdout));
const manifestOf = (app: string) =>
  Schema.decodeUnknownSync(Manifest)(JSON.parse(readFileSync(join(app, MANIFEST_PATH), "utf8")), {
    onExcessProperty: "error",
  });
const envelope = (stderr: string) =>
  JSON.parse(stderr.trim().split("\n").at(-1) ?? "") as {
    error: { tag: string; message: string; details?: unknown };
  };
/** A project-origin fragment in `home`'s `.stacks/`, which is never trusted. */
function localFragment(home: string) {
  writeEntry({
    root: join(home, ".stacks"),
    kind: "fragment",
    dir: "local-extra",
    frontmatter: minimal("fragment", "local-extra"),
  });
  return ["--with", "local-extra"];
}

describe("inside an agent", () => {
  test("CLAUDECODE=1: the next step for the agent on stdout and inside-agent in the manifest [1.4#3]", async () => {
    const { status, stdout, stderr, app } = await newCli([], { env: { CLAUDECODE: "1" } });
    expect(stderr).toBe("");
    expect(status).toBe(0);
    const tail = stdout.trimEnd().split("\n").at(-1);
    // The project is under the working directory, so it is named relative to it.
    expect(tail).toBe(
      "NEXT STEP FOR THE AGENT: read .stacks/BRIEF.md now and carry it out, working in app. Loop on stacks verify until it passes. Don't stop here to report back; the brief says when to ask the user.",
    );
    expect(stdout).not.toContain(app);
    const manifest = manifestOf(app);
    expect(manifest.handoff).toMatchObject({ kind: "inside-agent", agent: "claude" });
    expect(Number.isNaN(Date.parse(manifest.handoff?.at ?? ""))).toBe(false);
  });

  test("CLAUDECODE=1 for a project outside the working directory: named by its absolute path [1.4#3]", async () => {
    const home = temp();
    const elsewhere = join(temp(), "elsewhere");
    const { status, stdout } = await runCli(["new", "fixture-stack", elsewhere, "--sandbox"], {
      home,
      env: { ...quiet, CLAUDECODE: "1", PATH: join(home, "bin") },
      host: { registry: newRegistry, cwd: home },
    });
    expect(status).toBe(0);
    expect(stdout.trimEnd().split("\n").at(-1)).toContain(`, working in ${elsewhere}. Loop on`);
  });

  test("CLAUDECODE=1 from inside the project: working in the current directory [1.4#3]", async () => {
    const home = temp();
    const app = join(home, "app");
    mkdirSync(app);
    const { status, stdout } = await runCli(["new", "fixture-stack", ".", "--sandbox"], {
      home,
      env: { ...quiet, CLAUDECODE: "1", PATH: join(home, "bin") },
      host: { registry: newRegistry, cwd: app },
    });
    expect(status).toBe(0);
    expect(stdout.trimEnd().split("\n").at(-1)).toContain(
      ", working in the current directory. Loop on",
    );
  });

  test("CLAUDECODE=1 --json: one result whose handoff is inside-agent with the prompt [1.4#3]", async () => {
    const { status, stdout, stderr } = await newCli(["--json"], { env: { CLAUDECODE: "1" } });
    expect(stderr).toBe("");
    expect(status).toBe(0);
    expect(stdout.trim().split("\n")).toHaveLength(1);
    expect(decode(stdout).handoff).toEqual({
      kind: "inside-agent",
      agent: "claude",
      untrusted: [],
      prompt: PROMPT,
    });
  });

  test("AI_AGENT=foo with a fake claude on PATH and a terminal: inside-agent as other, nothing launched [1.4#4]", async () => {
    const home = temp();
    const claude = fakeAgent(join(home, "bin"), "claude");
    const { status, stdout, stderr, app } = await newCli(["--json"], {
      home,
      env: { AI_AGENT: "foo" },
      host: terminal,
    });
    expect(stderr).toBe("");
    expect(status).toBe(0);
    expect(decode(stdout).handoff).toMatchObject({ kind: "inside-agent", agent: "other" });
    expect(claude.ran()).toBe(false);
    expect(manifestOf(app).handoff).toMatchObject({ kind: "inside-agent", agent: "other" });
  });

  test("an untrusted entry under an agent: STOP names it, and --json lists its id [1.4#6]", async () => {
    const home = temp();
    const human = await newCli(localFragment(home), { home, env: { CLAUDECODE: "1" } });
    expect(human.stderr).toBe("");
    expect(human.status).toBe(0);
    expect(human.stdout.trimEnd().split("\n").at(-1)).toBe(
      "STOP: this project uses entries this machine hasn't trusted: local-extra. Don't start. Show the user the list and .stacks/BRIEF.md's first section, and continue only if they confirm.",
    );
    const other = temp();
    const json = await newCli([...localFragment(other), "--json"], {
      home: other,
      env: { CLAUDECODE: "1" },
    });
    expect(json.status).toBe(0);
    expect(decode(json.stdout).handoff).toEqual({
      kind: "inside-agent",
      agent: "claude",
      untrusted: ["local-extra"],
      prompt: PROMPT,
    });
  });
});

describe("flag contradictions", () => {
  test.each([
    [
      ["--launch", "claude", "--no-launch"],
      ["--launch", "--no-launch"],
    ],
    [
      ["--launch", "claude", "--json"],
      ["--launch", "--json"],
    ],
  ])(
    "%j exits 2 with a Usage envelope naming both flags and writes nothing [1.4#5]",
    async (args, flags) => {
      const { status, stdout, stderr, app } = await newCli([...args, "--json"]);
      expect(status).toBe(2);
      expect(stdout).toBe("");
      expect(envelope(stderr).error).toMatchObject({ tag: "Usage", details: { flags } });
      expect(existsSync(app)).toBe(false);
    },
  );

  test("human mode says which flags clash and what to do [1.4#5]", async () => {
    const { status, stdout, stderr } = await newCli(["--launch", "claude", "--no-launch"]);
    expect(status).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toBe(
      "Invalid command.\n  --launch and --no-launch can't be used together.\n  Next: drop one of them.\n",
    );
  });

  test("--launch with an unknown agent id is Usage [1.4#5]", async () => {
    const { status, stdout, stderr, app } = await newCli(["--launch", "vim", "--json"]);
    expect(status).toBe(2);
    expect(stdout).toBe("");
    expect(envelope(stderr).error.tag).toBe("Usage");
    expect(existsSync(app)).toBe(false);
  });
});

describe("launching an agent", () => {
  test("a fake claude on PATH gets the prompt in the project, in the CLI's process group; its exit is the invocation's [1.4#7]", async () => {
    const home = temp();
    const claude = fakeAgent(join(home, "bin"), "claude", { exit: 7 });
    let ranBeforeSummary: boolean | undefined;
    const { status, stdout, stderr, app } = await newCli([], {
      home,
      host: terminal,
      stdout: async () => {
        ranBeforeSummary ??= claude.ran();
      },
    });
    expect(status).toBe(7);
    expect(stderr).toBe("");
    expect(ranBeforeSummary).toBe(false);
    expect(stdout).toContain("Created app from fixture-stack (sandbox).");
    expect(stdout.trimEnd().split("\n").at(-1)).toBe(`Launching ${claude.bin} in app...`);
    const run = claude.run();
    expect(run.argv).toEqual([PROMPT]);
    expect(realpathSync(run.cwd)).toBe(realpathSync(app));
    expect(run.pgid).toBe(run.parentPgid);
    expect(manifestOf(app).handoff).toMatchObject({ kind: "launch", agent: "claude" });
  });

  test("the launched agent gets the user's environment unchanged [1.4#7]", async () => {
    const home = temp();
    const claude = fakeAgent(join(home, "bin"), "claude");
    const { status } = await newCli([], { home, host: terminal, env: { MY_SETTING: "kept" } });
    expect(status).toBe(0);
    expect(claude.run().env).toMatchObject({ MY_SETTING: "kept", PATH: join(home, "bin") });
  });

  test("the agents setting picks the agent first; --launch picks one alone [1.4#17]", async () => {
    const home = temp();
    const claude = fakeAgent(join(home, "bin"), "claude");
    const codex = fakeAgent(join(home, "bin"), "codex");
    mkdirSync(join(home, "config", "stacks"), { recursive: true });
    writeFileSync(join(home, "config", "stacks", "config.json"), '{"agents":["codex"]}');
    expect((await newCli([], { home, host: terminal })).status).toBe(0);
    expect(codex.run().argv).toEqual([PROMPT]);
    expect(claude.ran()).toBe(false);
    const other = temp();
    const second = fakeAgent(join(other, "bin"), "claude");
    const opencode = fakeAgent(join(other, "bin"), "opencode");
    expect((await newCli(["--launch", "opencode"], { home: other, host: terminal })).status).toBe(
      0,
    );
    expect(opencode.run().argv).toEqual(["--prompt", PROMPT]);
    expect(second.ran()).toBe(false);
  });

  test("an agent killed by a signal gives 128 plus the signal number, with no envelope [1.4#16]", async () => {
    const home = temp();
    fakeAgent(join(home, "bin"), "claude", "die-by-sigterm");
    const { status, stderr, app } = await newCli([], { home, host: terminal });
    expect(status).toBe(143);
    expect(stderr).toBe("");
    expect(existsSync(join(app, MANIFEST_PATH))).toBe(true);
  });

  test.skipIf(asRoot)(
    "an agent binary found but not executable by this user is PermissionDenied launch; the project stays [1.4#15]",
    async () => {
      const home = temp();
      const claude = fakeAgent(join(home, "bin"), "claude");
      // Executable for others only: PATH lookup accepts it, exec refuses the owner.
      chmodSync(claude.bin, 0o001);
      const { status, stdout, stderr, app } = await newCli([], { home, host: terminal });
      expect(status).toBe(6);
      expect(stdout).toContain(`Launching ${claude.bin} in app...`);
      expect(stderr).toBe(
        `Permission denied.\n  Path: ${claude.bin}\n  The agent CLI was found on PATH but can't be run by you. The project was written.\n  Next: fix the binary's permissions, or start your agent in the project yourself.\n`,
      );
      expect(existsSync(join(app, MANIFEST_PATH))).toBe(true);
      // Nothing was launched, so the record no longer says it was.
      expect(manifestOf(app).handoff).toEqual({
        kind: "print",
        at: manifestOf(app).createdAt,
      });
    },
  );

  // Linux's exec falls back to /bin/sh for a file it can't execute, so only macOS sees ENOEXEC.
  test.runIf(process.platform === "darwin")(
    "an agent binary the OS can't execute is a defect; the record says print, not launch (macOS)",
    async () => {
      const home = temp();
      mkdirSync(join(home, "bin"));
      // Executable bits, but no shebang and no valid binary format: exec fails with ENOEXEC.
      const bin = join(home, "bin", "claude");
      writeFileSync(bin, "\u007fELF not really\n");
      chmodSync(bin, 0o755);
      const { status, stdout, stderr, app } = await newCli([], { home, host: terminal });
      expect(status).toBe(1);
      expect(stdout).toContain(`Launching ${bin} in app...`);
      expect(stderr).toBe(
        "An unexpected error occurred.\n  Next: set STACKS_LOG_FILE to a file path and run the command again; the file records where it failed. Report it if it repeats.\n",
      );
      expect(manifestOf(app).handoff).toEqual({ kind: "print", at: manifestOf(app).createdAt });
    },
  );

  test.runIf(process.platform === "linux")(
    "an executable text agent without a shebang returns the fallback shell's status (Linux)",
    async () => {
      const home = temp();
      mkdirSync(join(home, "bin"));
      const bin = join(home, "bin", "claude");
      writeFileSync(bin, "exit 127\n");
      chmodSync(bin, 0o755);
      const { status, stdout, stderr, app } = await newCli([], { home, host: terminal });
      expect(status).toBe(127);
      expect(stdout).toContain(`Launching ${bin} in app...`);
      expect(stderr).toBe("");
      expect(manifestOf(app).handoff).toEqual({
        kind: "launch",
        agent: "claude",
        at: manifestOf(app).createdAt,
      });
    },
  );
});

describe("printing the prompt", () => {
  // Each rule's own reason is in the decideHandoff table: with --json the reason is always json.
  test.each<[string, string[], Partial<HostInfo>]>([
    ["--no-launch", ["--no-launch"], terminal],
    ["stdin not a terminal", [], { stdinIsTTY: false, stdoutIsTTY: true }],
    ["stdout not a terminal", [], { stdinIsTTY: true, stdoutIsTTY: false }],
  ])("%s: the prompt, exit 0, and the fake claude never ran [1.4#9]", async (_, args, host) => {
    const home = temp();
    const claude = fakeAgent(join(home, "bin"), "claude");
    const human = await newCli(args, { home, host });
    expect(human.stderr).toBe("");
    expect(human.status).toBe(0);
    expect(human.stdout).toContain(
      `Next: open app in your coding agent and give it this prompt:\n  ${PROMPT}\n`,
    );
    const other = temp();
    const second = fakeAgent(join(other, "bin"), "claude");
    const json = await newCli([...args, "--json"], { home: other, host });
    expect(json.status).toBe(0);
    expect(decode(json.stdout).handoff).toEqual({
      kind: "print",
      reason: "json",
      untrusted: [],
      prompt: PROMPT,
    });
    expect(manifestOf(human.app).handoff).toMatchObject({ kind: "print" });
    expect(manifestOf(human.app).handoff).not.toHaveProperty("agent");
    expect(claude.ran()).toBe(false);
    expect(second.ran()).toBe(false);
  });

  test("an untrusted entry with a fake claude on PATH and a terminal: printed with a warning, never launched [1.4#9]", async () => {
    const home = temp();
    const claude = fakeAgent(join(home, "bin"), "claude");
    const { status, stdout, stderr } = await newCli(localFragment(home), { home, host: terminal });
    expect(stderr).toBe("");
    expect(status).toBe(0);
    expect(stdout).toContain(
      "Not launching an agent: this project uses entries this machine hasn't trusted (local-extra; listed above).",
    );
    expect(stdout).toMatch(/ {2}fragment local-extra \(project\): .*local-extra\n/);
    expect(stdout).toContain(`  ${PROMPT}\n`);
    expect(claude.ran()).toBe(false);
  });

  test("an empty PATH: no agent found, the prompt printed [1.4#9]", async () => {
    const { status, stdout, stderr } = await newCli([], { host: terminal });
    expect(stderr).toBe("");
    expect(status).toBe(0);
    expect(stdout).toContain(
      "No agent CLI found on PATH (looked for claude, codex, opencode, cursor-agent, copilot).\nNext: open app",
    );
  });

  test("--launch codex with only claude on PATH: codex isn't on PATH, nothing launched [1.4#18]", async () => {
    const home = temp();
    const claude = fakeAgent(join(home, "bin"), "claude");
    const { status, stdout, stderr } = await newCli(["--launch", "codex"], {
      home,
      host: terminal,
    });
    expect(stderr).toBe("");
    expect(status).toBe(0);
    expect(stdout).toContain("codex isn't on PATH.\nNext: open app");
    expect(stdout).toContain(`For example: cd app && codex "${PROMPT}"`);
    expect(claude.ran()).toBe(false);
  });
});

test("an npx invocation is the one the prompt names [1.4#10]", async () => {
  const { status, stdout } = await newCli(["--json"], {
    host: { invocation: "npx -y stacks@1.2.3" },
  });
  expect(status).toBe(0);
  expect(decode(stdout).handoff.prompt).toContain("npx -y stacks@1.2.3 verify passes.");
});

test("the command log record names the handoff and the agent, nothing else of it [1.4#7]", async () => {
  // Agent output writes no log lines to stderr; the record goes to the log file.
  const home = temp();
  const file = join(home, "cli.jsonl");
  const { stderr } = await newCli([], {
    home,
    env: { CLAUDECODE: "1", LOG_LEVEL: "info", STACKS_LOG_FILE: file },
  });
  expect(stderr).toBe("");
  const record = JSON.parse(
    readFileSync(file, "utf8")
      .split("\n")
      .find((line) => line.includes('"msg":"command"')) ?? "",
  ) as Record<string, unknown>;
  expect(record).toMatchObject({ handoff: "inside-agent", agent: "claude", status: 0 });
  expect(JSON.stringify(record)).not.toContain("BRIEF");
});

test.each(["codex", "opencode,codex"])(
  "--no-launch examples use the first target in --agents %s",
  async (agents) => {
    const { status, stdout, stderr, app } = await newCli(["--agents", agents, "--no-launch"], {
      host: terminal,
    });
    expect(status).toBe(0);
    expect(stderr).toBe("");
    const command = agents.startsWith("opencode") ? "opencode --prompt" : "codex";
    expect(stdout.trimEnd().split("\n").at(-1)).toBe(
      `For example: cd app && ${command} "${PROMPT}"`,
    );
    expect(manifestOf(app).agents).toEqual(agents.split(","));
  },
);
