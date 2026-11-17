import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import { decideHandoff } from "../src/core/handoff/decide";
import { NewResult } from "../src/schemas/new";
import { fakeAgent } from "./helpers/agents";
import { scriptedTerminal } from "./helpers/cli";
import {
  PICKER_PROMPT,
  type PickerWorkspace,
  pickerCli,
  pickerManifest,
  pickerNew,
  pickerWorkspace,
} from "./helpers/picker";
import { minimal, writeEntry } from "./helpers/registry";

const workspaces: PickerWorkspace[] = [];
afterEach(() => {
  for (const workspace of workspaces.splice(0)) workspace.cleanup();
});
function workspace() {
  const result = pickerWorkspace();
  workspaces.push(result);
  return result;
}
function agents(w: PickerWorkspace) {
  return [fakeAgent(w.bin, "claude"), fakeAgent(w.bin, "codex"), fakeAgent(w.bin, "opencode")];
}
function configured(w: PickerWorkspace, value: string) {
  const file = join(w.home, "config/stacks/config.json");
  mkdirSync(join(w.home, "config/stacks"), { recursive: true });
  writeFileSync(file, value);
  return file;
}
function rows(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => /^\s*\d+\)/.test(line))
    .map((line) => line.trim());
}
function printed(w: PickerWorkspace, stdout: string) {
  expect(stdout).toContain(PICKER_PROMPT);
  expect(pickerManifest(w.project).handoff).toMatchObject({ kind: "print" });
  expect(pickerManifest(w.project).handoff).not.toHaveProperty("agent");
  expect(readFileSync(join(w.project, "README.md"), "utf8")).toBe("# Picker project\n");
  expect(existsSync(join(w.project, ".git"))).toBe(true);
}

test.each(["CLAUDECODE", "AI_AGENT"])(
  "%s prevents a picker and launch with several agents installed [4.4c#1]",
  async (marker) => {
    const w = workspace();
    const installed = agents(w);
    const terminal = scriptedTerminal(["2"]);
    const run = await pickerNew(w, [], { terminal, env: { [marker]: "1" } });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout).toContain("NEXT STEP FOR THE AGENT:");
    expect(run.stdout).not.toContain("Agents found:");
    expect(terminal.displayed).toEqual([]);
    expect(terminal.reads).toBe(0);
    expect(installed.map((agent) => agent.ran())).toEqual([false, false, false]);
    expect(pickerManifest(w.project).handoff?.kind).toBe("inside-agent");
  },
);

test("piped stdout prints not-a-terminal without reading [4.4c#1]", async () => {
  const w = workspace();
  const installed = agents(w);
  const terminal = scriptedTerminal(["2"]);
  const run = await pickerNew(w, [], { terminal, host: { stdoutIsTTY: false } });
  expect(run.status).toBe(0);
  expect(run.stderr).toBe("");
  printed(w, run.stdout);
  expect(terminal.displayed).toEqual([]);
  expect(terminal.reads).toBe(0);
  expect(installed.every((agent) => !agent.ran())).toBe(true);
  expect(
    decideHandoff({
      detected: "none",
      json: false,
      launch: true,
      stdinIsTTY: true,
      stdoutIsTTY: false,
      untrusted: [],
      configured: [],
      found: new Map([
        ["claude", "/claude"],
        ["codex", "/codex"],
      ]),
      prompt: PICKER_PROMPT,
    }),
  ).toMatchObject({ kind: "print", reason: "not-a-terminal" });
});

test("configured codex launches without reading even when claude is available [4.4c#2]", async () => {
  const w = workspace();
  const claude = fakeAgent(w.bin, "claude");
  const codex = fakeAgent(w.bin, "codex");
  configured(w, '{"agents":["codex"]}');
  const terminal = scriptedTerminal(["1"]);
  const run = await pickerNew(w, [], { terminal });
  expect(run.status).toBe(0);
  expect(run.stderr).toBe("");
  expect(run.stdout).toContain("Launching");
  expect(run.stdout).not.toContain("Agents found:");
  expect(terminal.reads).toBe(0);
  expect(terminal.displayed).toEqual([]);
  expect(codex.run().argv).toEqual([PICKER_PROMPT]);
  expect(claude.ran()).toBe(false);
  expect(pickerManifest(w.project).handoff).toMatchObject({ kind: "launch", agent: "codex" });
});

