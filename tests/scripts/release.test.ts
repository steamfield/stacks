import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

const KEYS = ["astro-blog:default", "astro-blog:sandbox", "go-cli:default"] as const;
const stale = `sha256:${"0".repeat(64)}`;
const briefFor = (stack: string, preset: string) => `brief of ${stack} ${preset}`;
const digestOf = (stack: string, preset: string) =>
  `sha256:${createHash("sha256").update(briefFor(stack, preset), "utf8").digest("hex")}`;

const files: Record<string, string> = {
  "packages/cli/package.json": '{\n  "name": "@steamfield/stacks",\n  "version": "0.9.0"\n}\n',
  "packages/mcp/package.json": '{\n  "name": "@steamfield/stacks-mcp",\n  "version": "0.1.2"\n}\n',
  "packages/cli/plugin/.claude-plugin/plugin.json": '{\n  "version": "0.9.0"\n}\n',
  ".claude-plugin/marketplace.json": '{\n  "plugins": [{ "source": { "ref": "v0.9.0" } }]\n}\n',
  "README.md": "A readme that names no version.\n",
  "packages/cli/tests/runtime.test.ts":
    'expect(a).toBe("0.9.0");\nexpect(b.version).toBe("0.9.0");\n',
  "packages/cli/e2e/artifact.test.ts": 'const x = {\n    version: "0.9.0",\n};\n',
  "packages/cli/tests/fixtures/index/harness.ts": 'export const v = {\n    cli: "0.9.0",\n};\n',
  "packages/cli/tests/fixtures/bundled-brief-digests.ts": `/**
 * history
 * After proving an intentional brief change, regenerate each key.
 */
export const briefDigests = {
${KEYS.map((key) => `  "${key}": "${stale}",`).join("\n")}
};
`,
  "packages/cli/CHANGELOG.md": "# Changelog\n\n## [Unreleased]\n\n## [0.9.0] - 2026-11-14\n",
  "packages/cli/registry/registry.json": '{ "formatVersion": 1, "minCli": "0.8.0" }\n',
};

