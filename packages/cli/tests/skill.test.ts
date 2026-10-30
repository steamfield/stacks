import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import { parseDocument } from "yaml";
import { countWords } from "../src/core/brief/words";
import { AUTHOR_TOPICS, guideText } from "../src/core/guide";
import { splitFrontmatter } from "../src/core/registry/entry";
import { DoctorReport } from "../src/schemas/doctor";
import { quiet, runCli, tempDir, terminal } from "./helpers/cli";
import { spawnGit } from "./helpers/git";
import { declaredFlags } from "./helpers/help";

const shipped = fileURLToPath(new URL("../skills/", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/skills/", import.meta.url));
const fixtureText = readFileSync(join(fixture, "stacks", "SKILL.md"), "utf8");
const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});
function workspace() {
  const dir = tempDir();
  dirs.push(dir);
  return realpathSync(dir.path);
}
const target = (root: string) => join(root, ".claude", "skills", "stacks", "SKILL.md");
const withGit = { PATH: process.env.PATH ?? "", GIT_CONFIG_NOSYSTEM: "1" };
function init(root: string) {
  const git = spawnGit(["init", "--quiet", root]);
  expect(git.status, git.stderr?.toString()).toBe(0);
}
function install(
  home: string,
  args: readonly string[] = [],
  options: {
    cwd?: string;
    skill?: string;
    env?: Record<string, string | undefined>;
    human?: boolean;
  } = {},
) {
  // runCli already forwards Host overrides; HostInfo gains `skill` in this phase.
  const host = {
    cwd: options.cwd ?? home,
    skill: options.skill ?? fixture,
    ...(options.human ? terminal : {}),
  };
  return runCli(["skill", "install", ...args], {
    home,
    host,
    env: { ...quiet, ...withGit, ...options.env },
  });
}
// The plan names the result shape, but does not yet name a production result schema.
const Action = Schema.Literals(["written", "unchanged", "printed"]);
const InstallResult = Schema.Struct({
  name: Schema.Literals(["stacks", "stacks-author"]),
  path: Schema.NullOr(Schema.String),
  action: Action,
  files: Schema.Array(Schema.Struct({ path: Schema.String, action: Action })),
  text: Schema.optionalKey(Schema.String),
});
/** The result of installing the one-file fixture `stacks` skill at `path`. */
const one = (path: string, action: "written" | "unchanged") => ({
  name: "stacks",
  path,
  action,
  files: [{ path: "SKILL.md", action }],
});
const printed = {
  name: "stacks",
  path: null,
  action: "printed",
  files: [{ path: "SKILL.md", action: "printed" }],
  text: fixtureText,
};
function result(run: Awaited<ReturnType<typeof runCli>>) {
  expect(run.status).toBe(0);
  expect(run.stderr).toBe("");
  expect(run.stdout.trim().split("\n")).toHaveLength(1);
  return Schema.decodeUnknownSync(InstallResult, { onExcessProperty: "error" })(
    JSON.parse(run.stdout),
  );
}
const ErrorEnvelope = Schema.Struct({
  error: Schema.Struct({
    tag: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
    details: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  }),
});
function failure(run: Awaited<ReturnType<typeof runCli>>, status: number, tag: string) {
  expect(run.status).toBe(status);
  expect(run.stdout).toBe("");
  expect(run.stderr.trim().split("\n")).toHaveLength(1);
  const decoded = Schema.decodeUnknownSync(ErrorEnvelope)(JSON.parse(run.stderr));
  expect(decoded.error).toMatchObject({ tag, retryable: false });
  return decoded.error;
}
function skill(name: "stacks" | "stacks-author" = "stacks") {
  const parts = splitFrontmatter(readFileSync(join(shipped, name, "SKILL.md"), "utf8"));
  expect(parts).toBeDefined();
  if (!parts) throw new Error("Skill needs YAML frontmatter");
  return parts;
}
/** Commands are documented as inline code or fenced shell examples, never executed as shell text. */
function commands(body: string) {
  const code = [...body.matchAll(/```[^\n]*\n([\s\S]*?)```|`([^`\n]+)`/g)]
    .map((match) => match[1] ?? match[2] ?? "")
    .join("\n");
  return [
    ...code.matchAll(
      /(?:\bstacks(?:@[^\s`]+)?|<cli>)[ \t]+([a-z][a-z-]*)(.*?)(?=(?:\bstacks(?:@[^\s`]+)?|<cli>)[ \t]+[a-z]|&&|\|\||[;|\n]|$)/g,
    ),
  ].map((match) => ({
    name: match[1] ?? "",
    flags: [...new Set(match[2]?.match(/--[a-z][a-z-]*/g) ?? [])],
  }));
}

describe("shipped agent skill", () => {
  test("frontmatter is closed and describes when to use stacks [3.4c#1]", () => {
    const doc = parseDocument(skill().frontmatter, { logLevel: "silent" });
    expect(doc.errors).toEqual([]);
    expect(doc.warnings).toEqual([]);
    const meta = Schema.decodeUnknownSync(
      Schema.Struct({ name: Schema.Literal("stacks"), description: Schema.String }),
      { onExcessProperty: "error" },
    )(doc.toJS());
    expect(meta.description.trim().length).toBeGreaterThan(0);
    expect(meta.description.length).toBeLessThan(1024);
  });

  test("each skill body fits its fixed loading budget: 600 words for stacks, 800 for stacks-author [3.4c#2]", async () => {
    const { SKILL_WORDS } = await import("../src/core/skill");
    expect(SKILL_WORDS).toEqual({ stacks: 600, "stacks-author": 800 });
    for (const name of ["stacks", "stacks-author"] as const) {
      expect(countWords(skill(name).body), name).toBeGreaterThan(0);
      expect(countWords(skill(name).body), name).toBeLessThanOrEqual(SKILL_WORDS[name]);
    }
  });

  test("the authoring skill has closed frontmatter and exactly the six references guide author serves", () => {
    const doc = parseDocument(skill("stacks-author").frontmatter, { logLevel: "silent" });
    expect(doc.errors).toEqual([]);
    const meta = Schema.decodeUnknownSync(
      Schema.Struct({ name: Schema.Literal("stacks-author"), description: Schema.String }),
      { onExcessProperty: "error" },
    )(doc.toJS());
    expect(meta.description.trim().length).toBeGreaterThan(0);
    expect(meta.description.length).toBeLessThan(1024);
    expect(readdirSync(join(shipped, "stacks-author")).sort()).toEqual(["SKILL.md", "references"]);
    expect(readdirSync(join(shipped, "stacks-author", "references")).sort()).toEqual(
      [...AUTHOR_TOPICS].map((topic) => `${topic}.md`).sort(),
    );
  });

  test("the stacks skill points authors at guide author", () => {
    expect(skill().body).toContain("`<cli> guide author`");
  });

  test("every documented command and flag exists in the real command tree [3.4c#3]", async () => {
    const body = skill().body;
    const examples = commands(body);
    expect(examples.map((example) => example.name)).toEqual(
      expect.arrayContaining(["list", "new", "add", "verify"]),
    );
    const advertised = new Set<string>();
    for (const example of examples) {
      const help = await runCli([example.name, ...example.flags, "--help"]);
      expect(help.status, `${example.name}: ${help.stderr}`).toBe(0);
      expect(help.stderr).toBe("");
      const text = example.flags.includes("--json")
        ? Schema.decodeUnknownSync(Schema.Struct({ help: Schema.String }), {
            onExcessProperty: "error",
          })(JSON.parse(help.stdout)).help
        : help.stdout;
      expect(text).toContain(example.name);
      // --help bypasses validation, so check the option declarations of this command too.
      const flags = declaredFlags(text);
      for (const flag of example.flags)
        expect(flags.has(flag), `${example.name} ${flag}`).toBe(true);
      for (const flag of flags) advertised.add(flag);
    }
    for (const flag of body.match(/--[a-z][a-z-]*/g) ?? []) expect(advertised.has(flag)).toBe(true);
  });

  test("the skill repeats the safety rules, brief task and finish summary of the guide [3.4c#4]", () => {
    const raw = skill().body;
    const body = raw.replace(/[`*_]/g, "").replace(/\s+/g, " ");
    expect(body).toContain("VerifyChanged");
    expect(body).toMatch(/\bstop\b/i);
    expect(body).toMatch(/(?:don.t|never|do not)[^.]*(?:edit|change)[^.]*steps/i);
    expect(body).toMatch(/(?:don.t|never|do not)[^.]*--accept-changes/i);
    expect(body).toMatch(/(?:tell|ask|inform)[^.]*user/i);
    expect(body).toMatch(/(?:only[^.]*user|own terminal|human)/i);
    expect(body).toMatch(/(?:untrusted|trusted:\s*false)[^.]*unless[^.]*user[^.]*nam/i);
    expect(body).toMatch(/confirm/i);
    expect(body).toMatch(/brief[^.\n]*(?:whole|full|entire)[^.\n]*task/i);
    expect(body).toContain(".stacks/BRIEF.md");
    expect(body).toMatch(/(?:don.t|never|do not) (?:edit|change)\s+[`*]*\.stacks\/manifest\.json/i);
    expect(body).toContain(".stacks/NOTES.md");
    expect(body).toMatch(/after.green/i);
    expect(body).toMatch(/summari[sz]e/i);
    expect(body).toMatch(/stack[^.\n]*why/i);
    expect(body).toContain(
      "If noStrongMatch is true, say nothing fits well; run <cli> list --json and offer the closest entries.",
    );
    expect(body).toContain("<cli> verify --all");
    expect(body).toMatch(/decisions?[^.\n]*defaults?/i);
    expect(body).toMatch(/(?:undone|unfinished|left to do)/i);
    const names = (text: string) =>
      [...new Set(commands(text).map((command) => command.name))].sort();
    const guideNames = [
      ...new Set([...guideText("<cli>").matchAll(/<cli> ([a-z-]+)/g)].map((match) => match[1])),
    ].sort();
    expect(names(raw)).toEqual(guideNames);
  });
});

describe("skill install", () => {
  test("install, repeat, refusal and forced replacement preserve the user's bytes [3.4c#5]", async () => {
    const home = workspace();
    const path = target(home);
    expect(result(await install(home, ["--json"]))).toEqual(one(path, "written"));
    expect(readFileSync(path, "utf8")).toBe(fixtureText);
    expect(result(await install(home, ["--json"]))).toEqual(one(path, "unchanged"));
    const edit = "My edited skill\n";
    writeFileSync(path, edit);
    const refused = failure(await install(home, ["--json"]), 2, "TargetNotEmpty");
    expect(refused.details).toEqual({ path: dirname(path), entries: ["SKILL.md"] });
    expect(readFileSync(path, "utf8")).toBe(edit);
    const human = await install(home, [], { human: true });
    expect(human.status).toBe(2);
    expect(human.stdout).toBe("");
    expect(human.stderr).toContain("--force");
    expect(human.stderr).toContain("--print");
    expect(readFileSync(path, "utf8")).toBe(edit);
    expect(result(await install(home, ["--force", "--json"]))).toEqual(one(path, "written"));
    expect(readFileSync(path, "utf8")).toBe(fixtureText);
  });

  test("--project uses the git toplevel from a subdirectory and cwd outside git [3.4c#6]", async () => {
    const home = workspace();
    const repo = workspace();
    init(repo);
    const cwd = join(repo, "nested", "work");
    mkdirSync(cwd, { recursive: true });
    expect(result(await install(home, ["--project", "--json"], { cwd }))).toEqual(
      one(target(repo), "written"),
    );
    expect(readFileSync(target(repo), "utf8")).toBe(fixtureText);
    expect(existsSync(target(cwd))).toBe(false);
    const outside = workspace();
    expect(result(await install(home, ["--project", "--json"], { cwd: outside }))).toEqual(
      one(target(outside), "written"),
    );
    expect(readFileSync(target(outside), "utf8")).toBe(fixtureText);
    expect(existsSync(join(home, ".claude"))).toBe(false);
  });

  test("--print emits exact text or one JSON result without creating directories [3.4c#7]", async () => {
    const home = workspace();
    expect(await install(home, ["--print"])).toEqual({
      status: 0,
      stdout: fixtureText,
      stderr: "",
    });
    expect(result(await install(home, ["--print", "--json"]))).toEqual(printed);
    expect(readdirSync(home)).toEqual([]);
  });

  test.each([false, true])(
    "an escaping stacks symlink is refused (force=%s) [3.4c#8]",
    async (force) => {
      const home = workspace();
      const outside = workspace();
      writeFileSync(join(outside, "keep"), "keep\n");
      mkdirSync(dirname(dirname(target(home))), { recursive: true });
      symlinkSync(outside, dirname(target(home)));
      const denied = failure(
        await install(home, [...(force ? ["--force"] : []), "--json"]),
        6,
        "PermissionDenied",
      );
      expect(denied.details).toMatchObject({ path: expect.any(String) });
      expect(readdirSync(outside)).toEqual(["keep"]);
      expect(readFileSync(join(outside, "keep"), "utf8")).toBe("keep\n");
      expect(lstatSync(dirname(target(home))).isSymbolicLink()).toBe(true);
    },
  );

  test.skipIf(process.getuid?.() === 0)(
    "an unwritable skills directory exits 6 without disturbing it [3.4c#8]",
    async () => {
      const home = workspace();
      const skills = dirname(dirname(target(home)));
      mkdirSync(skills, { recursive: true });
      chmodSync(skills, 0o000);
      try {
        const denied = failure(await install(home, ["--json"]), 6, "PermissionDenied");
        expect(denied.details).toMatchObject({ path: expect.any(String) });
      } finally {
        chmodSync(skills, 0o755);
      }
      expect(readdirSync(skills)).toEqual([]);
    },
  );

  test("a missing bundled skill fails install and doctor reports the missing path [3.4c#9]", async () => {
    const home = workspace();
    const missing = join(workspace(), "absent");
    expect(
      failure(await install(home, ["--json"], { skill: missing }), 2, "NotFound").details,
    ).toMatchObject({ path: join(missing, "stacks") });
    expect(readdirSync(home)).toEqual([]);
    const host = { cwd: home, skill: missing };
    const doctor = await runCli(["doctor", "--json"], { home, host, env: quiet });
    expect(doctor.status).toBe(0);
    expect(doctor.stderr).toBe("");
    expect(doctor.stdout.trim().split("\n")).toHaveLength(1);
    const report = Schema.decodeUnknownSync(DoctorReport)(JSON.parse(doctor.stdout));
    expect(report).toMatchObject({ skill: { path: missing, found: false } });
    const presentHost = { ...host, skill: fixture };
    const present = await runCli(["doctor", "--json"], {
      home,
      host: presentHost,
      env: quiet,
    });
    expect(present.status).toBe(0);
    expect(present.stderr).toBe("");
    expect(Schema.decodeUnknownSync(DoctorReport)(JSON.parse(present.stdout))).toMatchObject({
      skill: { path: fixture, found: true },
    });
  });

  test.each([false, true])(
    "a detected agent can install with terminal=%s [3.4c#11]",
    async (human) => {
      const home = workspace();
      const run = await install(home, [], { env: { CLAUDECODE: "1" }, human });
      expect(run.status).toBe(0);
      expect(run.stderr).toBe("");
      expect(run.stdout).toContain("SKILL.md");
      expect(readFileSync(target(home), "utf8")).toBe(fixtureText);
    },
  );

  test("project paths with spaces, a leading dash and Unicode work through a symlinked cwd [3.4c#12]", async () => {
    const home = workspace();
    const repo = join(workspace(), "-café project");
    mkdirSync(repo);
    init(repo);
    const cwd = join(repo, "nested");
    mkdirSync(cwd);
    const link = join(workspace(), "linked cwd");
    symlinkSync(cwd, link);
    expect(result(await install(home, ["--project", "--json"], { cwd: link }))).toEqual(
      one(target(repo), "written"),
    );
    expect(readFileSync(target(repo), "utf8")).toBe(fixtureText);
    expect(existsSync(target(cwd))).toBe(false);
  });

  test("--force never writes through a final SKILL.md symlink [3.4c#13]", async () => {
    const home = workspace();
    const outside = join(workspace(), "personal-skill.md");
    writeFileSync(outside, "personal skill\n");
    mkdirSync(dirname(target(home)), { recursive: true });
    symlinkSync(outside, target(home));
    const denied = failure(await install(home, ["--force", "--json"]), 6, "PermissionDenied");
    expect(denied.details).toMatchObject({ path: expect.any(String) });
    expect(readFileSync(outside, "utf8")).toBe("personal skill\n");
  });

  test("a dotfiles symlink above the skills root is a supported install location [3.4c#14]", async () => {
    const home = workspace();
    const dotfiles = workspace();
    symlinkSync(dotfiles, join(home, ".claude"));
    const installed = result(await install(home, ["--json"]));
    expect(installed.action).toBe("written");
    expect(realpathSync(installed.path ?? "")).toBe(join(dotfiles, "skills", "stacks", "SKILL.md"));
    expect(readFileSync(target(home), "utf8")).toBe(fixtureText);
  });

  test("a directory occupying SKILL.md is preserved on a forced install [3.4c#15]", async () => {
    const home = workspace();
    mkdirSync(target(home), { recursive: true });
    writeFileSync(join(target(home), "keep"), "keep\n");
    expect(
      failure(await install(home, ["--force", "--json"]), 2, "TargetNotEmpty").details,
    ).toMatchObject({ path: dirname(target(home)), entries: ["SKILL.md"] });
    expect(readFileSync(join(target(home), "keep"), "utf8")).toBe("keep\n");
  });

  test("inherited git repository variables cannot redirect --project [3.4c#16]", async () => {
    const home = workspace();
    const repo = workspace();
    const other = workspace();
    init(repo);
    init(other);
    const run = await install(home, ["--project", "--json"], {
      cwd: repo,
      env: { GIT_DIR: join(other, ".git"), GIT_WORK_TREE: other },
    });
    expect(result(run)).toEqual(one(target(repo), "written"));
    expect(readFileSync(target(repo), "utf8")).toBe(fixtureText);
    expect(existsSync(join(other, ".claude"))).toBe(false);
  });

  test("missing HOME refuses a user install without falling back to another home [3.4c#17]", async () => {
    const home = workspace();
    failure(await install(home, ["--json"], { env: { HOME: undefined } }), 6, "PermissionDenied");
    expect(readdirSync(home)).toEqual([]);
  });

  test("--print bypasses target permissions and HOME lookup even with --project and --force [3.4c#18]", async () => {
    const home = workspace();
    writeFileSync(join(home, ".claude"), "a file, not a directory\n");
    const run = await install(home, ["--print", "--project", "--force", "--json"], {
      env: { HOME: undefined },
    });
    expect(result(run)).toEqual(printed);
    expect(readdirSync(home)).toEqual([".claude"]);
    expect(readFileSync(join(home, ".claude"), "utf8")).toBe("a file, not a directory\n");
  });

  test("a partial earlier install keeps unrelated files and fills only SKILL.md [3.4c#19]", async () => {
    const home = workspace();
    mkdirSync(dirname(target(home)), { recursive: true });
    const keep = join(dirname(target(home)), "personal-notes.md");
    writeFileSync(keep, "keep\n");
    expect(result(await install(home, ["--json"]))).toEqual(one(target(home), "written"));
    expect(readFileSync(target(home), "utf8")).toBe(fixtureText);
    expect(readFileSync(keep, "utf8")).toBe("keep\n");
    expect(readdirSync(dirname(target(home))).sort()).toEqual(["SKILL.md", "personal-notes.md"]);
  });
});

describe("skill install stacks-author", () => {
  const authorDir = (root: string) => join(root, ".claude", "skills", "stacks-author");
  const sourceFiles = ["SKILL.md", "references/anatomy.md"];
  const source = (rel: string) => readFileSync(join(fixture, "stacks-author", rel), "utf8");
  const authorResult = (root: string, actions: ReadonlyArray<"written" | "unchanged">) => ({
    name: "stacks-author",
    path: join(authorDir(root), "SKILL.md"),
    action: actions.includes("written") ? "written" : "unchanged",
    files: sourceFiles.map((path, i) => ({ path, action: actions[i] })),
  });

  test("writes every file of the skill, then reports each unchanged on a rerun", async () => {
    const home = workspace();
    expect(result(await install(home, ["stacks-author", "--json"]))).toEqual(
      authorResult(home, ["written", "written"]),
    );
    for (const rel of sourceFiles)
      expect(readFileSync(join(authorDir(home), rel), "utf8")).toBe(source(rel));
    expect(existsSync(target(home))).toBe(false);
    expect(result(await install(home, ["stacks-author", "--json"]))).toEqual(
      authorResult(home, ["unchanged", "unchanged"]),
    );
    const text = await install(home, ["stacks-author"]);
    expect(text.status).toBe(0);
    expect(text.stderr).toBe("");
    expect(text.stdout).toContain("(2 files)");
  });

  test("a differing reference refuses the whole install without --force, naming its own command", async () => {
    const home = workspace();
    const reference = join(authorDir(home), "references", "anatomy.md");
    mkdirSync(dirname(reference), { recursive: true });
    writeFileSync(reference, "my notes\n");
    const run = await install(home, ["stacks-author", "--json"]);
    const refused = failure(run, 2, "TargetNotEmpty");
    expect(refused.details).toEqual({
      path: authorDir(home),
      entries: ["references/anatomy.md"],
    });
    expect(JSON.parse(run.stderr)).toMatchObject({
      error: {
        next: "rerun stacks skill install stacks-author with --force to replace it, or --print to copy it elsewhere.",
      },
    });
    // Checked before writing: SKILL.md was absent and stays absent.
    expect(readdirSync(authorDir(home))).toEqual(["references"]);
    expect(readFileSync(reference, "utf8")).toBe("my notes\n");
    expect(result(await install(home, ["stacks-author", "--force", "--json"]))).toEqual(
      authorResult(home, ["written", "written"]),
    );
    expect(readFileSync(reference, "utf8")).toBe(source("references/anatomy.md"));
    expect(readdirSync(dirname(reference))).toEqual(["anatomy.md"]);
  });

  test("a file where the references directory belongs is refused and kept", async () => {
    const home = workspace();
    mkdirSync(authorDir(home), { recursive: true });
    writeFileSync(join(authorDir(home), "references"), "a file\n");
    const run = await install(home, ["stacks-author", "--force", "--json"]);
    failure(run, 2, "TargetNotEmpty");
    expect(readdirSync(authorDir(home))).toEqual(["references"]);
    expect(readFileSync(join(authorDir(home), "references"), "utf8")).toBe("a file\n");
  });

  test("an escaping references symlink is refused and nothing is written through it", async () => {
    const home = workspace();
    const outside = workspace();
    mkdirSync(authorDir(home), { recursive: true });
    symlinkSync(outside, join(authorDir(home), "references"));
    failure(await install(home, ["stacks-author", "--json"]), 6, "PermissionDenied");
    expect(readdirSync(outside)).toEqual([]);
    expect(existsSync(join(authorDir(home), "SKILL.md"))).toBe(false);
  });

  test("--print prints SKILL.md only", async () => {
    const home = workspace();
    expect(result(await install(home, ["stacks-author", "--print", "--json"]))).toEqual({
      name: "stacks-author",
      path: null,
      action: "printed",
      files: [{ path: "SKILL.md", action: "printed" }],
      text: source("SKILL.md"),
    });
    expect(readdirSync(home)).toEqual([]);
  });

  test("an unknown name is a usage error with the closest names", async () => {
    const home = workspace();
    const error = failure(await install(home, ["stacks-autor", "--json"]), 2, "Usage");
    expect(error.details).toEqual({
      flag: "name",
      command: "skill install",
      value: "stacks-autor",
      expected: "stacks | stacks-author",
      suggestions: ["stacks-author"],
    });
    expect(readdirSync(home)).toEqual([]);
  });
});