test.each([
  ["claude", [PICKER_PROMPT], "claude"],
  ["codex", [PICKER_PROMPT], "codex"],
  ["opencode", ["--prompt", PICKER_PROMPT], "opencode"],
  ["cursor-agent", [PICKER_PROMPT], "cursor"],
  ["copilot", ["-i", PICKER_PROMPT], "other"],
])("one installed harness, %s, launches without asking [4.4c#3]", async (bin, argv, agent) => {
  const w = workspace();
  const installed = fakeAgent(w.bin, bin);
  const terminal = scriptedTerminal();
  const run = await pickerNew(w, [], { terminal });
  expect(run.status).toBe(0);
  expect(run.stderr).toBe("");
  expect(run.stdout).toContain("Launching");
  expect(terminal.reads).toBe(0);
  expect(terminal.displayed).toEqual([]);
  expect(installed.run().argv).toEqual(argv);
  expect(installed.run().cwd).toBe(w.project);
  expect(pickerManifest(w.project).handoff).toMatchObject({ kind: "launch", agent });
});

test.each([
  ["", 0, "claude"],
  ["2", 1, "codex"],
])(
  "summary precedes the ordered picker; answer %j launches the chosen row [4.4c#4]",
  async (answer, index, agent) => {
    const w = workspace();
    const installed = agents(w);
    const terminal = scriptedTerminal([answer]);
    const run = await pickerNew(w, [], { terminal });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    const menu = terminal.displayed.join("");
    expect(menu).toContain("Agents found:");
    expect(rows(menu)).toEqual(["1) Claude Code", "2) Codex CLI", "3) OpenCode"]);
    expect(menu).toContain("Hand the project to [1-3, Enter for 1]:");
    expect(run.stdout.indexOf("Created app from picker-stack (sandbox).")).toBeGreaterThanOrEqual(
      0,
    );
    expect(run.stdout.indexOf("Created app")).toBeLessThan(run.stdout.indexOf("Agents found:"));
    expect(run.stdout).toContain(menu);
    expect(terminal.reads).toBe(1);
    expect(installed.map((fake) => fake.ran())).toEqual(installed.map((_, i) => i === index));
    expect(installed[index]?.run().argv).toEqual([PICKER_PROMPT]);
    expect(pickerManifest(w.project).handoff).toMatchObject({ kind: "launch", agent });
  },
);

test("two invalid answers stop asking and keep a printed handoff [4.4c#4]", async () => {
  const w = workspace();
  const installed = agents(w);
  const terminal = scriptedTerminal(["no", "4", "2"]);
  const run = await pickerNew(w, [], { terminal });
  expect(run.status).toBe(0);
  expect(run.stderr).toBe("");
  printed(w, run.stdout);
  expect(terminal.reads).toBe(2);
  expect(terminal.displayed.join("").match(/Hand the project to/g)).toHaveLength(2);
  expect(installed.every((agent) => !agent.ran())).toBe(true);
});

test("EOF at the picker keeps the project and prints the prompt [4.4c#5]", async () => {
  const w = workspace();
  const installed = agents(w);
  const terminal = scriptedTerminal();
  const run = await pickerNew(w, [], { terminal });
  expect(run.status).toBe(0);
  expect(run.stderr).toBe("");
  printed(w, run.stdout);
  expect(terminal.displayed.join("")).toContain("Hand the project to");
  expect(terminal.reads).toBe(1);
  expect(installed.every((agent) => !agent.ran())).toBe(true);
});

test("interrupting a blocked picker keeps the completed scaffold and print record [4.4c#5]", async () => {
  const w = workspace();
  const installed = agents(w);
  const terminal = scriptedTerminal([Effect.never]);
  const controller = new AbortController();
  const running = pickerNew(w, [], { terminal, signal: controller.signal });
  try {
    await vi.waitFor(
      () => {
        expect(terminal.displayed.join("")).toContain("Hand the project to");
        expect(terminal.reads).toBe(1);
      },
      { timeout: 3000 },
    );
    expect(pickerManifest(w.project).handoff?.kind).toBe("print");
  } finally {
    controller.abort();
    await running;
  }
  const run = await running;
  expect(run.status).toBe(130);
  expect(run.stdout).toContain("Created app");
  expect(run.stderr).toBe(
    "Command interrupted.\n  Next: run the same command again when you're ready.\n",
  );
  expect(readFileSync(join(w.project, "README.md"), "utf8")).toBe("# Picker project\n");
  expect(existsSync(join(w.project, ".git"))).toBe(true);
  expect(pickerManifest(w.project).handoff?.kind).toBe("print");
  expect(installed.every((agent) => !agent.ran())).toBe(true);
});

test("--launch copilot passes one prompt argument and records other [4.4c#6]", async () => {
  const w = workspace();
  const copilot = fakeAgent(w.bin, "copilot", { exit: 7 });
  const claude = fakeAgent(w.bin, "claude");
  const terminal = scriptedTerminal(["1"]);
  const run = await pickerNew(w, ["--launch", "copilot"], { terminal });
  expect(run.status).toBe(7);
  expect(run.stderr).toBe("");
  expect(run.stdout).toContain("Launching");
  expect(terminal.reads).toBe(0);
  expect(copilot.run().argv).toEqual(["-i", PICKER_PROMPT]);
  expect(copilot.run().cwd).toBe(w.project);
  expect(claude.ran()).toBe(false);
  expect(pickerManifest(w.project).handoff).toMatchObject({ kind: "launch", agent: "other" });
});

