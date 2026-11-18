import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Exit, type FileSystem, type Path } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import type { Composition } from "../src/core/compose/types";
import { fingerprint, proofFingerprint, writtenEntryFiles } from "../src/core/fingerprint";
import { Registry } from "../src/core/registry/registry";
import { bundledAt, composeExit } from "./helpers/compose";
import { workspaceRegistry, workspaceVariant } from "./helpers/workspace";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A temp copy of the workspace fixture after `edit`, removed after the test. */
function variant(edit: (root: string) => void): string {
  const { root, cleanup } = workspaceVariant(edit);
  cleanups.push(cleanup);
  return root;
}

/** Replaces `from` with `to` in a fixture file, failing loudly when `from` isn't there. */
function replaceIn(root: string, file: string, from: string, to: string) {
  const path = join(root, file);
  const text = readFileSync(path, "utf8");
  if (!text.includes(from)) throw new Error(`${file} has no ${JSON.stringify(from)}`);
  writeFileSync(path, text.replace(from, to));
}

async function composed(root: string, stack: string): Promise<Composition> {
  const exit = await composeExit(
    { stack, agents: ["claude", "codex"] },
    { roots: bundledAt(root) },
  );
  if (Exit.isFailure(exit)) throw new Error(`compose failed: ${JSON.stringify(exit.cause)}`);
  return exit.value;
}

const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

const proof = async (root: string, stack: string) =>
  run(proofFingerprint(await composed(root, stack)));
const contentFingerprint = async (root: string, stack: string) =>
  run(fingerprint(await composed(root, stack)));

/** Each stack's proof and `pair`'s composition fingerprint over one registry. */
async function digests(root: string) {
  return {
    pair: await proof(root, "pair"),
    api: await proof(root, "api-part"),
    web: await proof(root, "web-part"),
    content: await contentFingerprint(root, "pair"),
  };
}

const WEB = "stacks/web-part/STACK.md";

describe("a workspace's proof covers each part", () => {
  const edits: ReadonlyArray<{ name: string; edit: (root: string) => void }> = [
    { name: "body", edit: (root) => replaceIn(root, WEB, "Install dependencies", "Install deps") },
    {
      name: "shipped file",
      edit: (root) =>
        writeFileSync(
          join(root, "stacks/web-part/files/src/main.ts"),
          `${readFileSync(join(root, "stacks/web-part/files/src/main.ts"), "utf8")} `,
        ),
    },
    {
      name: "meta",
      edit: (root) => replaceIn(root, WEB, "A small scripts web app", "A small script web app"),
    },
    {
      name: "merged session-root settings",
      edit: (root) =>
        replaceIn(
          root,
          "stacks/web-part/adapters/claude/.claude/settings.json",
          "web-hook",
          "web-hoo",
        ),
    },
  ];

  test.each(edits)(
    "a one-byte change in web-part's $name changes pair's and web-part's proofs only",
    async ({ edit }) => {
      const before = await digests(workspaceRegistry);
      const after = await digests(variant(edit));
      expect(after.pair).not.toBe(before.pair);
      expect(after.web).not.toBe(before.web);
      expect(after.api).toBe(before.api);
      expect(after.content).not.toBe(before.content);
    },
  );

  test("a change to a file only api-part writes leaves web-part's proof alone", async () => {
    const before = await digests(workspaceRegistry);
    const after = await digests(
      variant((root) =>
        writeFileSync(join(root, "stacks/api-part/files/src/index.ts"), "export {};\n"),
      ),
    );
    expect(after.pair).not.toBe(before.pair);
    expect(after.api).not.toBe(before.api);
    expect(after.web).toBe(before.web);
  });

  test("the collapsed shared guard and the merged root settings count for both parts", async () => {
    const composition = await composed(workspaceRegistry, "pair");
    const written = await run(
      Effect.gen(function* () {
        const registry = yield* Registry.pipe(Effect.provide(Registry.layer([])));
        const sources: Record<string, ReadonlyArray<string>> = {};
        for (const { mount, entry } of composition.parts ?? []) {
          if (entry === null) continue;
          const files = yield* writtenEntryFiles(composition, entry, registry);
          sources[mount.name] = files.map((file) => file.source);
        }
        return sources;
      }),
    );
    expect(written).toEqual({
      backend: [
        "adapters/claude/.claude/hooks/shared-guard.sh",
        "adapters/claude/.claude/rules/api.md",
        "adapters/claude/.claude/settings.json",
        "adapters/codex/.agents/skills/api-skill/SKILL.md",
        "files/AGENTS.md",
        "files/README.md",
        "files/config/app.json",
        "files/package.json.tmpl",
        "files/src/index.ts",
        "payloads/example/src/notes.ts",
      ],
      frontend: [
        "adapters/claude/.claude/hooks/shared-guard.sh",
        "adapters/claude/.claude/settings.json",
        "files/AGENTS.md",
        "files/README.md",
        "files/src/main.ts",
        "payloads/example/src/notes-page.ts",
      ],
    });
  });

  test("swapping the parts list changes the composition fingerprint", async () => {
    const swapped = variant((root) =>
      replaceIn(
        root,
        "stacks/pair/STACK.md",
        "  - { name: backend, role: api, stack: api-part }\n  - { name: frontend, role: web, stack: web-part }\n",
        "  - { name: frontend, role: web, stack: web-part }\n  - { name: backend, role: api, stack: api-part }\n",
      ),
    );
    expect(await contentFingerprint(swapped, "pair")).not.toBe(
      await contentFingerprint(workspaceRegistry, "pair"),
    );
  });
});
