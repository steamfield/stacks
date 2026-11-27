import { chmodSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { bundleDigest } from "@steamfield/stacks-format";
import { Effect, Schema } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import { add } from "../src/core/add";
import type { HandoffPreferences } from "../src/core/handoff/decide";
import { agentPrompt } from "../src/core/handoff/render";
import type { IndexHeader, IndexProvenance } from "../src/core/project/provenance";
import { Registry } from "../src/core/registry/registry";
import { NewResult } from "../src/schemas/new";
import { ProjectSources } from "../src/schemas/sources";
import { rawBundle } from "./fixtures/index/harness";
import {
  type AddProject,
  addCli,
  added,
  addProject,
  put,
  releaseAdd,
  scaffolded,
} from "./helpers/add";

const sourcesPath = ".stacks/sources.json";
type SourceRow = ProjectSources["entries"][number];

const index: IndexHeader = {
  commit: "12ab3456789cdef0123456789abcdef012345678",
  generatedAt: "2026-11-25T23:04:56.789-06:00",
  fetchedAt: "2026-11-26T05:09:00.000Z",
};
const provenance: IndexProvenance = { revalidation: { source: "revalidated" }, index };
const previousIndex: IndexHeader = {
  commit: "a".repeat(40),
  generatedAt: "2026-11-24T04:04:56.789Z",
  fetchedAt: "2026-11-24T05:09:00.000Z",
};

const noHandoff: HandoffPreferences = {
  detected: "none",
  json: true,
  launch: false,
  stdinIsTTY: false,
  stdoutIsTTY: false,
  configured: [],
  found: new Map(),
  prompt: agentPrompt("stacks"),
};

function readSources(root: string) {
  return Schema.decodeUnknownSync(Schema.fromJsonString(ProjectSources))(
    readFileSync(join(root, sourcesPath), "utf8"),
    { onExcessProperty: "error" },
  );
}

async function sourceRow(
  project: AddProject,
  kind: SourceRow["kind"],
  id: string,
): Promise<SourceRow> {
  const digest = await Effect.runPromise(bundleDigest(rawBundle(project.registry, kind, id)));
  return { kind, id, origin: "bundled", digest };
}

const addedId = "ci-github";
const historicalStack: SourceRow = {
  kind: "stack",
  id: "fixture-stack",
  origin: "index",
  digest: `sha256:${"1".repeat(64)}`,
};
const historicalRequirement: SourceRow = {
  kind: "fragment",
  id: "fixture-required",
  origin: "index",
  digest: `sha256:${"2".repeat(64)}`,
};
const historicalRows = [historicalRequirement, historicalStack];

function seedSources(
  project: AddProject,
  entries: ProjectSources["entries"],
  index: ProjectSources["index"] = null,
) {
  const document: ProjectSources = { formatVersion: 1, index, entries };
  put(project.root, sourcesPath, JSON.stringify(document));
}

async function expectReconstructedSources(project: AddProject, explicitFragment?: string) {
  const entries = await Promise.all([
    sourceRow(project, "fragment", addedId),
    sourceRow(project, "fragment", "fixture-required"),
    ...(explicitFragment ? [sourceRow(project, "fragment", explicitFragment)] : []),
    sourceRow(project, "stack", "fixture-stack"),
  ]);
  expect(readSources(project.root)).toEqual({ formatVersion: 1, index: null, entries });
}

async function applyFragment(project: AddProject) {
  const result = await added(await addCli(project, ["add", addedId, "--json"]));
  expect(result.added).toEqual([addedId]);
}

describe("add updates project sources", () => {
  afterEach(releaseAdd);

  test("reconstructs the existing composition for a project with no sources file", async () => {
    const project = addProject();
    const run = await addCli(project, [
      "new",
      "fixture-stack",
      project.root,
      "--without",
      "default-only",
      "--with",
      "fixture-tool",
      "--no-launch",
      "--json",
    ]);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toBe("");
    const result = Schema.decodeUnknownSync(Schema.fromJsonString(NewResult))(run.stdout);
    expect(result.fragments).toContain("fixture-tool");
    rmSync(join(project.root, sourcesPath), { force: true });
    await applyFragment(project);
    await expectReconstructedSources(project, "fixture-tool");
  });

  test.each([
    { label: "malformed JSON", raw: '{"formatVersion":1,' },
    { label: "the wrong shape", raw: '{"formatVersion":1,"index":null,"entries":{}}' },
    {
      label: "a malformed row alongside a valid one",
      raw: JSON.stringify({
        formatVersion: 1,
        index,
        entries: [historicalRequirement, { ...historicalStack, digest: "not-a-digest" }],
      }),
    },
    {
      label: "an unsupported format version",
      raw: JSON.stringify({ formatVersion: 2, index, entries: historicalRows }),
    },
  ])("replaces sources containing $label and succeeds", async ({ raw }) => {
    const project = await scaffolded();
    put(project.root, sourcesPath, raw);
    await applyFragment(project);
    await expectReconstructedSources(project);
  });

  test.skipIf(process.getuid?.() === 0)(
    "replaces an unreadable sources file and succeeds",
    async () => {
      const project = await scaffolded();
      seedSources(project, [historicalStack], index);
      const file = join(project.root, sourcesPath);
      chmodSync(file, 0o000);
      expect(() => readFileSync(file)).toThrow(expect.objectContaining({ code: "EACCES" }));

      await applyFragment(project);
      await expectReconstructedSources(project);
    },
  );

  test("keeps historical rows, adds the new fragment in order, and records the absence of an index", async () => {
    const project = await scaffolded();
    const retired: SourceRow = { ...historicalRequirement, id: "retired-tool" };
    seedSources(project, [historicalRequirement, retired, historicalStack], previousIndex);
    await applyFragment(project);
    expect(readSources(project.root)).toEqual({
      formatVersion: 1,
      index: null,
      entries: [
        await sourceRow(project, "fragment", addedId),
        historicalRequirement,
        retired,
        historicalStack,
      ],
    });
  });

  test("replaces a stale row for the requested fragment without duplicating it", async () => {
    const project = await scaffolded();
    // The sources file can outlive changes to the manifest, which determines what add can apply.
    const stale: SourceRow = { ...historicalRequirement, id: addedId };
    seedSources(project, [stale, historicalRequirement, historicalStack]);
    await applyFragment(project);
    expect(readSources(project.root).entries).toEqual([
      await sourceRow(project, "fragment", addedId),
      historicalRequirement,
      historicalStack,
    ]);
  });

  test("replaces the previous index with the header used for add", async () => {
    const project = await scaffolded();
    seedSources(project, historicalRows, previousIndex);
    const program = add({
      root: project.root,
      fragments: [addedId],
      agents: undefined,
      sandbox: false,
      yes: false,
      handoff: noHandoff,
      provenance,
    }).pipe(
      Effect.asVoid,
      Effect.provide(Registry.layer([{ origin: "bundled", path: project.registry }])),
    );

    expect(await addCli(project, ["--json"], { program })).toEqual({
      status: 0,
      stdout: "",
      stderr: "",
    });
    expect(readSources(project.root)).toEqual({
      formatVersion: 1,
      index,
      entries: [await sourceRow(project, "fragment", addedId), ...historicalRows],
    });
  });
});
