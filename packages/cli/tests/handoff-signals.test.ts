import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { MANIFEST_PATH } from "../src/core/project/manifest";
import { fakeAgent } from "./helpers/agents";
import { tempDir } from "./helpers/cli";
import { newRegistry } from "./helpers/registry";

const fixture = join(import.meta.dirname, "fixtures/handoff-bin.ts");

test("SIGTERM to stacks while the agent runs reaches the agent; stacks then stops with 130 [1.4#8]", async () => {
  const dir = tempDir();
  const bin = join(dir.path, "bin");
  const claude = fakeAgent(bin, "claude", "wait-for-sigterm");
  // As a shell starts a job: its own process group, so the test's signal reaches only it.
  const cli = spawn(
    "/bin/sh",
    // `--launch claude`: the PATH below keeps the real one for bun, which may hold other agents
    // that would bring up the picker (4.4c).
    [
      "-c",
      'exec bun "$@"',
      "sh",
      fixture,
      newRegistry,
      "new",
      "fixture-stack",
      "app",
      "--sandbox",
      "--launch",
      "claude",
    ],
    {
      cwd: dir.path,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: dir.path,
        XDG_CONFIG_HOME: join(dir.path, "config"),
        XDG_STATE_HOME: join(dir.path, "state"),
        LOG_LEVEL: "none",
        NO_COLOR: "1",
      },
    },
  );
  let stdout = "";
  cli.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  const closed = new Promise<number | null>((resolve, reject) => {
    cli.on("error", reject);
    cli.on("close", resolve);
  });
  try {
    await vi.waitFor(() => expect(existsSync(`${claude.bin}.ready`)).toBe(true), {
      timeout: 10000,
    });
    // The summary reached stdout before the agent took the terminal.
    expect(stdout).toContain(`Launching ${claude.bin} in app...`);
    process.kill(cli.pid as number, "SIGTERM");
    expect(await closed).toBe(130);
    expect(readFileSync(`${claude.bin}.SIGTERM`, "utf8")).toBe("yes");
    // The project was written before the launch, so the stop leaves it in place.
    expect(existsSync(join(dir.path, "app", MANIFEST_PATH))).toBe(true);
  } finally {
    try {
      process.kill(-(cli.pid as number), "SIGKILL");
    } catch {}
    dir.cleanup();
  }
}, 20000);
