import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { Effect, FileSystem } from "effect";
import { Command } from "effect/cli";
import { expect, test } from "vitest";
import { cli } from "../src/cli";
import { VERSION } from "../src/version";
import { quiet, runCli, tempDir } from "./helpers/cli";
import {
  envelope,
  runRecords,
  splitEvents,
  startedSteps,
  stateEnv,
  writeRecordedProject,
} from "./helpers/verify";

test("a teardown defect after interruption leaves no run record", async () => {
  const home = tempDir();
  const project = tempDir();
  try {
    const root = realpathSync(project.path);
    const check = join(root, "check");
    const teardown = join(root, "teardown");
    mkdirSync(check);
    mkdirSync(teardown);
    writeRecordedProject(root, realpathSync(home.path), [
      { name: "unit", run: "true", cwd: "check" },
      { name: "clean", phase: "teardown", run: "true", cwd: "teardown" },
    ]);

    const args = ["verify", "--json"];
    const program = Effect.gen(function* () {
      const live = yield* FileSystem.FileSystem;
      const faulty = FileSystem.make({
        ...live,
        realPath: (path) => {
          if (path === check) return Effect.interrupt;
          if (path === teardown) return Effect.die(new TypeError("teardown defect"));
          return live.realPath(path);
        },
      });
      yield* Command.runWith(cli, { version: VERSION, renderErrors: false })(args).pipe(
        Effect.provideService(FileSystem.FileSystem, faulty),
      );
    });
    const result = await runCli(args, {
      home: home.path,
      env: { PATH: process.env.PATH, ...quiet, ...stateEnv(home.path) },
      host: { cwd: root },
      program,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(startedSteps(result.stderr)).toEqual(["unit", "clean"]);
    expect(envelope(splitEvents(result.stderr).rest)).toMatchObject({
      error: { tag: "Defect", message: "An unexpected error occurred." },
    });
    expect(result.stderr).not.toContain("teardown defect");
    expect(runRecords(root)).toEqual([]);
  } finally {
    home.cleanup();
    project.cleanup();
  }
});
