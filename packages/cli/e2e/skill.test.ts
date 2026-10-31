import { expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { binary, packageRoot, scratchPath } from "./package";

const source = join(import.meta.dir, "../skills/stacks/SKILL.md");
async function print(executable: string, home: string) {
  const child = Bun.spawn([executable, "skill", "install", "--print"], {
    cwd: home,
    env: {
      HOME: home,
      XDG_CONFIG_HOME: join(home, "config"),
      NO_COLOR: "1",
      LOG_LEVEL: "none",
      PATH: scratchPath,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { status, stdout, stderr };
}

test("the installed package finds skills/ beside dist/, including after relocation [3.4c#10]", async () => {
  const root = mkdtempSync(join(tmpdir(), "stacks-skill-binary-"));
  try {
    const home = join(root, "unrelated cwd");
    mkdirSync(home);
    const built = await print(binary, home);
    expect(built.status).toBe(0);
    expect(built.stderr).toBe("");
    expect(built.stdout).toBe(readFileSync(source, "utf8"));
    expect(existsSync(join(home, ".claude"))).toBe(false);

    // Distinguishable bytes prove lookup follows the executable, not a build-time source path.
    const prefix = join(root, "relocated package");
    mkdirSync(join(prefix, "dist"), { recursive: true });
    mkdirSync(join(prefix, "skills", "stacks"), { recursive: true });
    const relocated = join(prefix, "dist", "stacks");
    copyFileSync(binary, relocated);
    copyFileSync(join(packageRoot, "dist/cli.mjs"), join(prefix, "dist/cli.mjs"));
    chmodSync(relocated, 0o755);
    const text = `${readFileSync(source, "utf8")}\nRelocated asset marker.\n`;
    writeFileSync(join(prefix, "skills", "stacks", "SKILL.md"), text);
    expect(await print(relocated, home)).toEqual({ status: 0, stdout: text, stderr: "" });
    expect(existsSync(join(home, ".claude"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the installed package copies every stacks-author reference", async () => {
  const home = mkdtempSync(join(tmpdir(), "stacks-author-binary-"));
  try {
    const child = Bun.spawn([binary, "skill", "install", "stacks-author", "--json"], {
      cwd: home,
      env: {
        HOME: home,
        XDG_CONFIG_HOME: join(home, "config"),
        NO_COLOR: "1",
        LOG_LEVEL: "none",
        PATH: scratchPath,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(status).toBe(0);
    expect(stderr).toBe("");

    const source = join(packageRoot, "skills", "stacks-author");
    const installed = join(home, ".claude", "skills", "stacks-author");
    const references = readdirSync(join(source, "references")).sort();
    expect(references.length).toBeGreaterThan(0);
    const files = ["SKILL.md", ...references.map((name) => `references/${name}`)];
    expect(JSON.parse(stdout).files.map((file: { path: string }) => file.path)).toEqual(files);
    for (const file of files) {
      expect(readFileSync(join(installed, file))).toEqual(readFileSync(join(source, file)));
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
