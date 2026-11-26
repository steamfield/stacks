import { existsSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { bundleDigest } from "@steamfield/stacks-format";
import { Effect, Schema } from "effect";
import { describe, expect, onTestFinished, test, vi } from "vitest";
import type { HandoffPreferences } from "../src/core/handoff/decide";
import { agentPrompt } from "../src/core/handoff/render";
import {
  type IndexHeader,
  type IndexProvenance,
  NO_INDEX_PROVENANCE,
} from "../src/core/project/provenance";
import { Registry } from "../src/core/registry/registry";
import { scaffold } from "../src/core/scaffold/new";
import { shellArg } from "../src/core/text/shell";
import { NewResult } from "../src/schemas/new";
import { ProjectSources } from "../src/schemas/sources";
import { rawBundle } from "./fixtures/index/harness";
import { put, refused } from "./helpers/add";
import { quiet, runCli, tempDir } from "./helpers/cli";
import { gitShim, NOT_A_REPO, spawnGit } from "./helpers/git";
import { minimal, newRegistry, writeEntry } from "./helpers/registry";
import { newWorkspace } from "./helpers/workspace";

const sourcesPath = ".stacks/sources.json";
const briefPath = ".stacks/BRIEF.md";
const projectDir = "project with spaces";
const gitEnv = { ...quiet, PATH: process.env.PATH ?? "", GIT_CONFIG_NOSYSTEM: "1" };
type SourceRow = ProjectSources["entries"][number];
type CliOptions = NonNullable<Parameters<typeof runCli>[1]>;

const index: IndexHeader = {
  commit: "12ab3456789cdef0123456789abcdef012345678",
  generatedAt: "2026-11-25T23:04:56.789-06:00",
  fetchedAt: "2026-11-26T05:09:00.000Z",
};
const provenance: IndexProvenance = { revalidation: { source: "revalidated" }, index };

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

function temporaryHome() {
  const dir = tempDir();
  onTestFinished(dir.cleanup);
  return realpathSync(dir.path);
}

function readSources(root: string) {
  return Schema.decodeUnknownSync(Schema.fromJsonString(ProjectSources))(
    readFileSync(join(root, sourcesPath), "utf8"),
    { onExcessProperty: "error" },
  );
}

async function sourceRow(
  registry: string,
  kind: SourceRow["kind"],
  id: string,
  origin: SourceRow["origin"] = "bundled",
): Promise<SourceRow> {
  const digest = await Effect.runPromise(bundleDigest(rawBundle(registry, kind, id)));
  return { kind, id, origin, digest };
}

function newProject(home: string, args: string[] = [], options: CliOptions = {}) {
  return runCli(["new", "fixture-stack", projectDir, "--no-launch", "--json", ...args], {
    ...options,
    home,
    env: { ...gitEnv, ...options.env },
    host: { registry: newRegistry },
  });
}

function newResult(run: Awaited<ReturnType<typeof runCli>>) {
  expect(run.status, run.stderr).toBe(0);
  expect(run.stderr).toBe("");
  return Schema.decodeUnknownSync(Schema.fromJsonString(NewResult))(run.stdout);
}

function expectSilentSuccess(run: Awaited<ReturnType<typeof runCli>>) {
  expect(run.status, run.stderr).toBe(0);
  expect(run.stdout).toBe("");
  expect(run.stderr).toBe("");
}

function scaffoldWithProvenance(home: string, provenance: IndexProvenance) {
  const program = scaffold({
    stack: "fixture-stack",
    dir: "app",
    name: undefined,
    author: undefined,
    dryRun: false,
    with: [],
    without: [],
    sandbox: true,
    yes: false,
    agents: undefined,
    scope: undefined,
    handoff: noHandoff,
    provenance,
  }).pipe(
    Effect.asVoid,
    Effect.provide(Registry.layer([{ origin: "bundled", path: newRegistry }])),
  );
  return runCli(["--json"], { home, env: gitEnv, program });
}

function indexLines(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim().replace(/^- /, ""))
    .filter((line) => /^Index\b/.test(line));
}

