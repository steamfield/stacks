import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { SkillResult } from "../src/schemas/skill";
import { quiet, runCli, tempDir, terminal } from "./helpers/cli";
import { spawnGit } from "./helpers/git";

const skill = fileURLToPath(new URL("./fixtures/skills/", import.meta.url));
const dirs: ReturnType<typeof tempDir>[] = [];
const workspace = () => {
  const dir = tempDir();
  dirs.push(dir);
  return realpathSync(dir.path);
};
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});
const target = (root: string) => join(root, ".claude", "skills", "stacks", "SKILL.md");

test("project install ignores Git tracing on stderr", async () => {
  const home = workspace();
  const repo = workspace();
  const git = spawnGit(["init", "--quiet", repo]);
  expect(git.status, git.stderr?.toString()).toBe(0);
  const cwd = join(repo, "nested");
  mkdirSync(cwd);
  const run = await runCli(["skill", "install", "--project", "--json"], {
    home,
    host: { cwd, skill },
    env: { ...quiet, PATH: process.env.PATH, GIT_TRACE: "1", GIT_CONFIG_NOSYSTEM: "1" },
  });
  expect(run.status).toBe(0);
  expect(run.stderr).toBe("");
  expect(
    Schema.decodeUnknownSync(SkillResult, { onExcessProperty: "error" })(JSON.parse(run.stdout)),
  ).toEqual({
    name: "stacks",
    path: target(repo),
    action: "written",
    files: [{ path: "SKILL.md", action: "written" }],
  });
  expect(readFileSync(target(repo), "utf8")).toBe(
    readFileSync(join(skill, "stacks", "SKILL.md"), "utf8"),
  );
});

test.each([false, true])(
  "a blocking directory gives actionable recovery guidance (human=%s)",
  async (human) => {
    const home = workspace();
    const file = target(home);
    mkdirSync(file, { recursive: true });
    writeFileSync(join(file, "keep"), "keep\n");
    const run = await runCli(["skill", "install", "--force"], {
      home,
      host: { cwd: home, skill, ...(human ? terminal : {}) },
      env: quiet,
    });
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("The target directory is not empty.");
    expect(run.stderr).toContain(`Path: ${dirname(file)}`);
    expect(run.stderr).toMatch(/Next:.*move.*SKILL\.md/i);
    expect(run.stderr).toContain("--print");
    expect(run.stderr).not.toContain("--force");
    expect(readFileSync(join(file, "keep"), "utf8")).toBe("keep\n");
  },
);
