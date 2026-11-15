/**
 * Exercises release preparation in isolated project fixtures, including version updates and refusal
 * cases.
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = join(import.meta.dirname, "../../scripts/release.ts");
const bunDir = spawnSync("which", ["bun"], { encoding: "utf8" })
  .stdout.trim()
  .replace(/\/bun$/, "");

const changelog = (extra = "") =>
  `# Changelog\n\n## [Unreleased]\n${extra}\n## [0.1.0] - 2026-01-01\n`;
const section = "\n## [0.1.1] - 2026-02-01\n\n### Fixed\n\n- Something.\n";
const files: Record<string, string> = {
  "package.json": '{\n  "name": "example-package",\n  "version": "0.1.0"\n}\n',
  "README.md": "Install with `npm i example-package@0.1.0`.\n",
  "CHANGELOG.md": changelog(),
};

let dir: string;
let repo: string;
let origin: string;

const git = (cwd: string, ...args: string[]) =>
  spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });

function write(relative: string, content: string) {
  mkdirSync(dirname(join(repo, relative)), { recursive: true });
  writeFileSync(join(repo, relative), content);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bump-test-"));
  repo = join(dir, "repo");
  origin = join(dir, "origin.git");
  mkdirSync(repo);
  git(dir, "init", "--bare", "-b", "main", origin);
  git(repo, "init", "-b", "main");
  git(repo, "remote", "add", "origin", origin);
  mkdirSync(join(repo, "scripts"));
  copyFileSync(script, join(repo, "scripts/release.ts"));
  for (const [path, content] of Object.entries(files)) write(path, content);
  git(repo, "add", "-A");
  git(repo, "commit", "-m", "init");
  // The fake `bun` answers the script's own `bun install`.
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin/bun"), '#!/bin/sh\necho "bun $*" >> "$FAKE_LOG"\nexit 0\n');
  chmodSync(join(dir, "bin/bun"), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function release(...args: string[]) {
  const log = join(dir, "bun.log");
  const result = spawnSync(join(bunDir, "bun"), ["scripts/release.ts", ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { HOME: dir, PATH: `${join(dir, "bin")}:/usr/bin:/bin`, FAKE_LOG: log },
  });
  return { ...result, log: existsSync(log) ? readFileSync(log, "utf8") : "" };
}

const read = (relative: string) => readFileSync(join(repo, relative), "utf8");
const status = () => git(repo, "status", "--porcelain").stdout;

describe("bun run release", () => {
  it("rewrites the version everywhere it lives and refreshes the lockfile", () => {
    write("CHANGELOG.md", changelog(section));
    const result = release("0.1.1");
    expect(result.status, result.stderr).toBe(0);
    expect(read("package.json")).toContain('"version": "0.1.1"');
    expect(read("README.md")).toBe("Install with `npm i example-package@0.1.1`.\n");
    expect(result.log).toContain("bun install");
  });

  it("prints the next steps with the tag after the bump commit, and never commits or tags", () => {
    write("CHANGELOG.md", changelog(section));
    const result = release("0.1.1");
    expect(result.stdout).toContain('git commit -m "chore(release): 0.1.1"');
    expect(result.stdout).toContain("only after the bump commit");
    expect(git(repo, "log", "--oneline").stdout.trim().split("\n")).toHaveLength(1);
    expect(git(repo, "tag", "--list").stdout).toBe("");
  });

  describe("refuses, and writes nothing", () => {
    function refuses(result: ReturnType<typeof release>, message: string) {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(message);
      expect(result.log).toBe("");
      expect(read("package.json")).toContain('"version": "0.1.0"');
    }

    it("when another file is dirty", () => {
      write("CHANGELOG.md", changelog(section));
      write("README.md", "edited\n");
      refuses(release("0.1.1"), "uncommitted changes besides CHANGELOG.md: README.md");
    });

    it("on a branch other than main", () => {
      git(repo, "checkout", "-b", "feature");
      write("CHANGELOG.md", changelog(section));
      refuses(release("0.1.1"), "release from main");
    });

    it("when the tag exists locally", () => {
      write("CHANGELOG.md", changelog(section));
      git(repo, "tag", "v0.1.1");
      refuses(release("0.1.1"), "tag v0.1.1 already exists locally");
    });

    it("when a stale tag is on origin", () => {
      write("CHANGELOG.md", changelog(section));
      git(repo, "tag", "v0.1.1");
      git(repo, "push", "origin", "v0.1.1");
      git(repo, "tag", "-d", "v0.1.1");
      const result = release("0.1.1");
      refuses(result, "tag v0.1.1 already exists on origin");
      expect(result.stderr).toContain("git push origin :refs/tags/v0.1.1");
    });

    it("when the changelog has no section for the version", () => {
      refuses(release("0.1.1"), 'has no "## [0.1.1] - YYYY-MM-DD" section');
      expect(status()).toBe("");
    });

    it("for the current or an older version", () => {
      write("CHANGELOG.md", changelog(section));
      refuses(release("0.1.0"), "package.json is already at 0.1.0");
      refuses(release("0.0.9"), "0.0.9 is not newer than 0.1.0");
    });

    it.each(["v0.1.1", "0.1", "0.1.1-rc.1", ""])("for the argument %j", (argument) => {
      refuses(release(...(argument === "" ? [] : [argument])), "usage: bun run release");
    });
  });
});
