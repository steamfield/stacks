import { afterEach, expect, test } from "vitest";
import {
  adapterWorkspace,
  guardCommands,
  runGuard,
  scaffoldAdapters,
} from "./helpers/native-adapters";

const space = adapterWorkspace();
afterEach(() => space.cleanup());

test("a missing guard allows a large payload without a stdin transport failure", async () => {
  const scaffold = await scaffoldAdapters({ home: space.temp(), agents: ["codex"] });
  const commands = guardCommands(scaffold.project, "codex", "Bash");
  expect(commands).toHaveLength(1);
  const result = runGuard({
    project: space.temp(),
    agent: "codex",
    command: commands[0] ?? "",
    payload: {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "echo ".repeat(200_000) },
    },
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim().split("\n")).toHaveLength(1);
  expect(result.stderr).toContain("block-destructive.sh not found");
});
