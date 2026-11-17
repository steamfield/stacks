import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit } from "effect";
import { afterEach, expect, test } from "vitest";
import { projectStateFor, replaceProjectState } from "../src/core/project/state";
import { tempDir } from "./helpers/cli";
import { manifest } from "./helpers/verify";

const directories: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) directory.cleanup();
});

test.each([false, true])(
  "state replacement is retained only when its scope succeeds (existing %s)",
  async (existing) => {
    for (const outcome of ["success", "failure", "interrupt"]) {
      const directory = tempDir();
      directories.push(directory);
      const target = join(directory.path, "record.json");
      const original = '{ "previous": true }\n';
      if (existing) writeFileSync(target, original);
      const controller = new AbortController();
      const state = projectStateFor(manifest([]), "/project/.stacks/manifest.json");
      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            yield* replaceProjectState(state, target);
            expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(state);
            if (outcome === "failure") return yield* Effect.fail("stop");
            if (outcome === "interrupt") {
              controller.abort();
              yield* Effect.never;
            }
          }),
        ).pipe(Effect.provide(NodeServices.layer)),
        { signal: controller.signal },
      );
      if (outcome === "success") {
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(state);
      } else {
        expect(Exit.isFailure(exit)).toBe(true);
        if (outcome === "interrupt")
          expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
        expect(existsSync(target)).toBe(existing);
        if (existing) expect(readFileSync(target, "utf8")).toBe(original);
      }
    }
  },
);
