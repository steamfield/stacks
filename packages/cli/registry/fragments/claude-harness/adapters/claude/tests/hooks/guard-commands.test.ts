import { spawnSync } from "node:child_process";
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bash, denyReason, makeFixture, runHook } from "../helpers/hooks";

describe("shared package manager guard", () => {
  it.each(["npm install", "pnpm add a", "yarn", "npm ci"])("denies %s", async (command) => {
    expect(denyReason(await runHook("PreToolUse", "block-destructive", bash(command)))).toContain(
      "bun owns",
    );
  });
  it.each(["bun install", "npm view effect", "git commit -m 'npm install'", "echo 'pnpm add a'"])(
    "allows %s",
    async (command) => {
      expect(
        denyReason(await runHook("PreToolUse", "block-destructive", bash(command))),
      ).toBeUndefined();
    },
  );
});

describe("package manager guard follows the project's lockfile", () => {
  const withLockfile = async (lockfile: string, command: string) => {
    const project = makeFixture();
    try {
      writeFileSync(join(project.dir, lockfile), "");
      return denyReason(
        await runHook("PreToolUse", "block-destructive", bash(command), {
          cwd: project.dir,
          env: { CLAUDE_PROJECT_DIR: project.dir },
        }),
      );
    } finally {
      project.cleanup();
    }
  };
  it.each([
    ["pnpm-lock.yaml", "npm install", "pnpm owns"],
    ["pnpm-lock.yaml", "bun add zod", "pnpm owns"],
    ["package-lock.json", "pnpm add zod", "npm owns"],
    ["bun.lock", "yarn", "bun owns"],
  ])("with %s denies %s", async (lockfile, command, reason) => {
    expect(await withLockfile(lockfile, command)).toContain(reason);
  });
  it.each([
    ["pnpm-lock.yaml", "pnpm install"],
    ["package-lock.json", "npm ci"],
    ["bun.lock", "bun add zod"],
  ])("with %s allows %s", async (lockfile, command) => {
    expect(await withLockfile(lockfile, command)).toBeUndefined();
  });
});

describe("git and release commands only count where they run", () => {
  it.each([
    'git commit -m "docs: explain git reset --hard and git push --force"',
    "git commit -m 'chore: never git push --mirror from here'",
    'gh pr create --title x --body "run git push -f after rebase"',
    "git commit -F - <<'EOF'\nfix: guard\n\ngit reset --hard origin/main drops commits\nEOF",
    "git push --force-with-lease origin main",
    "git push --force-if-includes --force-with-lease origin main",
    "git push origin HEAD:main",
    "git push -u origin feature",
    "git checkout -b feature",
    "terraform plan",
    "kubectl get pods",
    "aws s3 ls s3://bucket --recursive",
  ])("allows %s", async (command) => {
    const result = await runHook("PreToolUse", "block-destructive", bash(command));
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
  });
});

const destructive = [
  'printf ok && r"m" -rf /',
  "env X=1 sudo -u root rm -rf /tmp/outside",
  "rm -r ../outside",
  'echo "$(rm -rf /)"',
  "echo `rm -rf /`",
  "(rm -rf /)",
  "true | rm -rf /",
  "r\\m -rf /",
  'sh -c "rm -rf /"',
  "git push --force origin main",
  "git push origin +HEAD:refs/heads/master",
  "git push --mirror",
  "git push origin --delete old",
  "git push -d origin old",
  "git push origin :old",
  "git checkout -f main",
  "git switch --discard-changes main",
  "terraform destroy",
  "tofu apply -auto-approve -destroy",
  "kubectl delete namespace prod",
  "aws s3 rm s3://bucket --recursive",
  "git filter-branch --all",
  "git rebase -i HEAD~2",
  "git reflog expire --expire=now --all",
  "dd if=/dev/zero of=/dev/disk2",
  "mkfs.ext4 /dev/sda",
  "printf x > /dev/sda",
];

describe("destructive command guard through the wired shell entry", () => {
  it.each(destructive)("denies %s with one JSON response", async (command) => {
    const result = await runHook("PreToolUse", "block-destructive", bash(command));
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(denyReason(result)).toBeDefined();
  });
  it.each(destructive)("allows a quoted mention of %s", async (command) => {
    const quoted = `'${command.replaceAll("'", "'\\''")}'`;
    const result = await runHook("PreToolUse", "block-destructive", bash(`echo ${quoted}`));
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
  });
  it.each([
    "rm -rf build",
    "git push origin feature",
    "git log",
    "dd if=input of=output",
    "cat <<'EOF'\nrm -rf /\nEOF",
  ])("allows %s", async (command) => {
    const result = await runHook("PreToolUse", "block-destructive", bash(command));
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
  });
  it("checks hard reset against the selected repository without changing it", async () => {
    const project = makeFixture();
    try {
      const git = (args: string[]) => {
        const result = spawnSync("git", args, { cwd: project.dir, encoding: "utf8" });
        expect(result.status, result.stderr).toBe(0);
      };
      git(["init", "--quiet"]);
      writeFileSync(join(project.dir, ".gitignore"), "node_modules/\n");
      git(["add", ".gitignore"]);
      const commit = (subject: string) =>
        git([
          "-c",
          "user.name=Hooks",
          "-c",
          "user.email=hooks@example.test",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "--allow-empty",
          "-qm",
          subject,
        ]);
      commit("first");
      commit("second");
      const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: project.dir, encoding: "utf8" });
      const command = `git -C '${project.dir}' reset --hard`;
      for (const target of ["", " HEAD", ` ${head.stdout.trim()}`]) {
        const clean = await runHook("PreToolUse", "block-destructive", bash(command + target));
        expect(clean.code).toBe(0);
        expect(clean.stderr).toBe("");
        expect(clean.stdout).toBe("");
      }
      for (const target of [" HEAD~1", " origin/main"]) {
        const moved = await runHook("PreToolUse", "block-destructive", bash(command + target));
        expect(moved.code).toBe(0);
        expect(denyReason(moved)).toContain("another commit");
      }
      writeFileSync(join(project.dir, "unfinished.txt"), "work\n");
      const dirty = await runHook("PreToolUse", "block-destructive", bash(command));
      expect(dirty.code).toBe(0);
      expect(dirty.stderr).toBe("");
      expect(denyReason(dirty)).toContain("uncommitted");
    } finally {
      project.cleanup();
    }
  });
  it("fails closed when path inspection throws", async () => {
    const project = makeFixture();
    try {
      symlinkSync("loop", join(project.dir, "loop"));
      const result = await runHook("PreToolUse", "block-destructive", bash("rm -rf loop/out"), {
        cwd: project.dir,
        env: { CLAUDE_PROJECT_DIR: project.dir },
      });
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.trim().split("\n")).toHaveLength(1);
      expect(denyReason(result)).toContain("could not inspect");
    } finally {
      project.cleanup();
    }
  });
});
