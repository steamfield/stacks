/**
 * `bun run see` end to end: runs the script once against the build, as an agent would, and checks
 * the run folder it reports. Desktop project only; it starts its own server and browser.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test("see plays a scenario and writes frames, summary, state, events and console", async () => {
  test.slow(true, "starts a second server and browser");
  const out = test.info().outputPath("see-run");
  const result = spawnSync(
    process.execPath,
    ["scripts/see.ts", "--scenario", "collect-first-coin", "--at", "0,end", "--out", out],
    { encoding: "utf8", timeout: 90_000 },
  );

  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`run: ${out}`);
  expect(result.stdout).toContain("renderer: webgl");
  expect(result.stdout).toContain("scenario collect-first-coin: PASSED");
  for (const file of [
    "frame-0.png",
    "frame-123.png",
    "summary.txt",
    "state.json",
    "events.jsonl",
  ]) {
    expect(existsSync(join(out, file)), file).toBe(true);
  }
  const state = JSON.parse(readFileSync(join(out, "state.json"), "utf8")) as { scene: string };
  expect(state.scene).toBe("play");
});

test("see names the known scenarios when asked for one that doesn't exist", () => {
  const result = spawnSync(process.execPath, ["scripts/see.ts", "--scenario", "nowhere"], {
    encoding: "utf8",
  });

  expect(result.status).toBe(2);
  expect(result.stderr).toContain('No scenario "nowhere". Known: collect-first-coin');
});
