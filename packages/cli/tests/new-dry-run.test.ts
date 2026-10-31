import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Manifest } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import { NewResult } from "../src/schemas/new";
import { fakeAgent } from "./helpers/agents";
import { quiet, runCli, tempDir } from "./helpers/cli";
import { gitShim, NOT_A_REPO, spawnGit } from "./helpers/git";
import { copyEntry, newRegistry } from "./helpers/registry";

const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});
function temp() {
  const dir = tempDir();
  dirs.push(dir);
  return dir.path;
}

const terminal = { stdinIsTTY: true, stdoutIsTTY: true };
const withGit = {
  PATH: process.env.PATH ?? "",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};
const expectedFiles = [
  ".claude/settings.json",
  ".githooks/pre-commit",
  ".github/workflows/ci.yml",
  ".gitignore",
  ".stacks/.gitignore",
  ".stacks/BRIEF.md",
  ".stacks/NOTES.md",
  ".stacks/manifest.json",
  "README.md",
  "plain.txt",
];

function invoke(
  home: string,
  args: string[],
  options: {
    cwd?: string;
    registry?: string;
    env?: Record<string, string>;
    terminal?: boolean;
  } = {},
) {
  return runCli(["new", "fixture-stack", ...args], {
    home,
    env: {
      ...quiet,
      PATH: join(home, "bin"),
      XDG_STATE_HOME: join(home, "state"),
      XDG_DATA_HOME: join(home, "data"),
      ...options.env,
    },
    host: {
      registry: options.registry ?? newRegistry,
      cwd: options.cwd ?? home,
      ...(options.terminal ? terminal : {}),
    },
  });
}

type Run = Awaited<ReturnType<typeof invoke>>;
function success(run: Run) {
  expect(run.status, run.stderr).toBe(0);
  expect(run.stderr).toBe("");
  expect(run.stdout.trim().split("\n")).toHaveLength(1);
  return Schema.decodeUnknownSync(NewResult)(JSON.parse(run.stdout));
}
function failure(run: Run, tag: string, details?: Record<string, unknown>) {
  expect(run.status).toBe(2);
  expect(run.stdout).toBe("");
  const lines = run.stderr.trim().split("\n");
  expect(lines).toHaveLength(1);
  const envelope: unknown = JSON.parse(lines[0] ?? "");
  expect(envelope).toMatchObject({
    error: { tag, retryable: false, ...(details ? { details } : {}) },
  });
}

/** Bytes, modes and symlink destinations, including all project and user state. */
function snapshot(root: string, relative = ""): unknown[] {
  return readdirSync(join(root, relative))
    .sort()
    .flatMap((name): unknown[] => {
      const path = relative ? `${relative}/${name}` : name;
      const absolute = join(root, path);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) return [{ path, link: readlinkSync(absolute), mode: stat.mode }];
      if (stat.isDirectory()) return [{ path, mode: stat.mode }, ...snapshot(root, path)];
      return [{ path, mode: stat.mode, bytes: readFileSync(absolute).toString("hex") }];
    });
}

function git(home: string, cwd: string, args: string[]) {
  const result = spawnGit(args, { cwd, env: { HOME: home, ...withGit } });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  return result.stdout.toString().trim();
}
function settings(home: string, author: string) {
  const dir = join(home, "config", "stacks");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ author }));
}

