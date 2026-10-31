import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { SkillResult } from "../src/schemas/skill";
import { quiet, runCli } from "./helpers/cli";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());
const skill = join(import.meta.dirname, "fixtures/skills");
const text = readFileSync(join(skill, "stacks", "SKILL.md"), "utf8");
const one = (path: string, action: "written" | "unchanged") => ({
  name: "stacks",
  path,
  action,
  files: [{ path: "SKILL.md", action }],
});
const target = (root: string) => join(root, ".claude/skills/stacks/SKILL.md");

test.each(["no git", "broken git"])(
  "--project falls back to cwd with %s and no HOME",
  async (scenario) => {
    const home = space.dir();
    const cwd = join(space.dir(), "-équipe workspace");
    mkdirSync(cwd);
    if (scenario === "broken git") writeFileSync(join(cwd, ".git"), "gitdir: missing\n");
    const result = await runCli(["skill", "install", "--project", "--json"], {
      home,
      host: { cwd, skill },
      env: { ...quiet, HOME: undefined, PATH: scenario === "no git" ? "" : process.env.PATH },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(Schema.decodeUnknownSync(SkillResult)(JSON.parse(result.stdout))).toEqual(
      one(target(cwd), "written"),
    );
    expect(readFileSync(target(cwd), "utf8")).toBe(text);
    expect(readdirSync(home)).toEqual([]);
  },
);

test.skipIf(process.getuid?.() === 0).each(["json", "agent", "human"])(
  "%s cannot print an unreadable bundled skill and creates no target",
  async (audience) => {
    const home = space.dir();
    const source = space.dir();
    mkdirSync(join(source, "stacks"));
    const file = join(source, "stacks", "SKILL.md");
    writeFileSync(file, "unreadable source\n", { mode: 0o000 });
    try {
      const result = await runCli(
        ["skill", "install", "--print", ...(audience === "json" ? ["--json"] : [])],
        { home, env: quiet, host: { skill: source, stdoutIsTTY: audience === "human" } },
      );
      expect(result.status).toBe(6);
      expect(result.stdout).toBe("");
      if (audience === "json") {
        expect(JSON.parse(result.stderr)).toEqual({
          error: {
            tag: "PermissionDenied",
            message: "Permission denied.",
            retryable: false,
            next: "check the path's read permissions, then run this command again.",
            details: { reason: "read", path: file },
          },
        });
      } else {
        expect(result.stderr).toContain("Permission denied.");
        expect(result.stderr).toContain(file);
        expect(result.stderr).toContain("Next:");
      }
      expect(readdirSync(home)).toEqual([]);
    } finally {
      chmodSync(file, 0o600);
    }
    expect(readFileSync(file, "utf8")).toBe("unreadable source\n");
  },
);

test.skipIf(process.getuid?.() === 0)(
  "a failed forced replacement keeps the old skill and leaves no staging files",
  async () => {
    const home = space.dir();
    const file = target(home);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "edited skill\n");
    chmodSync(dirname(file), 0o555);
    try {
      const result = await runCli(["skill", "install", "--force", "--json"], {
        home,
        env: quiet,
        host: { skill },
      });
      expect(result.status).toBe(6);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toMatchObject({ error: { tag: "PermissionDenied" } });
      expect(readFileSync(file, "utf8")).toBe("edited skill\n");
      expect(readdirSync(dirname(file))).toEqual(["SKILL.md"]);
    } finally {
      chmodSync(dirname(file), 0o755);
    }
  },
);

test.skipIf(process.getuid?.() === 0)(
  "an identical skill in a read-only directory is unchanged without writing",
  async () => {
    const home = space.dir();
    const file = target(home);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, { mode: 0o444 });
    chmodSync(dirname(file), 0o555);
    try {
      const result = await runCli(["skill", "install", "--json"], {
        home,
        env: quiet,
        host: { skill },
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(Schema.decodeUnknownSync(SkillResult)(JSON.parse(result.stdout))).toEqual(
        one(file, "unchanged"),
      );
      expect(readFileSync(file, "utf8")).toBe(text);
      expect(readdirSync(dirname(file))).toEqual(["SKILL.md"]);
    } finally {
      chmodSync(dirname(file), 0o755);
    }
  },
);

test.skipIf(process.getuid?.() === 0)(
  "a failed forced replacement of one stacks-author file rolls back the files written before it",
  async () => {
    const home = space.dir();
    const dir = join(home, ".claude/skills/stacks-author");
    const references = join(dir, "references");
    mkdirSync(references, { recursive: true });
    writeFileSync(join(references, "anatomy.md"), "my notes\n");
    chmodSync(references, 0o555);
    try {
      const result = await runCli(["skill", "install", "stacks-author", "--force", "--json"], {
        home,
        env: quiet,
        host: { skill },
      });
      expect(result.status).toBe(6);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toMatchObject({ error: { tag: "PermissionDenied" } });
    } finally {
      chmodSync(references, 0o755);
    }
    expect(readdirSync(dir)).toEqual(["references"]);
    expect(readdirSync(references)).toEqual(["anatomy.md"]);
    expect(readFileSync(join(references, "anatomy.md"), "utf8")).toBe("my notes\n");
  },
);