test("choosing Copilot records other without widening the manifest agent ids [4.4c#4] [4.4c#6]", async () => {
  const w = workspace();
  const claude = fakeAgent(w.bin, "claude");
  const codex = fakeAgent(w.bin, "codex");
  const copilot = fakeAgent(w.bin, "copilot");
  const terminal = scriptedTerminal(["3"]);
  const run = await pickerNew(w, [], { terminal });
  expect(run.status).toBe(0);
  expect(run.stderr).toBe("");
  expect(run.stdout).toContain("Agents found:");
  expect(rows(terminal.displayed.join(""))).toEqual([
    "1) Claude Code",
    "2) Codex CLI",
    "3) Copilot CLI",
  ]);
  expect(terminal.reads).toBe(1);
  expect(copilot.run().argv).toEqual(["-i", PICKER_PROMPT]);
  expect(claude.ran()).toBe(false);
  expect(codex.ran()).toBe(false);
  expect(pickerManifest(w.project).handoff).toMatchObject({ kind: "launch", agent: "other" });
});

test("missing --launch copilot prints instead of choosing a different installed agent [4.4c#6]", async () => {
  const w = workspace();
  const installed = agents(w);
  const terminal = scriptedTerminal(["1"]);
  const run = await pickerNew(w, ["--launch", "copilot"], { terminal });
  expect(run.status).toBe(0);
  expect(run.stderr).toBe("");
  expect(run.stdout).toContain("copilot isn't on PATH.");
  printed(w, run.stdout);
  expect(terminal.reads).toBe(0);
  expect(installed.every((agent) => !agent.ran())).toBe(true);
});

test.each(["json", "no-launch", "dry-run", "stdin", "untrusted"])(
  "%s never asks or launches with several installed agents [4.4c#10]",
  async (mode) => {
    const w = workspace();
    const installed = agents(w);
    const terminal = scriptedTerminal(["2"]);
    let args: string[] = [];
    if (mode === "json") args = ["--json"];
    if (mode === "no-launch") args = ["--no-launch"];
    if (mode === "dry-run") args = ["--dry-run"];
    if (mode === "untrusted") {
      writeEntry({
        root: join(w.home, ".stacks"),
        kind: "fragment",
        dir: "local",
        frontmatter: minimal("fragment", "local"),
      });
      args = ["--with", "local", "--launch", "codex"];
    }
    const run = await pickerNew(w, args, {
      terminal,
      host: mode === "stdin" ? { stdinIsTTY: false } : {},
    });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    if (mode === "json") {
      expect(Schema.decodeUnknownSync(NewResult)(JSON.parse(run.stdout)).handoff).toMatchObject({
        kind: "print",
        reason: "json",
      });
    } else {
      expect(run.stdout).toContain(mode === "dry-run" ? "picker-stack" : PICKER_PROMPT);
    }
    expect(terminal.reads).toBe(0);
    expect(terminal.displayed).toEqual([]);
    expect(installed.every((agent) => !agent.ran())).toBe(true);
    if (mode === "dry-run") expect(existsSync(w.project)).toBe(false);
    else expect(pickerManifest(w.project).handoff?.kind).toBe("print");
  },
);

test("an unavailable configured agent falls through to the picker [4.4c#11]", async () => {
  const w = workspace();
  const installed = agents(w);
  configured(w, '{"agents":["cursor"]}');
  const terminal = scriptedTerminal(["2"]);
  const run = await pickerNew(w, [], { terminal });
  expect(run.status).toBe(0);
  expect(run.stderr).toBe("");
  expect(run.stdout).toContain("Agents found:");
  expect(rows(terminal.displayed.join(""))).toEqual([
    "1) Claude Code",
    "2) Codex CLI",
    "3) OpenCode",
  ]);
  expect(terminal.reads).toBe(1);
  expect(installed.map((agent) => agent.ran())).toEqual([false, true, false]);
});

test.each([false, true])(
  "settings order wins unless an explicit launch overrides it: %s [4.4c#11]",
  async (explicit) => {
    const w = workspace();
    const installed = agents(w);
    configured(w, '{"agents":["cursor","opencode","codex"]}');
    const terminal = scriptedTerminal(["1"]);
    const run = await pickerNew(w, explicit ? ["--launch", "codex"] : [], { terminal });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout).toContain("Launching");
    expect(terminal.reads).toBe(0);
    expect(terminal.displayed).toEqual([]);
    expect(installed.map((agent) => agent.ran())).toEqual(
      explicit ? [false, true, false] : [false, false, true],
    );
  },
);