describe("new records project sources", () => {
  test("writes ordered rows for the actual bundled and user entries with their raw bundle digests", async () => {
    const home = temporaryHome();
    const user = join(home, "config", "stacks");
    writeEntry({
      root: user,
      kind: "fragment",
      dir: "base-req",
      frontmatter: minimal("fragment", "base-req", "requires: [extra]"),
    });
    put(user, "fragments/base-req/files/from-user.txt", "User registry bytes\n");
    writeEntry({
      root: user,
      kind: "fragment",
      dir: "z-local",
      frontmatter: minimal("fragment", "z-local"),
    });
    const expected = await Promise.all([
      sourceRow(user, "fragment", "base-req", "user"),
      sourceRow(newRegistry, "fragment", "extra"),
      sourceRow(user, "fragment", "z-local", "user"),
      sourceRow(newRegistry, "stack", "fixture-stack"),
    ]);

    const result = newResult(await newProject(home, ["--preset", "lean", "--with", "z-local"]));
    expect(readFileSync(join(result.project, "from-user.txt"), "utf8")).toBe(
      "User registry bytes\n",
    );
    expect(readSources(result.project)).toEqual({
      formatVersion: 1,
      index: null,
      entries: expected,
    });
  });

  test.each([
    { label: "records the exact index header and names it under the stack heading", provenance },
    {
      label: "records a null index and leaves the index line out of the brief",
      provenance: NO_INDEX_PROVENANCE,
    },
  ])("$label", async ({ provenance }) => {
    const home = temporaryHome();
    const project = join(home, "app");
    expectSilentSuccess(await scaffoldWithProvenance(home, provenance));
    const brief = readFileSync(join(project, briefPath), "utf8");
    const expected = provenance.index ? ["Index 12ab345, generated 2026-11-26 05:04 UTC."] : [];
    expect(indexLines(brief)).toEqual(expected);
    if (provenance.index) {
      const stack = brief
        .split(/^## /m)
        .find((section) => section.startsWith("Stack: Fixture stack (`fixture-stack`)\n"));
      expect(indexLines(stack ?? "")).toEqual(expected);
    }
    expect(readSources(project).index).toEqual(provenance.index ?? null);
  });

  test("lists sources.json in written files and in the brief and makes it eligible for git", async () => {
    const home = temporaryHome();
    const result = newResult(await newProject(home));
    expect(result.written).toContain(sourcesPath);
    expect(existsSync(join(result.project, sourcesPath))).toBe(true);
    const brief = readFileSync(join(result.project, briefPath), "utf8");
    const ignored = spawnGit(["check-ignore", "--no-index", "--", sourcesPath], {
      cwd: result.project,
      encoding: "utf8",
      env: {
        PATH: gitEnv.PATH,
        HOME: home,
        XDG_CONFIG_HOME: join(home, "config"),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    });
    expect(ignored.stderr).toBe("");
    expect(ignored.status).toBe(1);
    expect(ignored.stdout).toBe("");
    expect(brief).toMatch(
      /- Files stacks wrote:\n(?: {2}- .+\n)* {2}- `\.stacks\/sources\.json`$/m,
    );
  });

  test("a dry run lists the sources file it would write without creating it", async () => {
    const result = newResult(await newProject(temporaryHome(), ["--dry-run"]));
    expect(result.dryRun).toBe(true);
    expect(existsSync(join(result.project, sourcesPath))).toBe(false);
    expect(result.written).toContain(sourcesPath);
  });

  // Budget for the marker wait and the real process group's cleanup.
  test(
    "interrupting new rolls back a sources file already on disk",
    interruptAfterGitStarts,
    15_000,
  );

  test("records the workspace root and sorts repeated part stack rows by mount name", async () => {
    const registry = join(temporaryHome(), "registry");
    writeEntry({
      root: registry,
      kind: "stack",
      dir: "pair",
      frontmatter: minimal(
        "stack",
        "pair",
        "parts:\n  - { name: backend, role: api, stack: a-worker }\n  - { name: app, role: web, stack: a-worker }",
      ),
    });
    writeEntry({
      root: registry,
      kind: "stack",
      dir: "a-worker",
      frontmatter: minimal("stack", "a-worker"),
    });
    put(registry, "stacks/a-worker/files/worker.txt", "Same entry mounted at two paths\n");
    const { result, target } = await newWorkspace({ root: registry });
    onTestFinished(() => rmSync(dirname(target), { recursive: true, force: true }));
    newResult(result);
    const worker = await sourceRow(registry, "stack", "a-worker");
    expect(readSources(target).entries).toEqual([
      { ...worker, part: "app" },
      { ...worker, part: "backend" },
      await sourceRow(registry, "stack", "pair"),
    ]);
  });
});

async function interruptAfterGitStarts() {
  const home = temporaryHome();
  const target = join(home, projectDir);
  put(target, ".DS_Store", "existing bytes");
  const marker = join(home, "init-started");
  const hold = `
    const { existsSync, writeFileSync } = require("node:fs");
    const marker = "../init-started";
    process.kill(${process.pid}, 0);
    writeFileSync(marker, "");
    setInterval(() => {
      if (!existsSync(marker)) process.exit(1);
      process.kill(${process.pid}, 0);
    }, 50);
    setTimeout(() => process.exit(1), 15_000);
  `;
  const bin = gitShim(
    home,
    `${NOT_A_REPO}\n  init) exec ${shellArg(process.execPath)} -e ${shellArg(hold)} ;;`,
  );
  const controller = new AbortController();
  let settled = false;
  const running = newProject(home, [], { env: { PATH: bin }, signal: controller.signal }).finally(
    () => {
      settled = true;
    },
  );
  onTestFinished(async () => {
    controller.abort();
    await running;
  });
  const source = join(target, sourcesPath);
  await vi.waitFor(() => expect(settled || existsSync(marker)).toBe(true), { timeout: 5_000 });
  expect(existsSync(marker), "git init must reach the blocked step").toBe(true);
  const writtenBeforeInterrupt = existsSync(source);
  controller.abort();

  refused(await running, 130, "Interrupted");
  expect(existsSync(source)).toBe(false);
  expect(readdirSync(target)).toEqual([".DS_Store"]);
  expect(readFileSync(join(target, ".DS_Store"), "utf8")).toBe("existing bytes");
  expect(writtenBeforeInterrupt, "sources.json was present before the interrupt").toBe(true);
}
