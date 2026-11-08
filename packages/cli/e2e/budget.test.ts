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

// Lowest CPU time of three runs, measured once per command and shared by the tests that need it.
const lowest = new Map<string, number>();
function lowestCpu(args: readonly string[], output: string) {
  const key = args.join(" ");
  const known = lowest.get(key);
  if (known !== undefined) return known;
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
  lowest.set(key, cpuSeconds);
  return cpuSeconds;
}

const validate = ["validate"];
const validateOutput = "(bundled registry)";

test("validate stays within its CPU budget", () => {
  // Validating the bundled registry grows with its entries and with the files they ship, which
  // it reads to render and check every composition. Measured on the slowest gate host (an
  // m1 Linux machine, idle): 37 entries took 6.01 s with 504 shipped files and 7.45 s with
  // 904, so ~3.6 ms per file and ~0.11 s per entry. The budget is that cost with 1.5x headroom;
  // a laptop runs it in under half (3.43 s at 904 files).
  const budget = 0.17 * bundledEntries + 0.0055 * bundledFiles;
  const cpuSeconds = lowestCpu(validate, validateOutput);
  expect(
    cpuSeconds,
    `validate: lowest CPU time ${cpuSeconds.toFixed(3)} s exceeds budget ${budget} s`,
  ).toBeLessThanOrEqual(budget);
}, 60_000);

test("validate --brief typescript-cli costs a small fraction of validating the registry", () => {
  // The preview renders one stack's shipped files; validating the whole registry for it was the
  // regression this guards (its cost then approaches a full validate). Measured on the same host,
  // so runner speed cancels out: the preview took 0.07x of a full validate on a laptop
  // (0.67 s of 9.2 s at 65 entries and 2,194 files) and 0.14x on the m1 Linux gate host
  // (1.07 s of 7.45 s at 904 files).
  // An absolute 1.5 s budget sized on that host failed GitHub's runners at 1.57 s.
  const ratio = 0.3;
  const brief = lowestCpu(["validate", "--brief", "typescript-cli"], "# Build");
  const full = lowestCpu(validate, validateOutput);
  expect(
    brief,
    `validate --brief: lowest CPU time ${brief.toFixed(3)} s exceeds ${ratio}x of validate's ${full.toFixed(3)} s`,
  ).toBeLessThanOrEqual(ratio * full);
}, 90_000);
