import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import { pickerCli, pickerManifest, pickerWorkspace } from "./helpers/picker";
import { minimal, writeEntry } from "./helpers/registry";
import { choose, terminalScript } from "./helpers/scripted-terminal";

const workspaces: ReturnType<typeof pickerWorkspace>[] = [];
afterEach(() => {
  for (const workspace of workspaces.splice(0)) workspace.cleanup();
});

function workspace() {
  const w = pickerWorkspace();
  workspaces.push(w);
  writeEntry({
    root: w.registry,
    kind: "stack",
    dir: "another-stack",
    frontmatter: minimal("stack", "another-stack"),
  });
  writeEntry({
    root: w.registry,
    kind: "stack",
    dir: "picker-stack",
    frontmatter: minimal(
      "stack",
      "picker-stack",
      "fragments:\n  optional: [picker-extra, picker-second]",
    ),
  });
  const fragment = writeEntry({
    root: w.registry,
    kind: "fragment",
    dir: "picker-second",
    frontmatter: minimal("fragment", "picker-second"),
  });
  mkdirSync(join(fragment, "files"));
  writeFileSync(join(fragment, "files", "second.txt"), "second fragment\n");
  return w;
}

function projectFiles(project: string) {
  return readdirSync(project, { recursive: true, encoding: "utf8" })
    .filter((path) => path !== ".git" && !path.startsWith(".git/"))
    .filter((path) => path !== ".stacks/manifest.json" && !path.startsWith(".stacks/state/"))
    .sort()
    .flatMap((path) => {
      const file = join(project, path);
      const stat = lstatSync(file);
      return stat.isFile()
        ? [
            {
              path,
              hash: createHash("sha256").update(readFileSync(file)).digest("hex"),
              mode: stat.mode & 0o111,
            },
          ]
        : [];
    });
}

function stableManifest(project: string) {
  const { projectId: _id, createdAt: _at, handoff, ...manifest } = pickerManifest(project);
  return { ...manifest, handoff: handoff && { kind: handoff.kind, agent: handoff.agent } };
}

test.each(["app", "-café team's $draft"])(
  "new picks replay as the printed command for directory %j [4.4b#2] [4.4b#8]",
  async (name) => {
    const w = workspace();
    const alias = join(w.home, "alias");
    symlinkSync(w.home, alias);
    const target = join(alias, name);
    const terminal = terminalScript([
      choose("picker-stack"),
      choose("picker-extra", "picker-second"),
      "",
      target,
    ]);
    const run = await pickerCli(w, ["new", "--no-launch"], { terminal });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toBe("");
    expect(terminal.reads).toBe(4);
    const echoes = run.stdout.split("\n").filter((line) => line.startsWith("Running: "));
    expect(echoes).toHaveLength(1);
    const command = (echoes[0] ?? "").slice("Running: ".length);
    const parsed = spawnSync("/bin/sh", ["-c", `set -- ${command}; printf '%s\\000' "$@"`], {
      cwd: w.home,
      env: { draft: "unexpected-shell-expansion" },
      encoding: "utf8",
      timeout: 1000,
    });
    expect(parsed.status, parsed.stderr).toBe(0);
    expect(parsed.stderr).toBe("");
    const words = parsed.stdout.split("\0").slice(0, -1);
    expect(words.slice(0, 2)).toEqual(["stacks", "new"]);
    expect(words).toContain("picker-stack");
    expect(words).toContain(target);
    expect(words).toContain("--no-launch");
    expect(pickerManifest(target).fragments.map((entry) => entry.id)).toEqual([
      "picker-extra",
      "picker-second",
    ]);
    expect(pickerManifest(target).preset).toBe("default");
    expect(readFileSync(join(target, "extra.txt"), "utf8")).toBe("added\n");
    expect(readFileSync(join(target, "second.txt"), "utf8")).toBe("second fragment\n");
    const files = projectFiles(target);
    const manifest = stableManifest(target);
    rmSync(target, { recursive: true });
    const replayTerminal = terminalScript();
    const replay = await pickerCli(w, words.slice(1), { terminal: replayTerminal });
    expect(replay.status, replay.stderr).toBe(0);
    expect(replay.stderr).toBe("");
    expect(replay.stdout).toContain("picker-stack");
    expect(replayTerminal.reads).toBe(0);
    expect(projectFiles(target)).toEqual(files);
    expect(stableManifest(target)).toEqual(manifest);
  },
);

