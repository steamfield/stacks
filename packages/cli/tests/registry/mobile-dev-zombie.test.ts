import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { tempDir } from "../helpers/cli";
import { bundled } from "./helpers/bundled";

// Keep the member's parent outside its group so the test controls reaping instead
// of racing launchd. The leader is reaped before readiness is reported.
const zombieGroup = `
import os, sys
ready_r, ready_w = os.pipe()
exit_r, exit_w = os.pipe()
leader = os.fork()
if leader == 0:
    os.setpgid(0, 0)
    os.write(ready_w, b"1")
    os.read(exit_r, 1)
    os._exit(0)
os.read(ready_r, 1)
member = os.fork()
if member == 0:
    os.setpgid(0, leader)
    os.write(ready_w, b"1")
    os._exit(0)
os.read(ready_r, 1)
os.write(exit_w, b"1")
os.waitpid(leader, 0)
try:
    print(str(leader) + " " + str(member), flush=True)
    sys.stdin.read()
finally:
    os.waitpid(member, 0)
`;

test.runIf(process.platform === "darwin").each([0, "SIGTERM", "SIGKILL"] as const)(
  "mobile dev tolerates %s while only a zombie remains in its group (macOS)",
  async (signal) => {
    const dir = tempDir();
    const controller = spawn("python3", ["-c", zombieGroup], { stdio: "pipe" });
    const finished = new Promise<void>((resolve, reject) => {
      controller.once("error", reject);
      controller.once("close", () => resolve());
    });
    let output = "";
    let errors = "";
    controller.stdout.on("data", (data) => {
      output += data.toString();
    });
    controller.stderr.on("data", (data) => {
      errors += data.toString();
    });
    try {
      await vi.waitFor(() => expect(output, errors).toMatch(/^\d+ \d+\n$/), { timeout: 5000 });
      const [leader, member] = output.trim().split(" ").map(Number);
      if (!leader || !member) throw new Error("Missing fixture pids");
      await vi.waitFor(
        () => {
          const state = spawnSync("ps", ["-o", "stat=", "-p", String(member)], {
            encoding: "utf8",
            timeout: 5000,
          });
          expect(state.status, state.stderr).toBe(0);
          expect(state.stdout.trim()).toMatch(/^Z/);
        },
        { timeout: 5000 },
      );
      // Confirm this is the OS state behind the flake, not an ordinary live group.
      expect(() => process.kill(-leader, 0)).toThrow(expect.objectContaining({ code: "EPERM" }));

      const source = readFileSync(join(bundled, "stacks/mobile-expo/files/scripts/dev.ts"), "utf8");
      // Exercise the shipped function under Bun without adding a production export
      // or starting databases and apps from main().
      expect(source).toMatch(/\nawait main\(\);\s*$/);
      const probe = join(dir.path, "probe.ts");
      writeFileSync(
        probe,
        source.replace(
          /\nawait main\(\);\s*$/,
          `\nconsole.log(signalGroup(Number(process.argv[2]), ${JSON.stringify(signal)}));\n`,
        ),
      );
      const check = () =>
        spawnSync("bun", [probe, String(leader)], {
          encoding: "utf8",
          timeout: 5000,
        });
      const zombie = check();
      expect(zombie.error).toBeUndefined();
      expect(zombie.status, zombie.stderr).toBe(0);
      expect(zombie.stderr).toBe("");
      expect(zombie.stdout).toBe("true\n");

      controller.stdin.end();
      await finished;
      expect(controller.exitCode, errors).toBe(0);
      const reaped = check();
      expect(reaped.error).toBeUndefined();
      expect(reaped.status, reaped.stderr).toBe(0);
      expect(reaped.stderr).toBe("");
      expect(reaped.stdout).toBe("false\n");
    } finally {
      controller.stdin.end();
      await finished;
      dir.cleanup();
    }
  },
  15_000,
);
