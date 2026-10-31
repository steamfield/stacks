import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { CliRunner } from "../src/run";
import { fakeCli, runnerLayer, tempDir } from "./helpers/cli";

it.effect("an unspawnable Node executable tells the caller which runtime to restore", () =>
  Effect.gen(function* () {
    const root = tempDir();
    const node = join(root, "missing-node");
    const entry = fakeCli(root, "");
    const error = yield* Effect.gen(function* () {
      const runner = yield* CliRunner;
      return yield* Effect.flip(runner.run([]));
    }).pipe(Effect.provide(runnerLayer(entry, { node })));
    expect(error.tag).toBe("CliUnavailable");
    expect(error.next).toContain(node);
    expect(error.next).toMatch(/check|restore/i);
    expect(error.next).toMatch(/restart/i);
  }),
);