describe("new --dry-run", () => {
  test("plans every output file and fingerprint without creating directories or state [3.1c#1]", async () => {
    const home = temp();
    const before = snapshot(home);
    const planned = success(await invoke(home, ["app", "--dry-run", "--json"]));
    expect(planned).toMatchObject({
      project: join(home, "app"),
      stack: "fixture-stack",
      fragments: ["base-req", "hooked", "own-repo", "ran-check", "tooled"],
      agents: ["claude"],
      preset: "default",
      dryRun: true,
      stateRecord: false,
      git: "none",
      written: expectedFiles,
      brief: ".stacks/BRIEF.md",
      missingTools: [
        { tool: "qs-stack-tool", owners: [{ kind: "stack", id: "fixture-stack" }], drop: [] },
        {
          tool: "qs-fragment-tool",
          owners: [{ kind: "fragment", id: "tooled" }],
          drop: [{ id: "tooled", flag: "without" }],
        },
      ],
      handoff: { kind: "print", reason: "no-launch", untrusted: [] },
    });
    expect(planned.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(planned.briefWords).toBeGreaterThan(planned.fixedWords);
    expect(planned.fixedWords).toBeGreaterThan(0);
    expect(existsSync(join(home, "app"))).toBe(false);
    expect(snapshot(home)).toEqual(before);

    const actual = success(await invoke(home, ["app", "--json"]));
    expect(actual).toMatchObject({ dryRun: false, stateRecord: true });
    for (const field of [
      "written",
      "fingerprint",
      "briefWords",
      "fixedWords",
      "git",
      "missingTools",
    ] as const)
      expect(actual[field]).toEqual(planned[field]);
    for (const file of planned.written)
      expect(lstatSync(join(home, "app", file)).isFile()).toBe(true);
    const manifest = Schema.decodeUnknownSync(Manifest)(
      JSON.parse(readFileSync(join(home, "app", ".stacks/manifest.json"), "utf8")),
    );
    expect(manifest.fingerprint).toBe(planned.fingerprint);
  });

  test("reports fresh git without running an init that would fail [3.1c#1]", async () => {
    const home = temp();
    const bin = gitShim(home, `${NOT_A_REPO}\n  init) echo ran > "$HOME/init-ran"; exit 1 ;;`);
    settings(home, "Configured Author");
    const before = snapshot(home);
    const result = success(
      await invoke(home, ["nested/app", "--dry-run", "--json"], {
        env: { PATH: bin },
      }),
    );
    expect(result).toMatchObject({ dryRun: true, git: "fresh", stateRecord: false, warnings: [] });
    expect(snapshot(home)).toEqual(before);
  });

  test.each([false, true])("refuses a non-empty target (dryRun=%s) [3.1c#2]", async (dryRun) => {
    const home = temp();
    mkdirSync(join(home, "app"));
    writeFileSync(join(home, "app", "keep.txt"), "the user's file");
    const before = snapshot(home);
    failure(
      await invoke(home, ["app", ...(dryRun ? ["--dry-run"] : []), "--json"]),
      "TargetNotEmpty",
      { path: join(home, "app"), entries: ["keep.txt"] },
    );
    expect(snapshot(home)).toEqual(before);
  });

  test.each([false, true])(
    "renders templates and refuses unknown tokens (dryRun=%s) [3.1c#2]",
    async (dryRun) => {
      const home = temp();
      const registry = join(home, "registry");
      copyEntry(newRegistry, registry, "stacks", "fixture-stack");
      for (const id of ["base-req", "hooked", "own-repo", "ran-check", "tooled"])
        copyEntry(newRegistry, registry, "fragments", id);
      writeFileSync(join(registry, "stacks/fixture-stack/files/zz-bad.txt.tmpl"), "ok\n{{name}}\n");
      const before = snapshot(home);
      failure(
        await invoke(home, ["app", ...(dryRun ? ["--dry-run"] : []), "--json"], { registry }),
        "EntryInvalid",
        { id: "fixture-stack", origin: "bundled", reason: "template", line: 2 },
      );
      expect(snapshot(home)).toEqual(before);
    },
  );

  test("with both TTYs and claude on PATH, prints a preview and never starts claude [3.1c#3]", async () => {
    const home = temp();
    const claude = fakeAgent(join(home, "bin"), "claude");
    const before = snapshot(home);
    const run = await invoke(home, ["app", "--dry-run"], { terminal: true });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout).toContain("README.md");
    expect(run.stdout).toContain(".stacks/");
    expect(run.stdout.trimEnd().split("\n").at(-1)).toBe("Dry run: nothing was written.");
    expect(claude.ran()).toBe(false);
    expect(snapshot(home)).toEqual(before);
  });

  test("dry-run and explicit launch contradict without a JSON flag [3.1c#4]", async () => {
    const home = temp();
    const claude = fakeAgent(join(home, "bin"), "claude");
    const before = snapshot(home);
    const run = await invoke(home, ["app", "--dry-run", "--launch", "claude"], { terminal: true });
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("Invalid command.\n");
    expect(run.stderr).toContain("--dry-run");
    expect(run.stderr).toContain("--launch");
    expect(claude.ran()).toBe(false);
    expect(snapshot(home)).toEqual(before);
  });

  test("dry-run with launch and JSON emits one Usage envelope [3.1c#4]", async () => {
    const home = temp();
    const before = snapshot(home);
    failure(
      await invoke(home, ["app", "--dry-run", "--launch", "claude", "--json"], {
        terminal: true,
      }),
      "Usage",
      { flags: expect.arrayContaining(["--launch"]) },
    );
    expect(snapshot(home)).toEqual(before);
  });
});

