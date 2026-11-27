// biome-ignore-all lint/suspicious/noTemplateCurlyInString: `${{ ... }}` text is what the template tests are about.
import { type ChildProcess, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Exit, Schema } from "effect";
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderBrief } from "../src/core/brief/render";
import * as T from "../src/core/brief/text";
import { countWords } from "../src/core/brief/words";
import { missingTools } from "../src/core/compose/compose";
import { NewResult } from "../src/schemas/new";
import { quiet, runCli, tempDir, terminal } from "./helpers/cli";
import { bundledAt, composeExit } from "./helpers/compose";
import { gitShim, NOT_A_REPO, spawnGit } from "./helpers/git";
import { copyEntry, minimal, newRegistry, writeEntry } from "./helpers/registry";

const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});
/** A temporary HOME that is also the cwd `new` runs in. */
function setup() {
  const dir = tempDir();
  dirs.push(dir);
  return dir.path;
}
/** git, found on the real PATH; tests that need it skip without it. */
const gitPath = process.env.PATH ?? "";
const hasGit = spawnGit(["--version"]).status === 0;
/** The environment of a run with git on PATH, its global config read from the temporary HOME. */
const withGit = { PATH: gitPath, GIT_CONFIG_NOSYSTEM: "1" };

async function newCli(
  args: string[],
  options: {
    home?: string;
    registry?: string;
    env?: Record<string, string>;
    signal?: AbortSignal;
    /** A terminal and no agent: human output. Without it, the output is an agent's. */
    human?: boolean;
    cwd?: string;
  } = {},
) {
  const home = options.home ?? setup();
  const result = await runCli(["new", ...args], {
    home,
    env: { ...quiet, ...options.env },
    host: {
      registry: options.registry ?? newRegistry,
      cwd: options.cwd ?? home,
      ...(options.human ? terminal : {}),
    },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return { ...result, home };
}
const decode = (stdout: string) => Schema.decodeUnknownSync(NewResult)(JSON.parse(stdout));
const envelope = (stderr: string) => {
  const lines = stderr.trim().split("\n");
  return JSON.parse(lines.at(-1) ?? "") as {
    error: { tag: string; message: string; details?: Record<string, unknown> };
  };
};
/** Every path under `dir`, relative and sorted, `.git` contents left out. */
function tree(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const at = rel ? `${rel}/${name}` : name;
    out.push(at);
    if (name !== ".git" && statSync(join(dir, at)).isDirectory()) out.push(...tree(dir, at));
  }
  return out;
}
/** A shim's `init` arm that creates `.git`, as git does first, then hangs after `marker`. */
const hangingInit = (marker: string) =>
  `  init) /bin/mkdir .git; /usr/bin/touch ${JSON.stringify(marker)}; exec /bin/sleep 30 ;;`;

const expectedWritten = [
  ".claude/settings.json",
  ".githooks/pre-commit",
  ".github/workflows/ci.yml",
  ".gitignore",
  ".stacks/.gitignore",
  ".stacks/BRIEF.md",
  ".stacks/NOTES.md",
  ".stacks/manifest.json",
  ".stacks/sources.json",
  "README.md",
  "plain.txt",
];

describe("new writes a project", () => {
  test("new fixture-stack app --sandbox --json writes every kind of file, the brief and its counts [1.2a#1] [1.2a#12a]", async () => {
    const { status, stdout, stderr, home } = await newCli([
      "fixture-stack",
      "app",
      "--sandbox",
      "--json",
    ]);
    expect(stderr).toBe("");
    expect(status).toBe(0);
    expect(stdout.trim().split("\n")).toHaveLength(1);
    const result = decode(stdout);
    const app = join(home, "app");
    expect(result).toMatchObject({
      project: app,
      stack: "fixture-stack",
      fragments: ["base-req", "hooked", "own-repo", "ran-check", "tooled"],
      preset: "sandbox",
      agents: ["claude"],
      written: expectedWritten,
      brief: ".stacks/BRIEF.md",
      untrusted: [],
      warnings: [],
      git: "none",
      stateRecord: true,
      // 1.4 widened the handoff: --json never launches.
      handoff: {
        kind: "print",
        reason: "json",
        untrusted: [],
        prompt:
          "Read .stacks/BRIEF.md and carry it out. It's your full task for this project; you're done when stacks verify passes.",
      },
    });
    expect(tree(app)).toEqual([
      ".claude",
      ".claude/settings.json",
      ".githooks",
      ".githooks/pre-commit",
      ".github",
      ".github/workflows",
      ".github/workflows/ci.yml",
      ".gitignore",
      ".stacks",
      ".stacks/.gitignore",
      ".stacks/BRIEF.md",
      ".stacks/NOTES.md",
      ".stacks/manifest.json",
      ".stacks/sources.json",
      ".stacks/state",
      "README.md",
      "plain.txt",
    ]);
    const read = (rel: string) => readFileSync(join(app, rel), "utf8");
    const source = (rel: string) => readFileSync(join(newRegistry, rel), "utf8");
    // Templates rendered, suffix dropped; the token rules hold.
    const year = String(new Date().getUTCFullYear());
    expect(read("README.md")).toBe(
      [
        "# app",
        "",
        "- slug: app",
        "- env: APP_PORT",
        "- scope: ",
        "- author: ",
        `- year: ${year}`,
        "- shell: ${app}",
        "- actions: ${{ secrets.NPM_TOKEN }}",
        "- unclosed: {{ project_name",
        "- split: {{",
        "project_name }}",
        "",
      ].join("\n"),
    );
    // Copies are byte for byte, dotfiles included, `{{...}}` untouched outside a template.
    expect(read(".gitignore")).toBe(source("stacks/fixture-stack/files/.gitignore"));
    expect(read("plain.txt")).toBe(source("stacks/fixture-stack/files/plain.txt"));
    expect(read(".github/workflows/ci.yml")).toBe(
      source("stacks/fixture-stack/files/.github/workflows/ci.yml"),
    );
    expect(JSON.parse(read(".claude/settings.json"))).toEqual({
      permissions: { deny: ["Bash(rm -rf /)", "Bash(git push --force)"] },
    });
    // The hook stays executable; ordinary files don't become so.
    expect(statSync(join(app, ".githooks/pre-commit")).mode & 0o111).not.toBe(0);
    expect(statSync(join(app, "README.md")).mode & 0o111).toBe(0);
    // .stacks/: the ignore file, the notes with both headings, an empty state/.
    expect(read(".stacks/.gitignore")).toBe("/BRIEF.md\n/NOTES.md\n/state/\n/incoming/\n");
    expect(read(".stacks/NOTES.md")).toContain("## Findings");
    expect(read(".stacks/NOTES.md")).toContain("## Asked");
    expect(readdirSync(join(app, ".stacks/state"))).toEqual([]);
    // The brief is renderBrief's for the same composition, and both counts are its counts.
    const brief = read(".stacks/BRIEF.md");
    expect(countWords(brief)).toBe(result.briefWords);
    const composed = await composeExit(
      { stack: "fixture-stack", preset: "sandbox" },
      { roots: bundledAt(newRegistry) },
    );
    if (!Exit.isSuccess(composed)) throw new Error("compose failed");
    const expected = renderBrief(composed.value, {
      project: "app",
      git: { kind: "none" },
      written: result.written,
      missing: missingTools(composed.value, () => false),
      yes: true,
      invocation: "stacks",
    });
    expect(brief).toBe(expected.text);
    expect(result.fixedWords).toBe(expected.fixedWords);
    expect(result.fixedWords).toBeLessThan(result.briefWords);
  });

  test("no entry command runs: a verify step that would touch ran leaves no ran file [1.2a#10]", async () => {
    const { status, home } = await newCli(["fixture-stack", "app", "--json"], { env: withGit });
    expect(status).toBe(0);
    const app = join(home, "app");
    expect(readFileSync(join(app, ".stacks/BRIEF.md"), "utf8")).toContain("touch ran");
    for (const dir of [home, app])
      for (const name of ["ran", "ran-stack"]) expect(existsSync(join(dir, name))).toBe(false);
  });

  test("human output lists the files collapsed, the brief, missing tools with skip flags, and the next step", async () => {
    const { status, stdout, stderr, home } = await newCli(["fixture-stack", "app", "--sandbox"], {
      human: true,
    });
    expect(stderr).toBe("");
    expect(status).toBe(0);
    expect(stdout).toContain("Created app from fixture-stack (sandbox).");
    expect(stdout).toContain(`Project: ${join(home, "app")}\n`);
    expect(stdout).toMatch(/\nWrote \d+ files:\n {2}\.claude\//);
    expect(stdout).toContain("Fragments: base-req, hooked, own-repo, ran-check, tooled");
    expect(stdout).toContain("Git: git not found; no repository");
    expect(stdout).toMatch(/Brief: \.stacks\/BRIEF\.md \(\d+ words\)/);
    expect(stdout).toContain("  qs-stack-tool not found (needed by fixture-stack)\n");
    expect(stdout).toContain(
      "  qs-fragment-tool not found (needed by tooled; skip with --without tooled)\n",
    );
    // 1.4: no terminal here, so the prompt is printed with an example command.
    expect(stdout.trimEnd().split("\n").slice(-3)).toEqual([
      "Next: open app in your coding agent and give it this prompt:",
      "  Read .stacks/BRIEF.md and carry it out. It's your full task for this project; you're done when stacks verify passes.",
      `For example: cd app && claude "Read .stacks/BRIEF.md and carry it out. It's your full task for this project; you're done when stacks verify passes."`,
    ]);
  });

  test("a project outside the current directory is named once, by its absolute path", async () => {
    const home = setup();
    const elsewhere = tempDir();
    dirs.push(elsewhere);
    const app = join(elsewhere.path, "app");
    for (const human of [true, false]) {
      rmSync(app, { recursive: true, force: true });
      const { status, stdout, stderr } = await newCli(["fixture-stack", app], { home, human });
      expect(stderr).toBe("");
      expect(status).toBe(0);
      expect(stdout).toContain(`Created ${app} from fixture-stack.\n`);
      expect(stdout).toContain(`Next: open ${app} in your coding agent`);
      expect(stdout).not.toContain("Project:");
    }
  });

  test("missing tools are in the result and the brief; a stack's tool has no skip flag [1.2a#8] [1.2a#16]", async () => {
    const { status, stdout, home } = await newCli(["fixture-stack", "app", "--json"]);
    expect(status).toBe(0);
    expect(decode(stdout).missingTools).toEqual([
      { tool: "qs-stack-tool", owners: [{ kind: "stack", id: "fixture-stack" }], drop: [] },
      {
        tool: "qs-fragment-tool",
        owners: [{ kind: "fragment", id: "tooled" }],
        drop: [{ id: "tooled", flag: "without" }],
      },
    ]);
    const brief = readFileSync(join(home, "app/.stacks/BRIEF.md"), "utf8");
    expect(brief).toContain("`qs-fragment-tool`: not found.");
    expect(brief).toContain(T.ground.missing);
  });

  test("--sandbox implies --yes in the brief; neither asks [1.2a#9]", async () => {
    const brief = async (args: string[]) => {
      const { status, home } = await newCli(["fixture-stack", "app", ...args]);
      expect(status).toBe(0);
      return readFileSync(join(home, "app/.stacks/BRIEF.md"), "utf8");
    };
    for (const args of [["--sandbox"], ["--yes"]]) {
      const text = await brief(args);
      expect(text).toContain(T.decisions.yes);
      expect(text).not.toContain(T.decisions.ask);
    }
    expect(await brief([])).toContain(T.decisions.ask);
  });

  test("dir defaults to the stack id, and `.` is the current directory", async () => {
    const one = await newCli(["fixture-stack", "--json"]);
    expect(one.status).toBe(0);
    expect(decode(one.stdout).project).toBe(join(one.home, "fixture-stack"));
    const home = setup();
    const work = join(home, "my-proj");
    mkdirSync(work);
    const two = await runCli(["new", "fixture-stack", ".", "--json"], {
      home,
      env: quiet,
      host: { registry: newRegistry, cwd: work },
    });
    expect(two.status).toBe(0);
    expect(decode(two.stdout).project).toBe(work);
    expect(readFileSync(join(work, "README.md"), "utf8")).toMatch(/^# my-proj\n/);
  });

  test("a target holding only OS litter is used, the litter kept and never listed [1.2a#14]", async () => {
    const home = setup();
    const app = join(home, "app");
    mkdirSync(app);
    writeFileSync(join(app, ".DS_Store"), "x");
    writeFileSync(join(app, "Thumbs.db"), "y");
    const { status, stdout } = await newCli(["fixture-stack", "app", "--json"], { home });
    expect(status).toBe(0);
    expect(decode(stdout).written).toEqual(expectedWritten);
    expect(readFileSync(join(app, ".DS_Store"), "utf8")).toBe("x");
    expect(readFileSync(join(app, "Thumbs.db"), "utf8")).toBe("y");
  });
});

describe("new refuses before writing", () => {
  test("a target with a file in it is TargetNotEmpty, and nothing is written [1.2a#2]", async () => {
    const home = setup();
    const app = join(home, "app");
    mkdirSync(app);
    writeFileSync(join(app, "keep.txt"), "mine");
    writeFileSync(join(app, ".DS_Store"), "");
    const json = await newCli(["fixture-stack", "app", "--json"], { home });
    expect(json.status).toBe(2);
    expect(json.stdout).toBe("");
    expect(envelope(json.stderr)).toEqual({
      error: {
        tag: "TargetNotEmpty",
        message: "The target directory is not empty.",
        retryable: false,
        next: "pick a directory that doesn't exist yet or is empty.",
        details: { path: app, entries: ["keep.txt"] },
      },
    });
    expect(readdirSync(app).sort()).toEqual([".DS_Store", "keep.txt"]);
    const human = await newCli(["fixture-stack", "app"], { home, human: true });
    expect(human.status).toBe(2);
    expect(human.stdout).toBe("");
    expect(human.stderr).toBe(
      `The target directory is not empty.\n  Path: ${app}\n  Contains: keep.txt\n  Next: pick a directory that doesn't exist yet or is empty.\n`,
    );
  });

  test("a second new into the same directory is TargetNotEmpty", async () => {
    const home = setup();
    expect((await newCli(["fixture-stack", "app"], { home })).status).toBe(0);
    const again = await newCli(["fixture-stack", "app", "--json"], { home });
    expect(again.status).toBe(2);
    expect(envelope(again.stderr).error.tag).toBe("TargetNotEmpty");
  });

  test("an unknown {{name}} in a template is EntryInvalid template, and the target never appears [1.2a#5]", async () => {
    const home = setup();
    const registry = join(home, "registry");
    const stack = writeEntry({
      root: registry,
      kind: "stack",
      dir: "tmpl-stack",
      frontmatter: minimal("stack", "tmpl-stack"),
    });
    mkdirSync(join(stack, "files"));
    writeFileSync(join(stack, "files", "a.txt"), "first\n");
    writeFileSync(join(stack, "files", "z.yml.tmpl"), "name: {{project_name}}\nx: ${{ github }}\n");
    const { status, stdout, stderr } = await newCli(["tmpl-stack", "app", "--json"], {
      home,
      registry,
    });
    expect(status).toBe(2);
    expect(stdout).toBe("");
    expect(envelope(stderr).error).toMatchObject({
      tag: "EntryInvalid",
      details: {
        id: "tmpl-stack",
        origin: "bundled",
        reason: "template",
        path: "files/z.yml.tmpl",
        line: 2,
      },
    });
    expect(existsSync(join(home, "app"))).toBe(false);
  });

  test("--scope must be an npm scope: BadInput, nothing written [1.2a#12a]", async () => {
    const { status, stdout, stderr, home } = await newCli([
      "fixture-stack",
      "app",
      "--scope",
      "Acme/x",
      "--json",
    ]);
    expect(status).toBe(2);
    expect(stdout).toBe("");
    expect(envelope(stderr).error).toMatchObject({
      tag: "BadInput",
      details: { id: "Acme/x", flag: "scope" },
    });
    expect(existsSync(join(home, "app"))).toBe(false);
  });

  test("an invalid package_scope setting is InvalidConfig, nothing written", async () => {
    const home = setup();
    mkdirSync(join(home, "config", "stacks"), { recursive: true });
    writeFileSync(
      join(home, "config", "stacks", "config.json"),
      JSON.stringify({ package_scope: "Acme" }),
    );
    const { status, stderr } = await newCli(["fixture-stack", "app", "--json"], { home });
    expect(status).toBe(3);
    expect(envelope(stderr).error.tag).toBe("InvalidConfig");
    expect(existsSync(join(home, "app"))).toBe(false);
  });

  test("--agents nope is Usage; the same id in --with and --without is BadInput; neither writes [1.2a#18]", async () => {
    const home = setup();
    const agents = await newCli(["fixture-stack", "app", "--agents", "claude,nope", "--json"], {
      home,
    });
    expect(agents.status).toBe(2);
    expect(agents.stdout).toBe("");
    expect(envelope(agents.stderr).error.tag).toBe("Usage");
    const both = await newCli(["fixture-stack", "app", "--with", "extra", "--without", "extra"], {
      home,
    });
    expect(both.status).toBe(2);
    expect(both.stdout).toBe("");
    expect(both.stderr).toBe(
      "Invalid input.\n  Id: extra\n  Flags: --with and --without\n  Next: name extra in only one of --with and --without.\n",
    );
    expect(existsSync(join(home, "app"))).toBe(false);
  });

  test("an unknown stack is NotFound with suggestions [1.1#19]", async () => {
    const { status, stdout, stderr } = await newCli(["fixture-stak", "--json"]);
    expect(status).toBe(2);
    expect(stdout).toBe("");
    expect(envelope(stderr).error).toMatchObject({
      tag: "NotFound",
      details: { suggestions: ["fixture-stack"], id: "fixture-stak", kind: "stack" },
    });
    const far = await newCli(["nope"]);
    expect(far.status).toBe(2);
    expect(far.stdout).toBe("");
    expect(far.stderr).toBe(
      "Not found.\n  Stack: nope\n  Next: run stacks list to see every stack and fragment id.\n",
    );
  });

  test("an unknown --with or --without id is NotFound naming the fragment, not the stack", async () => {
    for (const flag of ["--with", "--without"]) {
      const json = await newCli(["fixture-stack", "app", flag, "bogus", "--json"]);
      expect(json.status).toBe(2);
      expect(json.stdout).toBe("");
      expect(json.stderr.trim().split("\n")).toHaveLength(1);
      expect(envelope(json.stderr).error).toEqual({
        tag: "NotFound",
        message: "Not found.",
        retryable: false,
        next: "run stacks list to see every stack and fragment id.",
        details: { suggestions: [], id: "bogus", kind: "fragment" },
      });
      expect(existsSync(join(json.home, "app"))).toBe(false);
      const human = await newCli(["fixture-stack", "app", flag, "bogus"], { human: true });
      expect(human.status).toBe(2);
      expect(human.stdout).toBe("");
      expect(human.stderr).toBe(
        "Not found.\n  Fragment: bogus\n  Next: run stacks list to see every stack and fragment id.\n",
      );
    }
  });

  test("an entry file under .stacks/ or .git/, in any case and at any depth, is reserved_path: the CLI owns them", async () => {
    for (const reserved of [
      ".stacks/BRIEF.md",
      ".git/hooks/pre-commit",
      ".GIT/config",
      ".Stacks/BRIEF.md",
      "vendor/.Git/HEAD",
      "git~1/config",
      ".git. /config",
    ]) {
      const home = setup();
      const registry = join(home, "registry");
      const stack = writeEntry({
        root: registry,
        kind: "stack",
        dir: "sneaky",
        frontmatter: minimal("stack", "sneaky"),
      });
      mkdirSync(join(stack, "files", reserved, ".."), { recursive: true });
      writeFileSync(join(stack, "files", reserved), "planted");
      const { status, stdout, stderr } = await newCli(["sneaky", "app", "--json"], {
        home,
        registry,
      });
      expect(status).toBe(2);
      expect(stdout).toBe("");
      expect(envelope(stderr).error).toMatchObject({
        tag: "ComposeConflict",
        details: { reason: "reserved_path", stack: "sneaky", ids: [], path: reserved },
      });
      expect(existsSync(join(home, "app"))).toBe(false);
    }
  });

  test("a reserved path in human mode says the CLI owns .git/ and .stacks/", async () => {
    const home = setup();
    const registry = join(home, "registry");
    const stack = writeEntry({
      root: registry,
      kind: "stack",
      dir: "sneaky",
      frontmatter: minimal("stack", "sneaky"),
    });
    mkdirSync(join(stack, "files", ".GIT"), { recursive: true });
    writeFileSync(join(stack, "files", ".GIT", "config"), "planted");
    const { status, stdout, stderr } = await newCli(["sneaky", "app"], {
      home,
      registry,
      human: true,
    });
    expect(status).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toBe(
      [
        "These entries can't be composed.",
        "  Reason: reserved_path",
        "  Stack: sneaky",
        "  Path: .GIT/config",
        "  The CLI owns .git/ and .stacks/ in a project; no entry may write under them, in any letter case.",
        "  Next: remove or rename that file in the entry.",
        "",
      ].join("\n"),
    );
  });

  test("planned files that differ only in case, or a file that is also a directory, are file_owner before writing", async () => {
    for (const [stackFile, fragmentFile, path] of [
      ["README.md", "readme.md", "readme.md"],
      ["docs", "docs/x.md", "docs/x.md"],
      ["Docs", "docs/x.md", "docs/x.md"],
    ] as const) {
      const home = setup();
      const registry = join(home, "registry");
      const stack = writeEntry({
        root: registry,
        kind: "stack",
        dir: "clash",
        frontmatter: minimal("stack", "clash", "fragments:\n  default: [other]"),
      });
      const fragment = writeEntry({
        root: registry,
        kind: "fragment",
        dir: "other",
        frontmatter: minimal("fragment", "other"),
      });
      mkdirSync(join(stack, "files"), { recursive: true });
      writeFileSync(join(stack, "files", stackFile), "stack");
      mkdirSync(join(fragment, "files", fragmentFile, ".."), { recursive: true });
      writeFileSync(join(fragment, "files", fragmentFile), "fragment");
      const { status, stdout, stderr } = await newCli(["clash", "app", "--json"], {
        home,
        registry,
      });
      expect(status).toBe(2);
      expect(stdout).toBe("");
      expect(envelope(stderr).error).toMatchObject({
        tag: "ComposeConflict",
        details: { reason: "file_owner", stack: "clash", ids: ["other"], path },
      });
      expect(existsSync(join(home, "app"))).toBe(false);
    }
  });
});

describe("new and the filesystem", () => {
  test("a write through a symlink out of the target is PermissionDenied escape; outside stays empty [1.2a#4]", async () => {
    const home = setup();
    const outside = join(home, "outside");
    mkdirSync(outside);
    const app = join(home, "app");
    mkdirSync(app);
    // A litter name is ignored by the emptiness check, so a link there is the target's only entry.
    symlinkSync(outside, join(app, ".DS_Store"));
    const registry = join(home, "registry");
    const stack = writeEntry({
      root: registry,
      kind: "stack",
      dir: "linker",
      frontmatter: minimal("stack", "linker"),
    });
    mkdirSync(join(stack, "files", ".DS_Store"), { recursive: true });
    writeFileSync(join(stack, "files", ".DS_Store", "evil.txt"), "x");
    const { status, stdout, stderr } = await newCli(["linker", "app", "--json"], {
      home,
      registry,
    });
    expect(status).toBe(6);
    expect(stdout).toBe("");
    expect(envelope(stderr).error).toMatchObject({
      tag: "PermissionDenied",
      details: { reason: "escape", path: join(realpathSync(app), ".DS_Store/evil.txt") },
    });
    expect(readdirSync(outside)).toEqual([]);
    expect(readdirSync(app)).toEqual([".DS_Store"]);
  });

  test("a target reached through a symlinked parent writes normally [1.2a#4]", async () => {
    const home = setup();
    mkdirSync(join(home, "real"));
    symlinkSync(join(home, "real"), join(home, "link"));
    const { status, stdout } = await newCli(["fixture-stack", "link/app", "--json"], { home });
    expect(status).toBe(0);
    expect(decode(stdout).project).toBe(join(home, "link", "app"));
    expect(existsSync(join(home, "real", "app", "README.md"))).toBe(true);
  });

  test.skipIf(process.getuid?.() === 0)(
    "a write failing after the first leaves the target exactly as it was [1.2a#6]",
    async () => {
      const home = setup();
      const registry = join(home, "registry");
      copyEntry(newRegistry, registry, "stacks", "fixture-stack");
      for (const id of ["base-req", "hooked", "tooled", "ran-check", "own-repo"])
        copyEntry(newRegistry, registry, "fragments", id);
      // desktop.ini sorts after the dotfiles and README.md, so earlier files are already written.
      const stackFiles = join(registry, "stacks", "fixture-stack", "files");
      mkdirSync(join(stackFiles, "desktop.ini"));
      writeFileSync(join(stackFiles, "desktop.ini", "late.txt"), "late");
      const app = join(home, "app");
      mkdirSync(join(app, "desktop.ini"), { recursive: true });
      chmodSync(join(app, "desktop.ini"), 0o555);
      try {
        const { status, stdout, stderr } = await newCli(["fixture-stack", "app", "--json"], {
          home,
          registry,
        });
        expect(status).toBe(6);
        expect(stdout).toBe("");
        expect(envelope(stderr).error).toMatchObject({
          tag: "PermissionDenied",
          details: {
            reason: "unwritable",
            path: join(realpathSync(app), "desktop.ini", "late.txt"),
          },
        });
        expect(tree(app)).toEqual(["desktop.ini"]);
      } finally {
        chmodSync(join(app, "desktop.ini"), 0o755);
      }
    },
  );

  test.skipIf(process.getuid?.() === 0)(
    "an unwritable parent is PermissionDenied unwritable and leaves nothing",
    async () => {
      const home = setup();
      mkdirSync(join(home, "locked"));
      chmodSync(join(home, "locked"), 0o555);
      try {
        const { status, stderr } = await newCli(["fixture-stack", "locked/app", "--json"], {
          home,
        });
        expect(status).toBe(6);
        expect(envelope(stderr).error).toMatchObject({
          tag: "PermissionDenied",
          details: { reason: "unwritable", path: join(home, "locked", "app") },
        });
        expect(readdirSync(join(home, "locked"))).toEqual([]);
      } finally {
        chmodSync(join(home, "locked"), 0o755);
      }
    },
  );
});

describe("template variables", () => {
  test.each(['a"b', "a\\b"])(
    "an unsafe directory-derived name is refused before rendering: %s",
    async (name) => {
      const home = setup();
      const result = await newCli(["fixture-stack", name, "--json"], { home });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(result.stderr)).toEqual({
        error: {
          tag: "BadInput",
          message: "Invalid input.",
          retryable: false,
          next: "pass --name with a project name that has no control characters, double quotes or backslashes.",
          details: { id: name, flag: "name" },
        },
      });
      expect(existsSync(join(home, name))).toBe(false);
    },
  );

  test.each(['a"b', "a\\b"])(
    "a name containing a quote or backslash is refused before rendering: %s",
    async (name) => {
      const home = setup();
      const registry = join(home, "registry");
      const entry = writeEntry({
        root: registry,
        kind: "stack",
        dir: "json-name",
        frontmatter: minimal("stack", "json-name"),
      });
      mkdirSync(join(entry, "files"));
      writeFileSync(join(entry, "files/package.json.tmpl"), '{"name":"{{project_name}}"}');
      const result = await newCli(["json-name", "app", "--name", name, "--json"], {
        home,
        registry,
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(result.stderr)).toEqual({
        error: {
          tag: "BadInput",
          message: "Invalid input.",
          retryable: false,
          next: "pass --name with a project name that has no control characters, double quotes or backslashes.",
          details: { id: name, flag: "name" },
        },
      });
      expect(existsSync(join(home, "app"))).toBe(false);
    },
  );

  const readme = async (args: string[], options: Parameters<typeof newCli>[1] = {}) => {
    const run = await newCli(["fixture-stack", "app", ...args], options);
    expect(run.status).toBe(0);
    return readFileSync(join(run.home, "app/README.md"), "utf8");
  };
  const configured = (settings: object) => {
    const home = setup();
    mkdirSync(join(home, "config", "stacks"), { recursive: true });
    writeFileSync(join(home, "config", "stacks", "config.json"), JSON.stringify(settings));
    return home;
  };

  test("package_scope: the flag (with or without @), else the setting, else empty [1.2a#12a]", async () => {
    expect(await readme(["--scope", "@acme"])).toContain("- scope: acme\n");
    expect(await readme(["--scope", "acme"])).toContain("- scope: acme\n");
    expect(await readme([], { home: configured({ package_scope: "acme" }) })).toContain(
      "- scope: acme\n",
    );
    expect(
      await readme(["--scope", "flag"], { home: configured({ package_scope: "acme" }) }),
    ).toContain("- scope: flag\n");
    expect(await readme([])).toContain("- scope: \n");
  });

  test.skipIf(!hasGit)(
    "author: the setting beats git config user.name; with neither, empty [1.2a#12]",
    async () => {
      const gitHome = () => {
        const home = setup();
        writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = Git Name\n");
        return home;
      };
      expect(await readme([], { home: gitHome(), env: withGit })).toContain("- author: Git Name\n");
      const both = gitHome();
      mkdirSync(join(both, "config", "stacks"), { recursive: true });
      writeFileSync(
        join(both, "config", "stacks", "config.json"),
        JSON.stringify({ author: "Set Author" }),
      );
      expect(await readme([], { home: both, env: withGit })).toContain("- author: Set Author\n");
      expect(await readme([], { env: withGit })).toContain("- author: \n");
    },
  );

  test("author loses quotes, backslashes and line breaks; any other control character in the setting is InvalidConfig", async () => {
    expect(
      await readme([], { home: configured({ author: 'Ada "The" \\Count\r\nLovelace' }) }),
    ).toContain("- author: Ada The CountLovelace\n");
    const home = configured({ author: "Ada\tLovelace" });
    const { status, stdout, stderr } = await newCli(["fixture-stack", "app", "--json"], { home });
    expect(status).toBe(3);
    expect(stdout).toBe("");
    expect(envelope(stderr).error.tag).toBe("InvalidConfig");
    expect(existsSync(join(home, "app"))).toBe(false);
  });

  test.skipIf(!hasGit)(
    "a git user.name with a control character is not used as the author",
    async () => {
      const home = setup();
      writeFileSync(join(home, ".gitconfig"), '[user]\n\tname = "Git\\tName"\n');
      expect(await readme([], { home, env: withGit })).toContain("- author: \n");
    },
  );

  test("a project directory whose name has a control character is BadInput dir, nothing written", async () => {
    const home = setup();
    const name = "bad\u0007name";
    const { status, stdout, stderr } = await newCli(["fixture-stack", name, "--json"], { home });
    expect(status).toBe(2);
    expect(stdout).toBe("");
    expect(envelope(stderr).error).toMatchObject({
      tag: "BadInput",
      details: { id: name, flag: "dir" },
    });
    expect(readdirSync(home).filter((entry) => entry.startsWith("bad"))).toEqual([]);
  });

  test("a .gitignore shipped as .gitignore.tmpl with no tokens is written as .gitignore, unchanged", async () => {
    const home = setup();
    const registry = join(home, "registry");
    const stack = writeEntry({
      root: registry,
      kind: "stack",
      dir: "ignores",
      frontmatter: minimal("stack", "ignores"),
    });
    mkdirSync(join(stack, "files"));
    // Braces that aren't a token, a negation and a trailing-space escape stay as written.
    const rules = "node_modules/\n.env.*\n!.env.example\n# {not a token}\nkeep\\ \n";
    writeFileSync(join(stack, "files", ".gitignore.tmpl"), rules);
    const { status, stdout, stderr } = await newCli(["ignores", "app", "--json"], {
      home,
      registry,
    });
    expect(status).toBe(0);
    expect(stderr).toBe("");
    expect(decode(stdout).written).toContain(".gitignore");
    expect(readFileSync(join(home, "app", ".gitignore"), "utf8")).toBe(rules);
    expect(existsSync(join(home, "app", ".gitignore.tmpl"))).toBe(false);
  });

  test("project_name is the directory's base name; slug and env prefix follow it [1.2a#12]", async () => {
    const run = await newCli(["fixture-stack", "nested/My App", "--json"]);
    expect(run.status).toBe(0);
    const text = readFileSync(join(run.home, "nested/My App/README.md"), "utf8");
    expect(text).toContain("# My App\n");
    expect(text).toContain("- slug: my-app\n");
    expect(text).toContain("- env: MY_APP_PORT\n");
  });
});

describe.skipIf(!hasGit)("new and git", () => {
  test("a fresh target becomes a git repository with nothing committed", async () => {
    const { status, stdout, home } = await newCli(["fixture-stack", "app", "--json"], {
      env: withGit,
    });
    expect(status).toBe(0);
    expect(decode(stdout).git).toBe("fresh");
    const app = join(home, "app");
    expect(statSync(join(app, ".git")).isDirectory()).toBe(true);
    expect(spawnGit(["rev-parse", "--verify", "HEAD"], { cwd: app }).status).not.toBe(0);
  });

  test("inside a parent repository nothing is initialized, and a default needs_own_repo fragment is refused with its fix [1.2a#3] [1.2a#15]", async () => {
    const home = setup();
    const repo = join(home, "repo");
    mkdirSync(repo);
    expect(spawnGit(["init", "--quiet"], { cwd: repo }).status).toBe(0);
    const refused = await newCli(["fixture-stack", "repo/app", "--json"], { home, env: withGit });
    expect(refused.status).toBe(2);
    expect(refused.stdout).toBe("");
    expect(envelope(refused.stderr).error).toMatchObject({
      tag: "ComposeConflict",
      details: {
        reason: "needs_own_repo",
        ids: ["own-repo"],
        path: realpathSync(repo),
        fix: ["--without own-repo"],
      },
    });
    expect(existsSync(join(repo, "app"))).toBe(false);
    const human = await newCli(["fixture-stack", "repo/app"], {
      home,
      env: withGit,
      human: true,
    });
    expect(human.stderr).toContain(
      "  Next: run again with --own-repo to give the project its own git repository inside that one, or with --without own-repo to leave those fragments out, or pick a directory outside that repository.\n",
    );

    const ok = await newCli(["fixture-stack", "repo/app", "--without", "own-repo", "--json"], {
      home,
      env: withGit,
    });
    expect(ok.status).toBe(0);
    expect(decode(ok.stdout).git).toBe("parent");
    expect(existsSync(join(repo, "app", ".git"))).toBe(false);
    expect(readFileSync(join(repo, "app/.stacks/BRIEF.md"), "utf8")).toContain(
      "inside the git repository at",
    );
  });

  test("a required needs_own_repo fragment in a parent repository has no fix [1.2a#15]", async () => {
    const home = setup();
    expect(spawnGit(["init", "--quiet"], { cwd: home }).status).toBe(0);
    const { status, stderr } = await newCli(["own-stack", "app", "--json"], {
      home,
      env: withGit,
    });
    expect(status).toBe(2);
    expect(envelope(stderr).error.details).toMatchObject({ reason: "needs_own_repo", fix: [] });
    expect(existsSync(join(home, "app"))).toBe(false);
  });

  test("a target holding only its own fresh .git is used and not re-initialized", async () => {
    const home = setup();
    const app = join(home, "app");
    mkdirSync(app);
    expect(spawnGit(["init", "--quiet"], { cwd: app }).status).toBe(0);
    const head = readFileSync(join(app, ".git", "HEAD"), "utf8");
    const { status, stdout } = await newCli(["fixture-stack", "app", "--json"], {
      home,
      env: withGit,
    });
    expect(status).toBe(0);
    const result = decode(stdout);
    expect(result.git).toBe("fresh");
    expect(result.written).toEqual(expectedWritten);
    expect(readFileSync(join(app, ".git", "HEAD"), "utf8")).toBe(head);
  });

  test("a target that is its own repository with commits takes a needs_own_repo fragment, and the brief still says not to commit without asking", async () => {
    const home = setup();
    const app = join(home, "app");
    mkdirSync(app);
    expect(spawnGit(["init", "--quiet"], { cwd: app }).status).toBe(0);
    const commit = ["-c", "user.name=T", "-c", "user.email=t@example.com", "commit"];
    expect(
      spawnGit([...commit, "--quiet", "--allow-empty", "-m", "init"], { cwd: app }).status,
    ).toBe(0);
    const head = spawnGit(["rev-parse", "HEAD"], { cwd: app }).stdout.toString();
    const { status, stdout, stderr } = await newCli(["fixture-stack", "app", "--json"], {
      home,
      env: withGit,
    });
    expect(stderr).toBe("");
    expect(status).toBe(0);
    const result = decode(stdout);
    expect(result.git).toBe("parent");
    expect(result.fragments).toContain("own-repo");
    expect(readFileSync(join(app, ".stacks/BRIEF.md"), "utf8")).toContain(
      "don't commit without asking the user",
    );
    expect(spawnGit(["rev-parse", "HEAD"], { cwd: app }).stdout.toString()).toBe(head);
  });

  test("a GIT_DIR in the environment, as a git hook exports it, neither selects nor changes a repository", async () => {
    const home = setup();
    const elsewhere = join(home, "elsewhere");
    mkdirSync(elsewhere);
    expect(spawnGit(["init", "--quiet"], { cwd: elsewhere }).status).toBe(0);
    const config = readFileSync(join(elsewhere, ".git", "config"), "utf8");
    const { status, stdout, stderr } = await newCli(["fixture-stack", "app", "--json"], {
      home,
      env: { ...withGit, GIT_DIR: join(elsewhere, ".git"), GIT_WORK_TREE: elsewhere },
    });
    expect(stderr).toBe("");
    expect(status).toBe(0);
    expect(decode(stdout).git).toBe("fresh");
    expect(statSync(join(home, "app", ".git")).isDirectory()).toBe(true);
    expect(readFileSync(join(elsewhere, ".git", "config"), "utf8")).toBe(config);
  });
});

describe("git init failing or interrupted", () => {
  test("git init exiting 1 keeps every file, with git none and a git_init_failed warning [1.2a#17]", async () => {
    const home = setup();
    const bin = gitShim(home, `${NOT_A_REPO}\n  init) exit 1 ;;`);
    const { status, stdout, stderr } = await newCli(["fixture-stack", "app", "--json"], {
      home,
      env: { PATH: bin },
    });
    expect(stderr).toBe("");
    expect(status).toBe(0);
    const result = decode(stdout);
    expect(result.git).toBe("none");
    expect(result.warnings).toEqual([{ code: "git_init_failed", id: "git", exitCode: 1 }]);
    const app = join(home, "app");
    for (const rel of result.written) expect(existsSync(join(app, rel))).toBe(true);
    const brief = readFileSync(join(app, ".stacks/BRIEF.md"), "utf8");
    expect(brief).toContain(T.ground.git({ kind: "none" }));
    expect(countWords(brief)).toBe(result.briefWords);
    const human = await newCli(["fixture-stack", "app2"], {
      home,
      env: { PATH: bin },
      human: true,
    });
    expect(human.stdout).toContain("Git: git init failed (exit 1); no repository\n");
    expect(human.stdout).not.toContain("Warnings:");
    expect(human.stdout).not.toContain("git init failed;");
  });

  test("git init failing after it made a partial .git removes that .git", async () => {
    const home = setup();
    const bin = gitShim(home, `${NOT_A_REPO}\n  init) /bin/mkdir .git; exit 1 ;;`);
    const { status, stdout, stderr } = await newCli(["fixture-stack", "app", "--json"], {
      home,
      env: { PATH: bin },
    });
    expect(stderr).toBe("");
    expect(status).toBe(0);
    const result = decode(stdout);
    expect(result.git).toBe("none");
    expect(result.warnings).toEqual([{ code: "git_init_failed", id: "git", exitCode: 1 }]);
    const app = join(home, "app");
    expect(existsSync(join(app, ".git"))).toBe(false);
    for (const rel of result.written) expect(existsSync(join(app, rel))).toBe(true);
  });

  test("an interrupt while git init runs exits 130 and leaves no files, the new .git included [1.2a#7]", async () => {
    const home = setup();
    const marker = join(home, "init-started");
    const bin = gitShim(home, `${NOT_A_REPO}\n${hangingInit(marker)}`);
    const controller = new AbortController();
    const running = newCli(["fixture-stack", "app", "--json"], {
      home,
      env: { PATH: bin },
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 5000 });
    expect(existsSync(join(home, "app", "README.md"))).toBe(true);
    expect(statSync(join(home, "app", ".git")).isDirectory()).toBe(true);
    controller.abort();
    const { status, stdout } = await running;
    expect(status).toBe(130);
    expect(stdout).toBe("");
    expect(existsSync(join(home, "app"))).toBe(false);
  }, 15000);

  test("a broken .git already in the target is never initialized over, and survives an interrupt", async () => {
    const home = setup();
    const app = join(home, "app");
    mkdirSync(join(app, ".git"), { recursive: true });
    writeFileSync(join(app, ".git", "keep"), "the user's");
    const marker = join(home, "init-started");
    const bin = gitShim(home, `${NOT_A_REPO}\n${hangingInit(marker)}`);
    const controller = new AbortController();
    let settled = false;
    const running = newCli(["fixture-stack", "app", "--json"], {
      home,
      env: { PATH: bin },
      signal: controller.signal,
    }).finally(() => {
      settled = true;
    });
    // Before the fix, init ran over this .git and the interrupt's rollback deleted it.
    await vi.waitFor(() => expect(settled || existsSync(marker)).toBe(true), { timeout: 5000 });
    if (existsSync(marker)) controller.abort();
    const { status, stdout, stderr } = await running;
    expect(readFileSync(join(app, ".git", "keep"), "utf8")).toBe("the user's");
    expect(existsSync(marker)).toBe(false);
    expect(stderr).toBe("");
    expect(status).toBe(0);
    const result = decode(stdout);
    expect(result.git).toBe("none");
    expect(result.warnings).toEqual([{ code: "git_unusable", id: "git", exitCode: 128 }]);
    expect(readFileSync(join(app, ".stacks/BRIEF.md"), "utf8")).toContain(
      T.ground.git({ kind: "none" }),
    );
  }, 15000);

  test("a rev-parse failure other than 'not a git repository' is git none with a warning, and nothing is initialized", async () => {
    const home = setup();
    const marker = join(home, "init-started");
    const bin = gitShim(
      home,
      `  rev-parse) echo "fatal: detected dubious ownership in repository at '/x'" >&2; exit 128 ;;\n  init) /usr/bin/touch ${JSON.stringify(marker)}; exit 0 ;;`,
    );
    const { status, stdout, stderr } = await newCli(["fixture-stack", "app", "--json"], {
      home,
      env: { PATH: bin },
    });
    expect(stderr).toBe("");
    expect(status).toBe(0);
    const result = decode(stdout);
    expect(result.git).toBe("none");
    expect(result.warnings).toEqual([{ code: "git_unusable", id: "git", exitCode: 128 }]);
    expect(existsSync(marker)).toBe(false);
    const human = await newCli(["fixture-stack", "app2"], {
      home,
      env: { PATH: bin },
      human: true,
    });
    expect(human.status).toBe(0);
    expect(human.stdout).toContain(
      "Git: git couldn't tell whether this is inside a repository (exit 128); none used. Run git status in the project to see git's error\n",
    );
    expect(human.stdout).not.toContain("Warnings:");
  });
});

describe("a real CLI process", () => {
  const bin = join(import.meta.dirname, "..", "src", "bin.ts");
  let child: ChildProcess | undefined;
  afterEach(() => {
    if (child?.pid)
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    child = undefined;
  });

  test("SIGINT while git init runs exits 130 and leaves no files, .git and state record included [1.2a#7]", async () => {
    const home = setup();
    const marker = join(home, "init-started");
    const shim = gitShim(home, `${NOT_A_REPO}\n${hangingInit(marker)}`);
    child = spawn("bun", ["--no-env-file", bin, "new", "fixture-stack", "app", "--json"], {
      cwd: home,
      detached: true,
      stdio: "ignore",
      env: {
        PATH: `${shim}:${process.env.PATH ?? ""}`,
        HOME: home,
        LOG_LEVEL: "none",
        STACKS_REGISTRY_DIR: newRegistry,
      },
    });
    const closed = new Promise<number | null>((resolve, reject) => {
      child?.on("error", reject);
      child?.on("close", resolve);
    });
    await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 10000 });
    expect(existsSync(join(home, "app", ".stacks", "BRIEF.md"))).toBe(true);
    expect(statSync(join(home, "app", ".git")).isDirectory()).toBe(true);
    const records = join(home, ".local", "state", "stacks", "projects");
    expect(readdirSync(records)).toHaveLength(1);
    process.kill(-(child.pid as number), "SIGINT");
    expect(await closed).toBe(130);
    expect(existsSync(join(home, "app"))).toBe(false);
    expect(readdirSync(records)).toEqual([]);
  }, 20000);
});
