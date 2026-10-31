import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit } from "effect";
import { expect, test } from "vitest";
import { skeleton } from "../src/core/create-text";
import { assemble } from "../src/core/submit/assemble";
import { tempDir } from "./helpers/cli";

test.skipIf(process.getuid?.() === 0)(
  "an unreadable nested source file reports a read denial at the entry",
  async () => {
    const temp = tempDir();
    const root = join(temp.path, "source");
    const dir = join(root, "stacks", "demo-app");
    const registry = join(temp.path, "assembly");
    const file = join(dir, "files", "README.md");
    mkdirSync(join(dir, "files"), { recursive: true });
    mkdirSync(registry);
    writeFileSync(
      join(dir, "STACK.md"),
      skeleton("stack", "demo-app", "ci").replace(
        /stacks:fill: describe the stack/,
        "The demo-app entry.",
      ),
    );
    writeFileSync(file, "source\n");
    chmodSync(file, 0o000);
    try {
      const exit = await Effect.runPromiseExit(
        assemble({
          registry,
          entries: [{ kind: "stack", id: "demo-app", root, dir }],
          login: "octo-author",
        }).pipe(Effect.provide(NodeServices.layer)),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      const failure = Exit.isFailure(exit)
        ? exit.cause.reasons.find(Cause.isFailReason)?.error
        : undefined;
      expect(failure).toMatchObject({
        _tag: "PermissionDenied",
        details: { reason: "read", path: dir },
      });
    } finally {
      chmodSync(file, 0o644);
      temp.cleanup();
    }
  },
);
