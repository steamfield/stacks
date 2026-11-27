import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { Schema } from "effect";
import { expect } from "vitest";
import { NewResult } from "../../src/schemas/new";
import { quiet, runCli, tempDir } from "./cli";
import { gitShim } from "./git";

export const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const sha256 = (text: string | Buffer) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;

/** File bytes and modes, so unexpected changes to existing files fail as well as new files. */
export function snapshot(root: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((file) => file.isFile() || file.isSymbolicLink())
      .map((file) => {
        const path = join(file.parentPath, file.name);
        return [
          relative(root, path),
          file.isSymbolicLink()
            ? `link:${readlinkSync(path)}`
            : `${statSync(path).mode}:${sha256(readFileSync(path))}`,
        ];
      }),
  );
}
export function compositionWorkspace(bundled: string, tools: readonly string[]) {
  // One HOME and recording PATH for the whole file. Tools are discoverable but fail if executed;
  // only the CLI's constant git calls delegate to real git, including real git init.
  // Keep git off PATH for previews: they need neither a repository nor author discovery.
  const temp = tempDir();
  const home = temp.path;
  const calls = join(home, "calls");
  const reset = () => writeFileSync(calls, "");
  const realGit = execFileSync("/bin/sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const bin = gitShim(
    home,
    `  *) printf 'git %s\\n' "$*" >> ${quote(calls)}; exec ${quote(realGit)} "$@" ;;`,
  );
  const recordingGit = join(home, "recording-git");
  renameSync(join(bin, "git"), recordingGit);
  for (const tool of new Set([...tools, "curl", "npm", "npx", "bunx", "claude", "codex"])) {
    if (tool === "git") continue;
    const path = join(bin, tool);
    writeFileSync(path, `#!/bin/sh\nprintf '${tool} %s\\n' "$*" >> ${quote(calls)}\nexit 93\n`);
    chmodSync(path, 0o755);
  }
  const env = {
    ...quiet,
    PATH: bin,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
    XDG_STATE_HOME: join(home, "state"),
    XDG_CACHE_HOME: join(home, "cache"),
  };

  async function withGit<A>(program: () => Promise<A>): Promise<A> {
    const git = join(bin, "git");
    symlinkSync(recordingGit, git);
    try {
      return await program();
    } finally {
      rmSync(git);
    }
  }

  function cli(args: string[], registry = bundled, cwd = home, extraEnv = {}) {
    return runCli(args, { home, env: { ...env, ...extraEnv }, host: { registry, cwd } });
  }
  function success(run: Awaited<ReturnType<typeof runCli>>) {
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    return Schema.decodeUnknownSync(NewResult)(JSON.parse(run.stdout), {
      onExcessProperty: "error",
    });
  }
  function gitCallsOnly() {
    const lines = existsSync(calls)
      ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean)
      : [];
    expect(
      lines.filter(
        (line) =>
          ![
            "git rev-parse --show-toplevel",
            "git rev-parse --verify --quiet HEAD",
            "git init --quiet",
            "git config user.name",
          ].includes(line),
      ),
    ).toEqual([]);
  }
  async function scaffold(stack: string, dir: string, flags: string[] = [], registry = bundled) {
    const run = () =>
      cli(
        ["new", stack, dir, "--no-launch", "--json", "--author", "", "--name", "matrix", ...flags],
        registry,
      );
    return success(await (flags.includes("--dry-run") ? run() : withGit(run)));
  }
  return {
    home,
    cli,
    scaffold,
    success,
    withGit,
    gitCallsOnly,
    reset,
    cleanup: temp.cleanup,
  };
}
