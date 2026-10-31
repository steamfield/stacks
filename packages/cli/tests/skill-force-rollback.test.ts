import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { ErrorEnvelope } from "../src/errors";
import { SkillResult } from "../src/schemas/skill";
import { quiet, runCli } from "./helpers/cli";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

test.skipIf(process.getuid?.() === 0)(
  "a failed second forced replacement restores the first file's original bytes",
  async () => {
    const home = realpathSync(space.dir());
    const alias = join(space.dir(), "linked-home");
    symlinkSync(home, alias);
    const source = space.dir();
    const skillSource = join(source, "stacks");
    mkdirSync(join(skillSource, "reference"), { recursive: true });
    writeFileSync(join(skillSource, "SKILL.md"), "new skill\n");
    writeFileSync(join(skillSource, "reference", "notes.md"), "new notes\n");

    const installed = join(home, ".claude", "skills", "stacks");
    const first = join(installed, "SKILL.md");
    const second = join(installed, "reference", "notes.md");
    mkdirSync(dirname(second), { recursive: true });
    writeFileSync(first, "original skill\n");
    writeFileSync(second, "original notes\n");
    chmodSync(dirname(second), 0o555);
    try {
      const result = await runCli(["skill", "install", "--force", "--json"], {
        home: alias,
        host: { cwd: alias, skill: source },
        env: quiet,
      });
      expect(result.status).toBe(6);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
      expect(
        Schema.decodeUnknownSync(ErrorEnvelope, { onExcessProperty: "error" })(
          JSON.parse(result.stderr),
        ).error,
      ).toMatchObject({
        tag: "PermissionDenied",
        details: { reason: "unwritable", path: second },
      });
      expect(readFileSync(first, "utf8")).toBe("original skill\n");
      expect(readFileSync(second, "utf8")).toBe("original notes\n");
      expect(readdirSync(installed).sort()).toEqual(["SKILL.md", "reference"]);
    } finally {
      chmodSync(dirname(second), 0o755);
    }
  },
);

test("a forced replacement retains the existing file mode", async () => {
  const home = space.dir();
  const source = space.dir();
  const skillSource = join(source, "stacks");
  mkdirSync(skillSource);
  writeFileSync(join(skillSource, "SKILL.md"), "new skill\n");
  const first = join(home, ".claude", "skills", "stacks", "SKILL.md");
  mkdirSync(dirname(first), { recursive: true });
  writeFileSync(first, "original skill\n", { mode: 0o640 });
  chmodSync(first, 0o640);
  const result = await runCli(["skill", "install", "--force", "--json"], {
    home,
    host: { cwd: home, skill: source },
    env: quiet,
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(
    Schema.decodeUnknownSync(SkillResult, { onExcessProperty: "error" })(JSON.parse(result.stdout)),
  ).toMatchObject({
    name: "stacks",
    action: "written",
    files: [{ path: "SKILL.md", action: "written" }],
  });
  expect(readFileSync(first, "utf8")).toBe("new skill\n");
  expect(statSync(first).mode & 0o777).toBe(0o640);
});