test.each(["2junk", "1.5", "0", "4"])(
  "invalid %j can be corrected on the only retry [4.4c#12]",
  async (answer) => {
    const w = workspace();
    const installed = agents(w);
    const terminal = scriptedTerminal([answer, "2"]);
    const run = await pickerNew(w, [], { terminal });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout).toContain("Agents found:");
    expect(terminal.reads).toBe(2);
    expect(installed.map((agent) => agent.ran())).toEqual([false, true, false]);
    expect(pickerManifest(w.project).handoff).toMatchObject({ kind: "launch", agent: "codex" });
  },
);

test("a chosen agent receives the real project cwd through a symlink with shell characters [4.4c#13]", async () => {
  const w = workspace();
  const installed = agents(w);
  const alias = join(w.home, "alias");
  symlinkSync(w.home, alias);
  const name = "app 'é & $HOME";
  const terminal = scriptedTerminal(["2"]);
  const run = await pickerCli(w, ["new", "picker-stack", join(alias, name), "--sandbox"], {
    terminal,
  });
  expect(run.status).toBe(0);
  expect(run.stderr).toBe("");
  expect(run.stdout).toContain("Agents found:");
  expect(installed[1]?.run()).toMatchObject({ cwd: join(w.home, name), argv: [PICKER_PROMPT] });
  expect(installed.map((agent) => agent.ran())).toEqual([false, true, false]);
  expect(pickerManifest(join(w.home, name)).handoff).toMatchObject({
    kind: "launch",
    agent: "codex",
  });
});

test("add chooses after its summary without changing existing files or the step digest [4.4c#15]", async () => {
  const w = workspace();
  const initial = await pickerNew(w, ["--no-launch"]);
  expect(initial.status).toBe(0);
  expect(initial.stderr).toBe("");
  expect(initial.stdout).toContain(PICKER_PROMPT);
  writeFileSync(join(w.project, "README.md"), "user's existing work\n");
  const installed = agents(w);
  const terminal = scriptedTerminal(["2"]);
  let beforeChoice: ReturnType<typeof pickerManifest> | undefined;
  const run = await pickerCli(w, ["add", "picker-extra", "--dir", w.project], {
    terminal,
    stdout: async (text) => {
      if (text.includes("Agents found:")) {
        beforeChoice = pickerManifest(w.project);
        expect(beforeChoice.handoff?.kind).toBe("print");
      }
    },
  });
  expect(run.status).toBe(0);
  expect(run.stderr).toBe("");
  expect(run.stdout.indexOf("Agents found:")).toBeGreaterThan(0);
  expect(run.stdout.slice(0, run.stdout.indexOf("Agents found:"))).toContain("picker-extra");
  expect(terminal.reads).toBe(1);
  expect(installed.map((agent) => agent.ran())).toEqual([false, true, false]);
  expect(readFileSync(join(w.project, "README.md"), "utf8")).toBe("user's existing work\n");
  expect(readFileSync(join(w.project, "extra.txt"), "utf8")).toBe("added\n");
  const after = pickerManifest(w.project);
  expect(beforeChoice?.verifyDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(beforeChoice?.verify).toHaveLength(1);
  expect(after).toEqual({ ...beforeChoice, handoff: after.handoff });
  expect(after.handoff).toMatchObject({ kind: "launch", agent: "codex" });
});

test("a pick neither persists a preference nor changes adapter targets on the next invocation [4.4c#16]", async () => {
  const w = workspace();
  const installed = agents(w);
  const bytes = '{ "author": "Picker Author" }\n';
  const file = configured(w, bytes);
  const firstTerminal = scriptedTerminal(["2"]);
  const first = await pickerNew(w, [], { terminal: firstTerminal });
  expect(first.status).toBe(0);
  expect(first.stderr).toBe("");
  expect(first.stdout).toContain("Agents found:");
  expect(firstTerminal.reads).toBe(1);
  expect(pickerManifest(w.project).agents).toEqual(["claude"]);
  const secondTerminal = scriptedTerminal(["3"]);
  const secondProject = join(w.home, "second");
  const second = await pickerCli(w, ["new", "picker-stack", secondProject, "--sandbox"], {
    terminal: secondTerminal,
  });
  expect(second.status).toBe(0);
  expect(second.stderr).toBe("");
  expect(second.stdout).toContain("Agents found:");
  expect(secondTerminal.reads).toBe(1);
  expect(pickerManifest(secondProject).handoff).toMatchObject({
    kind: "launch",
    agent: "opencode",
  });
  expect(pickerManifest(secondProject).agents).toEqual(["claude"]);
  expect(readFileSync(file, "utf8")).toBe(bytes);
  expect(installed.map((agent) => agent.ran())).toEqual([false, true, true]);
});
