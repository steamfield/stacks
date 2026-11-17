import type { DetectedAgent } from "@steamfield/stacks-format";
import { expect, test } from "vitest";
import { mergeAddManifest } from "../src/core/add/manifest";
import { digestSteps } from "../src/core/project/manifest";
import { manifest } from "./helpers/verify";

const incoming = () =>
  manifest([{ name: "new-check", run: "new command" }], {
    mode: "add",
    stack: null,
    env: { SAME: "new", NEW: "added" },
    commands: { test: "new purpose", build: "build", shared: "unchanged" },
    fragments: [{ id: "added", origin: "bundled", trusted: true }],
  });

test("manifest merging preserves accepted steps, project identity, and existing values", () => {
  const previous = manifest([{ name: "accepted-check", run: "accepted edit", timeout: "7s" }], {
    name: "old",
    preset: "sandbox",
    agents: ["codex"],
    fingerprint: "original",
    env: { SAME: "project", OLD: "kept" },
    commands: { test: "project purpose", shared: "unchanged" },
    fragments: [{ id: "existing", origin: "project", trusted: false }],
  });
  const next = incoming();
  const before = structuredClone({ previous, next });
  const merged = mergeAddManifest({
    previous,
    incoming: next,
    name: "recorded",
    untrusted: false,
    agent: "none",
    stdinIsTTY: true,
  });
  expect(merged.manifest).toMatchObject({
    projectId: previous.projectId,
    createdAt: previous.createdAt,
    stack: previous.stack,
    mode: previous.mode,
    preset: previous.preset,
    agents: previous.agents,
    fingerprint: "original",
    name: "recorded",
  });
  expect(merged.manifest.verify).toEqual([...previous.verify, ...next.verify]);
  expect(merged.manifest.fragments).toEqual([...previous.fragments, ...next.fragments]);
  expect(merged.manifest.env).toEqual({ SAME: "project", OLD: "kept", NEW: "added" });
  expect(merged.manifest.commands).toEqual({
    test: "project purpose",
    build: "build",
    shared: "unchanged",
  });
  expect(merged.commandsKept).toEqual(["test"]);
  expect(merged.digestRecorded).toBe(true);
  expect(merged.manifest.verifyDigest).toBe(digestSteps(merged.manifest));
  expect({ previous, next }).toEqual(before);
});

const audiences: Array<{ agent: DetectedAgent; stdinIsTTY: boolean; recorded: boolean }> = [
  { agent: "codex", stdinIsTTY: true, recorded: false },
  { agent: "none", stdinIsTTY: false, recorded: false },
  { agent: "none", stdinIsTTY: true, recorded: true },
];
test.each(audiences)(
  "untrusted additions retain the previous baseline according to confirmation facts: %j",
  ({ agent, stdinIsTTY, recorded }) => {
    const previous = manifest([{ name: "old-check", run: "true" }], { env: { OLD: "kept" } });
    const merged = mergeAddManifest({
      previous,
      incoming: incoming(),
      name: "app",
      untrusted: true,
      agent,
      stdinIsTTY,
    });
    expect(merged.digestRecorded).toBe(recorded);
    expect(merged.manifest.verify.map((step) => step.name)).toEqual(["old-check", "new-check"]);
    expect(merged.manifest.verifyDigest).toBe(digestSteps(recorded ? merged.manifest : previous));
    expect(merged.stateManifest.verify).toEqual(
      recorded ? merged.manifest.verify : previous.verify,
    );
    expect(merged.stateManifest.env).toEqual(recorded ? merged.manifest.env : previous.env);
  },
);

test("an untrusted first add digests empty steps and env while retaining its new manifest contents", () => {
  const next = incoming();
  const merged = mergeAddManifest({
    previous: undefined,
    incoming: next,
    name: "app",
    untrusted: true,
    agent: "codex",
    stdinIsTTY: true,
  });
  expect(merged.manifest.mode).toBe("add");
  expect(merged.manifest.stack).toBeNull();
  expect(merged.manifest.verify).toEqual(next.verify);
  expect(merged.manifest.env).toEqual(next.env);
  expect(merged.manifest.verifyDigest).toBe(digestSteps({ ...next, verify: [], env: {} }));
  expect(merged.stateManifest.verify).toEqual([]);
  expect(merged.stateManifest.env).toEqual({});
  expect(merged.commandsKept).toEqual([]);
});