// `bun install` succeeds; `bun run dev validate --brief <stack> [--sandbox] --json` prints a brief.
const fakeBun = `#!/bin/sh
echo "bun $*" >> "$FAKE_LOG"
if [ "$1" = install ]; then exit 0; fi
if [ "$1 $2 $3 $4" = "run dev validate --brief" ]; then
  preset=default; [ "$6" = "--sandbox" ] && preset=sandbox
  printf '{"brief":"brief of %s %s"}' "$5" "$preset"; exit 0
fi
exit 98
`;

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
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin/bun"), fakeBun);
  chmodSync(join(dir, "bin/bun"), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function release(...args: string[]) {
  const log = join(dir, "bun.log");
  // The real bun runs the script by absolute path; the fake on PATH answers the script's own calls.
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
  it("rewrites every place the version lives, bumps the MCP patch and refreshes the digests", () => {
    write(
      "packages/cli/CHANGELOG.md",
      `${files["packages/cli/CHANGELOG.md"]}\n## [0.9.1] - 2026-11-15\n`,
    );
    const result = release("0.9.1");
    expect(result.status, result.stderr).toBe(0);
    expect(read("packages/cli/package.json")).toContain('"version": "0.9.1"');
    expect(read("packages/cli/plugin/.claude-plugin/plugin.json")).toContain('"version": "0.9.1"');
    expect(read(".claude-plugin/marketplace.json")).toContain('"ref": "v0.9.1"');
    expect(read("packages/cli/tests/runtime.test.ts")).toBe(
      'expect(a).toBe("0.9.1");\nexpect(b.version).toBe("0.9.1");\n',
    );
    expect(read("packages/cli/e2e/artifact.test.ts")).toContain('version: "0.9.1"');
    expect(read("packages/cli/tests/fixtures/index/harness.ts")).toContain('cli: "0.9.1"');
    expect(read("packages/mcp/package.json")).toContain('"version": "0.1.3"');
    const digests = read("packages/cli/tests/fixtures/bundled-brief-digests.ts");
    for (const key of KEYS) {
      const [stack = "", preset = ""] = key.split(":");
      expect(digests).toContain(`"${key}": "${digestOf(stack, preset)}"`);
    }
    expect(digests).toMatch(
      / \* The 0\.9\.1 version in the brief changed all six again on \d{4}-\d\d-\d\d\./,
    );
    expect(result.log).toContain("bun install");
  });

  it("prints the next steps with the tag after the bump commit, and never commits, tags or pushes", () => {
    write(
      "packages/cli/CHANGELOG.md",
      `${files["packages/cli/CHANGELOG.md"]}\n## [0.9.1] - 2026-11-15\n`,
    );
    const result = release("0.9.1");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('git commit -m "chore(release): 0.9.1"');
    expect(result.stdout).toContain("only after the bump commit");
    expect(git(repo, "log", "--oneline").stdout.trim().split("\n")).toHaveLength(1);
    expect(git(repo, "tag", "--list").stdout).toBe("");
    expect(git(origin, "tag", "--list").stdout).toBe("");
  });

  it("leaves the registry's minCli alone without --min-cli", () => {
    write(
      "packages/cli/CHANGELOG.md",
      `${files["packages/cli/CHANGELOG.md"]}\n## [0.9.1] - 2026-11-15\n`,
    );
    const result = release("0.9.1");
    expect(result.status, result.stderr).toBe(0);
    expect(read("packages/cli/registry/registry.json")).toBe(
      files["packages/cli/registry/registry.json"],
    );
  });

  it.each([
    ["0.9.1", "--min-cli"],
    ["--min-cli", "0.9.1"],
  ])("raises the registry's minCli to the release with %s %s", (...args) => {
    write(
      "packages/cli/CHANGELOG.md",
      `${files["packages/cli/CHANGELOG.md"]}\n## [0.9.1] - 2026-11-15\n`,
    );
    const result = release(...args);
    expect(result.status, result.stderr).toBe(0);
    expect(read("packages/cli/registry/registry.json")).toBe(
      '{ "formatVersion": 1, "minCli": "0.9.1" }\n',
    );
    expect(read("packages/cli/package.json")).toContain('"version": "0.9.1"');
  });

  it("allows an edited changelog as the only dirt, so the release is one commit", () => {
    write(
      "packages/cli/CHANGELOG.md",
      `${files["packages/cli/CHANGELOG.md"]}\n## [0.9.1] - 2026-11-15\n`,
    );
    expect(status()).toContain("packages/cli/CHANGELOG.md");
    const result = release("0.9.1");
    expect(result.status, result.stderr).toBe(0);
  });

  describe("refuses, and writes nothing", () => {
    function refuses(result: ReturnType<typeof release>, message: string) {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(message);
      expect(result.log).toBe("");
    }

    it("when another file is dirty", () => {
      write(
        "packages/cli/CHANGELOG.md",
        `${files["packages/cli/CHANGELOG.md"]}\n## [0.9.1] - 2026-11-15\n`,
      );
      write("README.md", "edited\n");
      const before = status();
      refuses(release("0.9.1"), "uncommitted changes besides packages/cli/CHANGELOG.md: README.md");
      expect(status()).toBe(before);
    });

    it("on a branch other than main", () => {
      git(repo, "checkout", "-b", "feature");
      refuses(release("0.9.1"), "release from main");
    });

    it("when the tag exists locally", () => {
      git(repo, "tag", "v0.9.1");
      refuses(release("0.9.1"), "tag v0.9.1 already exists locally");
    });

    it("when a stale tag is on origin, naming the delete command for a maintainer", () => {
      git(repo, "tag", "v0.9.1");
      git(repo, "push", "origin", "v0.9.1");
      git(repo, "tag", "-d", "v0.9.1");
      const result = release("0.9.1");
      refuses(result, "tag v0.9.1 already exists on origin");
      expect(result.stderr).toContain("git push origin :refs/tags/v0.9.1");
    });

    it("when the changelog has no section for the version", () => {
      refuses(release("0.9.1"), 'has no "## [0.9.1] - YYYY-MM-DD" section');
      expect(status()).toBe("");
    });

    it("for the current or an older version", () => {
      write(
        "packages/cli/CHANGELOG.md",
        `${files["packages/cli/CHANGELOG.md"]}\n## [0.8.0] - 2026-01-01\n`,
      );
      refuses(release("0.9.0"), "packages/cli is already at 0.9.0");
      refuses(release("0.8.0"), "0.8.0 is not newer than 0.9.0");
    });

    it.each(["v0.9.1", "0.9", "0.9.1-rc.1", ""])("for the argument %j", (argument) => {
      refuses(release(...(argument === "" ? [] : [argument])), "usage: bun run release");
    });

    it.each([
      ["0.9.1", "--min-cli", "--min-cli"],
      ["0.9.1", "--minCli"],
      ["0.9.1", "0.9.2"],
      ["--min-cli"],
    ])("for the arguments %j", (...args) => {
      refuses(release(...args), "usage: bun run release");
    });

    it("with --min-cli when the registry has no registry.json", () => {
      write(
        "packages/cli/CHANGELOG.md",
        `${files["packages/cli/CHANGELOG.md"]}\n## [0.9.1] - 2026-11-15\n`,
      );
      git(repo, "rm", "-q", "packages/cli/registry/registry.json");
      git(repo, "commit", "-qm", "no registry metadata");
      refuses(release("0.9.1", "--min-cli"), "--min-cli needs packages/cli/registry/registry.json");
      expect(read("packages/cli/package.json")).toContain('"version": "0.9.0"');
    });
  });

  it("fails before changing any file when one no longer matches what the script rewrites", () => {
    write("packages/cli/e2e/artifact.test.ts", "no version here\n");
    git(repo, "commit", "-am", "drop the version");
    write(
      "packages/cli/CHANGELOG.md",
      `${files["packages/cli/CHANGELOG.md"]}\n## [0.9.1] - 2026-11-15\n`,
    );
    const result = release("0.9.1");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("packages/cli/e2e/artifact.test.ts no longer matches");
    expect(result.stderr).toContain("update scripts/release.ts");
    expect(read("packages/cli/package.json")).toContain('"version": "0.9.0"');
    expect(status().trim()).toBe("M packages/cli/CHANGELOG.md");
  });
});