describe("naming options", () => {
  test.each([
    {
      flag: "Flag Author",
      setting: "Settings Author",
      gitName: "Git Author",
      expected: "Flag Author",
    },
    {
      flag: undefined,
      setting: "Settings Author",
      gitName: "Git Author",
      expected: "Settings Author",
    },
    { flag: undefined, setting: undefined, gitName: "Git Author", expected: "Git Author" },
    { flag: undefined, setting: undefined, gitName: undefined, expected: "" },
    { flag: "", setting: "Settings Author", gitName: "Git Author", expected: "" },
  ])("name chooses my-app and author precedence yields $expected [3.1c#5]", async (row) => {
    const home = temp();
    const repo = join(home, "repo");
    mkdirSync(repo);
    git(home, repo, ["init", "--quiet"]);
    if (row.gitName) git(home, repo, ["config", "user.name", row.gitName]);
    if (row.setting) settings(home, row.setting);
    const result = success(
      await invoke(
        home,
        [
          "--name",
          "My App",
          "--without",
          "own-repo",
          "--json",
          ...(row.flag === undefined ? [] : ["--author", row.flag]),
        ],
        { cwd: repo, env: withGit },
      ),
    );
    expect(result).toMatchObject({
      project: join(repo, "my-app"),
      dryRun: false,
      stateRecord: true,
    });
    const readme = readFileSync(join(repo, "my-app/README.md"), "utf8");
    expect(readme).toContain("# My App\n");
    expect(readme).toContain("- slug: my-app\n");
    expect(readme).toContain("- env: MY_APP_PORT\n");
    expect(readme).toContain(`- author: ${row.expected}\n`);
  });

  test.each(["nested projects/Café workspace", "./-workspace"])(
    "explicit directory %j stays separate from the template name [3.1c#7]",
    async (dir) => {
      const home = temp();
      const result = success(await invoke(home, [dir, "--name", "myAPIServer2", "--json"]));
      expect(result.project).toBe(join(home, dir));
      expect(readFileSync(join(home, dir, "README.md"), "utf8")).toContain(
        "# myAPIServer2\n\n- slug: my-api-server2\n- env: MY_API_SERVER2_PORT\n",
      );
      expect(existsSync(join(home, "my-api-server2"))).toBe(false);
    },
  );

  test.each([
    ["@acme/web-app", "web-app"],
    ["Café Déjà Vu", "cafe-deja-vu"],
    ["myAPIServer2", "my-api-server2"],
    ["日本語", "project"],
    ["2048", "2048"],
  ])("name %j selects directory %j in preview and real creation [3.1c#8]", async (name, dir) => {
    const home = temp();
    const before = snapshot(home);
    const planned = success(await invoke(home, ["--name", name, "--dry-run", "--json"]));
    expect(planned.project).toBe(join(home, dir));
    expect(snapshot(home)).toEqual(before);
    const actual = success(await invoke(home, ["--name", name, "--json"]));
    expect(actual.project).toBe(planned.project);
    expect(actual.fingerprint).toBe(planned.fingerprint);
    const readme = readFileSync(join(home, dir, "README.md"), "utf8");
    expect(readme).toContain(`# ${name}\n`);
    expect(readme).toContain(`- slug: ${dir}\n`);
    expect(readme).toContain("- scope: \n");
    if (name === "2048") expect(readme).toContain("- env: _2048_PORT\n");
  });

  test("author sanitization also applies to the flag, while supported project punctuation is literal [3.1c#14]", async () => {
    const home = temp();
    settings(home, "Settings Author");
    const name = "My 'App' / Tools";
    const result = success(
      await invoke(home, [
        "app",
        "--name",
        name,
        "--author",
        'Ada "The" \\Count\r\nLovelace',
        "--json",
      ]),
    );
    expect(result.project).toBe(join(home, "app"));
    const readme = readFileSync(join(home, "app/README.md"), "utf8");
    expect(readme).toContain(`# ${name}\n`);
    expect(readme).toContain("- author: Ada The CountLovelace\n");
  });

  test.each([
    { flag: "name", value: "Bad\u0007Name", dryRun: false },
    { flag: "name", value: "Bad\nName", dryRun: false },
    { flag: "author", value: "Bad\tAuthor", dryRun: false },
    { flag: "author", value: "Bad\u001bAuthor", dryRun: false },
    { flag: "name", value: "Bad\u0007Name", dryRun: true },
    { flag: "name", value: "Bad\nName", dryRun: true },
    { flag: "author", value: "Bad\tAuthor", dryRun: true },
    { flag: "author", value: "Bad\u001bAuthor", dryRun: true },
  ])(
    "control characters in --$flag fail before writing (dryRun=$dryRun) [3.1c#15]",
    async ({ flag, value, dryRun }) => {
      const home = temp();
      const before = snapshot(home);
      failure(
        await invoke(home, ["app", `--${flag}`, value, ...(dryRun ? ["--dry-run"] : []), "--json"]),
        "BadInput",
        {
          flag,
          id: value,
        },
      );
      expect(snapshot(home)).toEqual(before);
    },
  );
});

