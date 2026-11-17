import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Manifest } from "@steamfield/stacks-format";
import { RunRecord } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { digestSteps, encodeManifest, MANIFEST_PATH } from "../src/core/project/manifest";
import { VerifyResult } from "../src/schemas/verify";

import { binary, node, npmCli, scratchPath, tarball } from "./package";

const unsigned: Manifest = {
  schemaVersion: 1,
  projectId: "0f8fad5b-d9cb-469f-a165-70867728950e",
  createdAt: "2026-10-26T09:00:00.000Z",
  cli: "0.0.0",
  mode: "new",
  preset: "default",
  agents: ["claude"],
  stack: { id: "fixture-stack", origin: "bundled", trusted: true },
  fragments: [],
  env: {},
  commands: {},
  verify: [
    {
      name: "lint",
      phase: "check",
      run: "echo lint-ok",
      owner: "fixture-stack",
      skipByDefault: false,
    },
    {
      name: "test",
      phase: "check",
      run: "echo test-broke; exit 1",
      owner: "fixture-stack",
      skipByDefault: false,
    },
    {
      name: "clean",
      phase: "teardown",
      run: "touch torn",
      owner: "fixture-stack",
      skipByDefault: false,
    },
  ],
  verifyDigest: "",
  briefWords: 0,
};
/** The fixture with the digest `new` would have recorded for its steps. */
const project: Manifest = { ...unsigned, verifyDigest: digestSteps(unsigned) };

test("one SIGINT through npm exec records interruption and runs teardown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stacks-npm-signal-"));
  const manifest = {
    ...unsigned,
    verify: [
      {
        ...unsigned.verify[0],
        name: "wait",
        phase: "check",
        run: "touch ready; sleep 60",
        owner: "fixture-stack",
        skipByDefault: false,
      },
      {
        ...unsigned.verify[2],
        name: "clean",
        phase: "teardown",
        run: "touch torn",
        owner: "fixture-stack",
        skipByDefault: false,
      },
    ],
  } satisfies Manifest;
  mkdirSync(join(dir, ".stacks"));
  writeFileSync(
    join(dir, MANIFEST_PATH),
    encodeManifest({ ...manifest, verifyDigest: digestSteps(manifest) }),
  );
  const child = spawn(
    node,
    [
      npmCli,
      "exec",
      "--offline",
      "--yes",
      "--package",
      tarball,
      "--",
      "stacks",
      "verify",
      "--json",
    ],
    {
      cwd: dir,
      detached: true,
      env: {
        HOME: dir,
        PATH: scratchPath,
        LOG_LEVEL: "none",
        npm_config_cache: join(dir, "cache"),
        npm_config_update_notifier: "false",
        npm_config_loglevel: "silent",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    },
  );
  try {
    const deadline = Date.now() + 15_000;
    while (!existsSync(join(dir, "ready"))) {
      if (child.exitCode !== null || Date.now() >= deadline)
        throw new Error(`npm exec never started verify: ${stderr}`);
      await Bun.sleep(20);
    }
    if (child.pid === undefined) throw new Error("npm exec has no pid");
    process.kill(-child.pid, "SIGINT");
    // npm runs the bin under `sh -c`. macOS's sh execs it, so npm passes on the CLI's 130; dash
    // (Linux) stays the parent, dies from the group's SIGINT, and npm re-raises SIGINT on itself.
    const status = await exited;
    const interrupted: (typeof status)[] = [
      { code: 130, signal: null },
      { code: null, signal: "SIGINT" },
    ];
    expect(interrupted).toContainEqual(status);
    expect(stdout).toBe("");
    expect(stderr.trim().split("\n").at(-1)).toContain('"tag":"Interrupted"');
    expect(existsSync(join(dir, "torn"))).toBe(true);
    const record = Schema.decodeUnknownSync(RunRecord)(
      JSON.parse(readFileSync(join(dir, ".stacks/state/runs.jsonl"), "utf8").trim()),
    );
    expect(record.outcome).toBe("interrupted");
  } finally {
    // A process killed by a signal also has a null exitCode, so its group may already be gone.
    if (child.exitCode === null && child.signalCode === null && child.pid !== undefined)
      process.kill(-child.pid, "SIGKILL");
    await exited;
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

describe("verify from the real binary", () => {
  test("one passing and one failing step exit 5 with the result on stdout [1.3a#21]", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-binary-verify-"));
    try {
      const root = join(dir, "app");
      mkdirSync(join(root, ".stacks"), { recursive: true });
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, MANIFEST_PATH), encodeManifest(project));
      const child = Bun.spawn([binary, "verify", "--json"], {
        cwd: join(root, "src"),
        env: {
          HOME: dir,
          XDG_CONFIG_HOME: join(dir, "config"),
          LOG_LEVEL: "none",
          NO_COLOR: "1",
          PATH: scratchPath,
          CLAUDECODE: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(status).toBe(5);
      const result = Schema.decodeUnknownSync(VerifyResult)(JSON.parse(stdout), {
        onExcessProperty: "error",
      });
      expect(result.outcome).toBe("failed");
      expect(result.steps.map((s) => [s.name, s.status])).toEqual([
        ["lint", "passed"],
        ["test", "failed"],
        ["clean", "passed"],
      ]);
      expect(result.steps.find((s) => s.name === "test")?.outputTail).toContain("test-broke");
      expect(existsSync(join(root, "torn"))).toBe(true);
      expect(JSON.parse(stderr.trim().split("\n").at(-1) ?? "")).toEqual({
        error: {
          tag: "VerifyFailed",
          message: "Verify failed.",
          retryable: false,
          next: "fix the code or config these steps exercise, not the steps, then run stacks verify again.",
          details: { failed: [{ name: "test", failureKind: "step", exitCode: 1 }] },
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an edited step fails VerifyChanged with exit 5, running nothing [1.3b#14]", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-binary-verify-"));
    try {
      const root = join(dir, "app");
      mkdirSync(join(root, ".stacks"), { recursive: true });
      const edited = {
        ...project,
        verify: project.verify.map((step) =>
          step.name === "test" ? { ...step, run: "true" } : step,
        ),
      };
      writeFileSync(join(root, MANIFEST_PATH), encodeManifest(edited));
      const child = Bun.spawn([binary, "verify", "--json"], {
        cwd: root,
        env: {
          HOME: dir,
          XDG_CONFIG_HOME: join(dir, "config"),
          XDG_STATE_HOME: join(dir, "state"),
          LOG_LEVEL: "none",
          NO_COLOR: "1",
          PATH: scratchPath,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(status).toBe(5);
      const result = Schema.decodeUnknownSync(VerifyResult)(JSON.parse(stdout), {
        onExcessProperty: "error",
      });
      expect(result.outcome).toBe("changed");
      expect(result.tamperCheck).toBe("manifest-only");
      expect(existsSync(join(root, "torn"))).toBe(false);
      expect(JSON.parse(stderr.trim().split("\n").at(-1) ?? "")).toMatchObject({
        error: { tag: "VerifyChanged", details: { against: "manifest", reason: "digest" } },
      });
      expect(existsSync(join(root, ".stacks", "state", "runs.jsonl"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