test.each([0, 1, 2, 3])(
  "interrupting new prompt %i writes no project or state [4.4b#5]",
  async (index) => {
    const w = workspace();
    const answers = [choose("picker-stack"), choose("picker-extra"), "", w.project];
    const terminal = terminalScript([...answers.slice(0, index), Effect.never]);
    const controller = new AbortController();
    let settled = false;
    const pending = pickerCli(w, ["new", "--no-launch"], {
      terminal,
      signal: controller.signal,
    }).finally(() => {
      settled = true;
    });
    try {
      await vi.waitFor(() => expect(settled || terminal.reads === index + 1).toBe(true));
      expect(terminal.reads).toBe(index + 1);
      expect(settled).toBe(false);
    } finally {
      controller.abort();
      await pending;
    }
    const run = await pending;
    expect(run.status).toBe(130);
    expect(run.stdout).not.toContain("Running:");
    expect(run.stderr).toBe(
      "Command interrupted.\n  Next: run the same command again when you're ready.\n",
    );
    expect(existsSync(w.project)).toBe(false);
    expect(existsSync(join(w.home, "picker-stack"))).toBe(false);
    expect(existsSync(join(w.home, "state", "stacks", "projects"))).toBe(false);
    expect(
      readFileSync(join(w.registry, "stacks", "picker-stack", "files", "README.md"), "utf8"),
    ).toBe("# Picker project\n");
  },
);

test("a picked dry run defaults the preset to the preset setting, as the real run does", async () => {
  const w = workspace();
  mkdirSync(join(w.home, "config", "stacks"), { recursive: true });
  writeFileSync(
    join(w.home, "config", "stacks", "config.json"),
    JSON.stringify({ preset: "lean" }),
  );
  const terminal = terminalScript([choose("picker-stack"), "", "", w.project]);
  const run = await pickerCli(w, ["new", "--no-launch", "--dry-run"], { terminal });
  expect(run.status, run.stderr).toBe(0);
  expect(run.stderr).toBe("");
  expect(terminal.reads).toBe(4);
  const echoes = run.stdout.split("\n").filter((line) => line.startsWith("Running: "));
  expect(echoes).toHaveLength(1);
  expect(echoes[0]).toContain("--preset lean");
  expect(existsSync(w.project)).toBe(false);
});

test("terminal QuitError during a new picker maps to interruption without writes [4.4b#5]", async () => {
  const w = workspace();
  const terminal = terminalScript();
  const run = await pickerCli(w, ["new", "--no-launch"], { terminal });
  expect(terminal.reads).toBe(1);
  expect(run.status).toBe(130);
  expect(run.stdout).not.toContain("Running:");
  expect(run.stderr).toContain("Command interrupted.");
  expect(existsSync(join(w.home, "picker-stack"))).toBe(false);
  expect(existsSync(w.project)).toBe(false);
});

test("a picked target with existing files keeps them and reports TargetNotEmpty [4.4b#9]", async () => {
  const w = workspace();
  mkdirSync(w.project);
  writeFileSync(join(w.project, "keep.txt"), "existing work\n");
  const terminal = terminalScript([choose("picker-stack"), choose("picker-extra"), "", w.project]);
  const run = await pickerCli(w, ["new", "--no-launch"], { terminal });
  expect(terminal.reads).toBe(4);
  expect(run.status).toBe(2);
  expect(run.stderr).toContain("The target directory is not empty.");
  expect(run.stdout).toContain("Running: stacks new ");
  expect(readdirSync(w.project)).toEqual(["keep.txt"]);
  expect(readFileSync(join(w.project, "keep.txt"), "utf8")).toBe("existing work\n");
});