describe("dry-run with existing files and environment", () => {
  test("plans from a symlinked cwd with an intermediate symlink without writing [3.1c#9]", async () => {
    const home = temp();
    const real = join(home, "real workspace");
    mkdirSync(join(real, "projects"), { recursive: true });
    symlinkSync(real, join(home, "alias"));
    symlinkSync(join(real, "projects"), join(real, "shortcut"));
    const cwd = join(home, "alias");
    const before = snapshot(home);
    const result = success(
      await invoke(home, ["shortcut/Café app", "--dry-run", "--json"], { cwd }),
    );
    // JSON keeps the absolute path as given, even when real paths differ.
    expect(result.project).toBe(join(cwd, "shortcut/Café app"));
    expect(existsSync(join(real, "projects/Café app"))).toBe(false);
    expect(snapshot(home)).toEqual(before);
  });

  test.each(["fresh", "committed", "broken"])(
    "preserves a %s .git and OS litter [3.1c#10]",
    async (kind) => {
      const home = temp();
      const app = join(home, "app");
      mkdirSync(app);
      if (kind === "broken") {
        mkdirSync(join(app, ".git"));
        writeFileSync(join(app, ".git/keep"), "unfinished git init");
      } else {
        git(home, app, ["init", "--quiet"]);
        if (kind === "committed")
          git(home, app, [
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.com",
            "commit",
            "--quiet",
            "--allow-empty",
            "-m",
            "fixture",
          ]);
      }
      writeFileSync(join(app, ".DS_Store"), "OS litter");
      const before = snapshot(home);
      const planned = success(await invoke(home, ["app", "--dry-run", "--json"], { env: withGit }));
      let expectedGit = "none";
      if (kind === "committed") expectedGit = "parent";
      else if (kind === "fresh") expectedGit = "fresh";
      expect(planned.git).toBe(expectedGit);
      expect(planned.written).toEqual(expectedFiles);
      expect(planned.warnings).toEqual(
        kind === "broken" ? [{ code: "git_unusable", id: "git", exitCode: 128 }] : [],
      );
      expect(snapshot(home)).toEqual(before);
      const actual = success(await invoke(home, ["app", "--json"], { env: withGit }));
      expect(actual.git).toBe(planned.git);
      expect(actual.warnings).toEqual(planned.warnings);
      expect(readFileSync(join(app, ".DS_Store"), "utf8")).toBe("OS litter");
    },
  );

  test.each(["partial", "file", "dangling"])(
    "refuses a %s target without changing it [3.1c#11]",
    async (kind) => {
      const home = temp();
      const app = join(home, "app");
      if (kind === "partial") {
        mkdirSync(join(app, ".stacks"), { recursive: true });
        writeFileSync(join(app, ".stacks/BRIEF.md"), "partial scaffold");
        writeFileSync(join(app, ".stacks/manifest.json"), "{");
      } else if (kind === "file") writeFileSync(app, "a file, not a directory");
      else symlinkSync(join(home, "missing"), app);
      const before = snapshot(home);
      for (const flags of [[], ["--dry-run"]]) {
        failure(await invoke(home, ["app", ...flags, "--json"]), "TargetNotEmpty", {
          path: app,
          entries: kind === "partial" ? [".stacks"] : [],
          ...(kind === "partial" ? { scaffold: "unfinished" } : {}),
        });
        expect(snapshot(home)).toEqual(before);
      }
    },
  );

  test("parent repository constraints and their fix apply before writing [3.1c#12]", async () => {
    const home = temp();
    const repo = join(home, "repo");
    mkdirSync(repo);
    git(home, repo, ["init", "--quiet"]);
    const before = snapshot(home);
    failure(
      await invoke(home, ["app", "--dry-run", "--json"], { cwd: repo, env: withGit }),
      "ComposeConflict",
      {
        reason: "needs_own_repo",
        ids: ["own-repo"],
        path: realpathSync(repo),
        fix: ["--without own-repo"],
      },
    );
    expect(snapshot(home)).toEqual(before);
    const result = success(
      await invoke(home, ["app", "--dry-run", "--without", "own-repo", "--json"], {
        cwd: repo,
        env: withGit,
      }),
    );
    expect(result.git).toBe("parent");
    expect(result.fragments).not.toContain("own-repo");
    expect(snapshot(home)).toEqual(before);
  });

  test("git hook environment does not select or mutate another repository [3.1c#13]", async () => {
    const home = temp();
    const elsewhere = join(home, "elsewhere");
    const cwd = join(home, "working directory");
    mkdirSync(elsewhere);
    mkdirSync(cwd);
    git(home, elsewhere, ["init", "--quiet"]);
    const before = snapshot(home);
    const result = success(
      await invoke(home, ["app", "--dry-run", "--json"], {
        cwd,
        env: { ...withGit, GIT_DIR: join(elsewhere, ".git"), GIT_WORK_TREE: elsewhere },
      }),
    );
    expect(result).toMatchObject({ project: join(cwd, "app"), git: "fresh", warnings: [] });
    expect(snapshot(home)).toEqual(before);
  });

  test.each(["CLAUDECODE", "CODEX_THREAD_ID", "AI_AGENT"])(
    "%s cannot turn a preview into an agent handoff [3.1c#16]",
    async (marker) => {
      const home = temp();
      const claude = fakeAgent(join(home, "bin"), "claude");
      const before = snapshot(home);
      const result = success(
        await invoke(home, ["app", "--dry-run", "--json"], {
          terminal: true,
          env: { [marker]: "1" },
        }),
      );
      expect(result.handoff).toMatchObject({ kind: "print", reason: "no-launch" });
      expect(claude.ran()).toBe(false);
      expect(snapshot(home)).toEqual(before);
    },
  );

  test("an earlier project's state survives a preview of a second project [3.1c#17]", async () => {
    const home = temp();
    const earlier = success(await invoke(home, ["earlier", "--json"]));
    expect(earlier.stateRecord).toBe(true);
    expect(readdirSync(join(home, "state/stacks/projects"))).toHaveLength(1);
    const before = snapshot(home);
    const result = success(await invoke(home, ["later", "--dry-run", "--json"]));
    expect(result).toMatchObject({ dryRun: true, stateRecord: false });
    expect(snapshot(home)).toEqual(before);
  });
});
