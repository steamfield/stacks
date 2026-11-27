import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { NewResult } from "../src/schemas/new";
import { quiet, runCli, tempDir } from "./helpers/cli";
import { spawnGit } from "./helpers/git";
import { adapterRegistry } from "./helpers/native-adapters";

const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});
function home() {
  const dir = tempDir();
  dirs.push(dir);
  return dir.path;
}
const hasGit = spawnGit(["--version"]).status === 0;
const withGit = { PATH: process.env.PATH ?? "", GIT_CONFIG_NOSYSTEM: "1" };

async function newCli(args: string[], at: string, env: Record<string, string> = {}) {
  return runCli(["new", "--no-launch", "--agents", "claude", "--json", ...args], {
    home: at,
    env: { ...quiet, ...env },
    host: { registry: adapterRegistry, cwd: at },
  });
}
const decode = (stdout: string) => Schema.decodeUnknownSync(NewResult)(JSON.parse(stdout));
const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");

/**
 * The files typescript-library's default fragments write (claude-harness-docs and git-hooks; ci-github
 * ships none). Before claude-harness-docs was split out, claude-harness wrote the same paths.
 */
const DEFAULT_FILES = [
  ".claude/agents/architect.md",
  ".claude/agents/reviewer.md",
  ".claude/commands/check.md",
  ".claude/commands/feature.md",
  ".claude/commands/test.md",
  ".lefthook/commit-msg/conventional-commits.sh",
  "docs/harness.md",
  "lefthook.yml",
];

test("default typescript-library keeps every default fragment and its files, and fills the commands rows", async () => {
  const at = home();
  const result = await newCli(["typescript-library", "lib"], at);
  expect(result.status).toBe(0);
  const decoded = decode(result.stdout);
  expect(decoded.preset).toBe("default");
  expect(decoded.payload).toBe("example");
  expect(decoded.fragments).toEqual(
    expect.arrayContaining(["claude-harness", "claude-harness-docs", "git-hooks", "ci-github"]),
  );
  for (const path of DEFAULT_FILES) expect(decoded.written).toContain(path);
  expect(decoded.written).toContain("src/slugify.ts");
  const root = join(at, "lib");
  const readme = read(root, "README.md");
  expect(readme).toContain(
    "| `bun run build` | Bundle src/index.ts into dist/ with declarations (tsdown) |",
  );
  expect(readme).toContain("| `bun run lint:package` |");
  expect(readme).not.toContain("stacks:fill:commands");
  // The toolchain marker needs an install, so it stays for the agent.
  expect(readme).toContain("stacks:fill:toolchain");
  const agents = read(root, "AGENTS.md");
  expect(agents).toContain("| `bun run gate` |");
  expect(agents).not.toContain("stacks:fill:commands");
  const brief = read(root, ".stacks/BRIEF.md");
  expect(brief.indexOf("## Start here")).toBeLessThan(brief.indexOf("## Facts"));
  expect(brief).toContain(
    "   bun add -d typescript tsdown publint @arethetypeswrong/cli @biomejs/biome vitest @vitest/coverage-v8 @types/node\n",
  );
  expect(brief).toContain("`stacks verify --all`");
});

test("--preset lean leaves out the default fragments and records the default preset", async () => {
  const at = home();
  const result = await newCli(["typescript-library", "lib", "--preset", "lean"], at);
  expect(result.status).toBe(0);
  const decoded = decode(result.stdout);
  expect(decoded.preset).toBe("lean");
  expect([...decoded.fragments].sort()).toEqual(["agent-ops", "claude-harness"]);
  for (const path of DEFAULT_FILES) expect(decoded.written).not.toContain(path);
  // The required harness core stays.
  expect(decoded.written).toContain(".claude/README.md");
  const manifest = JSON.parse(read(join(at, "lib"), ".stacks/manifest.json")) as {
    preset: string;
    fragments: string[];
  };
  expect(manifest.preset).toBe("default");
  expect(read(join(at, "lib"), ".stacks/BRIEF.md")).toContain(
    "- Preset: lean (no default fragments)",
  );
});

test("--payload none writes the empty variant instead of the example", async () => {
  const at = home();
  const result = await newCli(["typescript-library", "lib", "--payload", "none"], at);
  expect(result.status).toBe(0);
  const decoded = decode(result.stdout);
  expect(decoded.payload).toBe("none");
  expect(decoded.written).not.toContain("src/slugify.ts");
  expect(decoded.written).toContain("src/errors.ts");
  const root = join(at, "lib");
  expect(read(root, "src/index.ts")).toContain("export {};");
  expect(read(root, "README.md")).toContain("Nothing is exported yet.");
  const brief = read(root, ".stacks/BRIEF.md");
  expect(brief).toContain("- Payload: `none`");
  expect(brief).toContain("## Adding the API");
  expect(brief).not.toContain("## Replacing the example");
});

test("--payload none on a stack without that variant is refused, naming the flag", async () => {
  const at = home();
  const result = await newCli(["go-cli", "tool", "--payload", "none"], at);
  expect(result.status).toBe(2);
  const error = JSON.parse(result.stderr.trim().split("\n").at(-1) ?? "") as {
    error: { tag: string; details: Record<string, unknown> };
  };
  expect(error.error).toMatchObject({ tag: "BadInput", details: { id: "none", flag: "payload" } });
  expect(existsSync(join(at, "tool"))).toBe(false);
});

test.skipIf(!hasGit)(
  "--own-repo inside another repository gives the project its own and keeps ci-github and git-hooks",
  async () => {
    const at = home();
    const parent = join(at, "parent");
    mkdirSync(parent);
    expect(spawnGit(["init", "--quiet"], { cwd: parent }).status).toBe(0);
    const refused = await newCli(["typescript-library", "parent/lib"], at, withGit);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("needs_own_repo");

    const result = await newCli(["typescript-library", "parent/lib", "--own-repo"], at, withGit);
    expect(result.status).toBe(0);
    const decoded = decode(result.stdout);
    expect(decoded.git).toBe("fresh");
    expect(decoded.fragments).toEqual(expect.arrayContaining(["ci-github", "git-hooks"]));
    const root = join(parent, "lib");
    const top = spawnGit(["rev-parse", "--show-toplevel"], { cwd: root });
    expect(realpathSync(String(top.stdout).trim())).toBe(realpathSync(root));
  },
);
