import { existsSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { agentPrompt } from "../src/core/handoff/render";
import { NO_INDEX_PROVENANCE } from "../src/core/project/provenance";
import { Registry } from "../src/core/registry/registry";
import { scaffold } from "../src/core/scaffold/new";
import { Output } from "../src/services/output";
import { fakeAgent } from "./helpers/agents";
import { quiet, runCli, tempDir } from "./helpers/cli";
import { newRegistry } from "./helpers/registry";

test("a scaffold preview records a printed handoff even with a harness ready to launch", async () => {
  const home = tempDir();
  try {
    const claude = fakeAgent(join(home.path, "bin"), "claude");
    const program = Effect.gen(function* () {
      const { result, decision, manifest } = yield* scaffold({
        stack: "fixture-stack",
        dir: "app",
        name: undefined,
        author: undefined,
        dryRun: true,
        with: [],
        without: [],
        sandbox: false,
        yes: false,
        agents: undefined,
        scope: undefined,
        handoff: {
          detected: "none",
          json: false,
          launch: true,
          stdinIsTTY: true,
          stdoutIsTTY: true,
          configured: ["claude"],
          found: new Map([["claude", claude.bin]]),
          prompt: agentPrompt("stacks"),
        },
        provenance: NO_INDEX_PROVENANCE,
      });
      yield* (yield* Output).result(
        {
          decision,
          handoff: manifest.handoff,
          dryRun: result.dryRun,
          stateRecord: result.stateRecord,
        },
        "",
      );
    }).pipe(Effect.provide(Registry.layer([{ origin: "bundled", path: newRegistry }])));
    const run = await runCli(["--json"], {
      home: home.path,
      env: { ...quiet, PATH: join(home.path, "bin"), XDG_STATE_HOME: join(home.path, "state") },
      program,
    });

    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toBe("");
    expect(JSON.parse(run.stdout)).toEqual({
      decision: { kind: "print", reason: "no-launch", untrusted: [] },
      handoff: { kind: "print", at: expect.any(String) },
      dryRun: true,
      stateRecord: false,
    });
    expect(existsSync(join(home.path, "app"))).toBe(false);
    expect(existsSync(join(home.path, "state"))).toBe(false);
  } finally {
    home.cleanup();
  }
});
