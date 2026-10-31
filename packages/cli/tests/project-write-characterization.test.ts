import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit } from "effect";
import { afterEach, expect, test } from "vitest";
import { openProject } from "../src/core/scaffold/write";
import { tempDir } from "./helpers/cli";

const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});

test("rollback keeps a foreign file in a directory the writer created and preserves the failure", async () => {
  const dir = tempDir();
  dirs.push(dir);
  const target = join(dir.path, "project");
  mkdirSync(target);
  const foreign = join(target, "created", "foreign.txt");
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const writer = yield* openProject(target);
        yield* writer.directory("created");
        yield* Effect.sync(() => writeFileSync(foreign, "another process wrote this\n"));
        return yield* Effect.fail("scope failed");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(exit.cause.reasons.find(Cause.isFailReason)?.error).toBe("scope failed");
  }
  expect(existsSync(join(target, "created"))).toBe(true);
  expect(readFileSync(foreign, "utf8")).toBe("another process wrote this\n");
});
