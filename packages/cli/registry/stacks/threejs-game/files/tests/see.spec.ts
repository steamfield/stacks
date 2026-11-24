/**
 * Runs `bun run see` the way an agent would, against the build `bun run e2e` just made, and checks
 * the run folder it writes: frames, summary, state, events and the console log.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const ROOT = join(import.meta.dirname, "..");

test("see plays a scenario and writes frames, state and a PASSED summary", async () => {
  test.slow(true, "starts its own server and browser");
  const out = mkdtempSync(join(tmpdir(), "see-"));
  try {
    const run = spawnSync(
      process.execPath,
      ["scripts/see.ts", "--scenario", "collect-first-orb", "--at", "0,end", "--out", out],
      { cwd: ROOT, encoding: "utf8", timeout: 120_000 },
    );
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stdout.trim()).toBe(out);
    for (const file of [
      "frame-0.png",
      "frame-50.png",
      "state.json",
      "events.jsonl",
      "console.log",
    ]) {
      expect(existsSync(join(out, file)), file).toBe(true);
    }
    const summary = readFileSync(join(out, "summary.txt"), "utf8");
    expect(summary).toContain("PASSED");
    expect(summary).toContain('"orbs":"1/6"');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
