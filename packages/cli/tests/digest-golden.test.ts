import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Exit } from "effect";
import { afterEach, expect, test } from "vitest";
import { fingerprint } from "../src/core/fingerprint";
import { type DigestInput, digestSettings, digestStep, digestSteps } from "../src/core/manifest";
import { searchSourceDigest } from "../src/core/search/digest";
import { tempDir } from "./helpers/cli";
import { bundledAt, composeExit } from "./helpers/compose";
import { minimal, writeEntry } from "./helpers/registry";

const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});

test("manifest digests retain their canonical bytes", () => {
  const step = {
    name: "check",
    run: "bun test",
    phase: "check",
    owner: "golden",
    skipByDefault: false,
  } as const;
  const manifest = {
    verify: [step],
    env: { ZONE: "test", MODE: "safe" },
    preset: "sandbox",
  } satisfies DigestInput;
  expect(digestSteps(manifest)).toBe(
    "sha256:f3158119e371e215b215dc09f3460cc600409dee4183c899043fe9c575c0fb60",
  );
  expect(digestStep(step)).toBe(
    "sha256:218118b66335ba8d910ac8470915bd5f8fa5acbe40b050195e2c9bc3417616c1",
  );
  expect(digestSettings(manifest)).toBe(
    "sha256:06c24a88a87c9706366763fc74761c8c4ac012f083610ef28d9961b2ce6bd16b",
  );
});

test("composition and search digests retain their framed bytes", async () => {
  const dir = tempDir();
  dirs.push(dir);
  const root = join(dir.path, "registry");
  const stack = writeEntry({
    root,
    kind: "stack",
    dir: "golden",
    frontmatter: minimal("stack", "golden"),
    body: "# Fixed guidance\n",
  });
  mkdirSync(join(stack, "files"));
  writeFileSync(join(stack, "files", "README.md"), "fixed bytes\n");
  const result = await composeExit(
    { stack: "golden", agents: ["codex"] },
    { roots: bundledAt(root) },
  );
  if (!Exit.isSuccess(result)) throw new Error("Golden fixture failed to compose");
  const composition = result.value;
  expect(
    await Effect.runPromise(fingerprint(composition).pipe(Effect.provide(NodeServices.layer))),
  ).toBe("sha256:2d7b2a7309ce90921f6f8437f18c15170ce7000a55751930578c1bbf635cc08a");
  expect(searchSourceDigest(composition.stack)).toBe(
    "sha256:7c94f9a9d1167efca98a3ade51155e2151b602b0630fb538fa1d20ce2be28b45",
  );
});
