import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { adapterWorkspace, nativeAgents, scaffoldAdapters } from "./helpers/native-adapters";
import { checkNativeFiles } from "./helpers/native-files";

const space = adapterWorkspace();
afterEach(() => space.cleanup());
test.each(nativeAgents)(
  "explicit %s selection beats an inherited agent marker and drops duplicates [3.4b#8]",
  async (agent) => {
    const result = await scaffoldAdapters({
      home: space.temp(),
      agents: [agent, agent],
      env: { CLAUDECODE: "1" },
    });
    expect(result.agents).toEqual([agent]);
    expect(result.handoff).toMatchObject({ kind: "inside-agent", agent: "claude" });
    checkNativeFiles(result);
  },
);

test("the agent table distinguishes enforcement, instructions and unproved runs [3.4b#10]", () => {
  const readme = readFileSync(join(import.meta.dirname, "../docs/agents.md"), "utf8");
  for (const agent of ["claude", ...nativeAgents]) {
    const row = readme
      .split("\n")
      .find((line) => line.startsWith("|") && new RegExp(`\\b${agent}\\b`, "i").test(line));
    expect(row, `${agent} table row`).toBeDefined();
    expect(row).toMatch(/enforced|instructions/i);
    if (agent === "opencode" || agent === "cursor")
      expect(row).toMatch(/unproved.*bench|bench.*unproved/i);
  }
});
