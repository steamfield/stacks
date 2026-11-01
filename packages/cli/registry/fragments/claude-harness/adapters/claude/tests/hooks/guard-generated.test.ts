import { describe, expect, it } from "vitest";
import { denyReason, runHook, write } from "../helpers/hooks";

// Every case spawns the hook as a real process; under load that outlasts Vitest's 5 s default.
describe("shared generated-output guard", { timeout: 30_000 }, () => {
  it.each(["dist/program", "build/index.js", "coverage/index.html", "bun.lock"])(
    "denies %s",
    async (path) => {
      expect(
        denyReason(await runHook("PreToolUse", "guard-generated", write(path, "x"))),
      ).toBeDefined();
    },
  );
  it.each(["src/build/helper.ts", "src/index.ts", "/outside/dist/program"])(
    "allows %s",
    async (path) => {
      expect(
        denyReason(await runHook("PreToolUse", "guard-generated", write(path, "x"))),
      ).toBeUndefined();
    },
  );
});
