import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { binary, packageRoot, scratchPath } from "./package";

const bundledEntries = ["stacks", "fragments"]
  .flatMap((kind) => readdirSync(join(packageRoot, "registry", kind), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory()).length;
const bundledFiles = ["stacks", "fragments"]
  .flatMap((kind) =>
    readdirSync(join(packageRoot, "registry", kind), { recursive: true, withFileTypes: true }),
  )
  .filter((entry) => entry.isFile()).length;

function sample(args: readonly string[]) {
  const home = mkdtempSync(join(tmpdir(), "cli-binary-budget-"));
  try {
    const result = Bun.spawnSync([binary, ...args], {
      cwd: home,
      env: {
        HOME: home,
        XDG_CONFIG_HOME: join(home, "config"),
        XDG_STATE_HOME: join(home, "state"),
        LOG_LEVEL: "none",
        NO_COLOR: "1",
        PATH: scratchPath,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const { user, system } = result.resourceUsage.cpuTime;
    return {
      status: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      cpuSeconds: (Number(user) + Number(system)) / 1_000_000,
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test.each([
  {
    args: ["validate", "--brief", "typescript-cli"],
    output: "# Build",
    // Validating the whole registry for one preview cost 1.5 s on a laptop (~7 s on the slowest
    // gate host). The preview renders the stack's shipped files: since typescript-cli ships its
    // working slice it takes ~0.45 s on a laptop and 1.00-1.13 s on an idle m1 Linux gate host.
    budget: 1.5,
  },
  {
    args: ["validate"],
    output: "(bundled registry)",
    // Validating the bundled registry grows with its entries and with the files they ship, which
    // it reads to render and check every composition. Measured on the slowest gate host (an
    // m1 Linux machine, idle): 37 entries took 6.01 s with 504 shipped files and 7.45 s with
    // 904, so ~3.6 ms per file and ~0.11 s per entry. The budget is that cost with 1.5x headroom;
    // a laptop runs it in under half (3.43 s at 904 files).
    budget: 0.17 * bundledEntries + 0.0055 * bundledFiles,
  },
])(
  "$args stays within its CPU budget",
  ({ args, output, budget }) => {
    const samples: number[] = [];
    for (let run = 0; run < 3; run++) {
      const result = sample(args);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(output);
      expect(result.stderr).toBe("");
      expect(result.cpuSeconds).toBeGreaterThan(0);
      samples.push(result.cpuSeconds);
    }
    const cpuSeconds = Math.min(...samples);
    expect(
      cpuSeconds,
      `${args.join(" ")}: lowest CPU time ${cpuSeconds.toFixed(3)} s exceeds budget ${budget} s`,
    ).toBeLessThanOrEqual(budget);
  },
  60_000,
);
