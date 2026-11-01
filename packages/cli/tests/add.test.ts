import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
} from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import * as T from "../src/core/brief/text";
import { countWords } from "../src/core/brief/words";
import { decideHandoff } from "../src/core/handoff";
import { digestSteps, encodeManifest, MANIFEST_PATH } from "../src/core/manifest";
import { VerifyResult } from "../src/schemas/verify";
import {
  addCli,
  added,
  addProject,
  projectFragment,
  put,
  read,
  refused,
  releaseAdd,
  scaffolded,
  snapshot,
} from "./helpers/add";
import { gitEnv, spawnGit } from "./helpers/git";
import { minimal, writeEntry } from "./helpers/registry";
import {
  readManifestAt,
  readRecord,
  recordPath,
  splitEvents,
  startedSteps,
  writeRecordedProject,
} from "./helpers/verify";

afterEach(releaseAdd);
const incoming = ".stacks/incoming";
const decodeVerify = (text: string) => Schema.decodeUnknownSync(VerifyResult)(JSON.parse(text));
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

function liveConflicts(root: string) {
  put(root, "AGENTS.md", "# My agent instructions\n");
  put(root, "README.md", "# My project\n");
  put(root, ".claude/settings.json", '{"mine":true}\n');
}

function parkedRollback(root: string) {
  put(root, ".claude/settings.json", '{"live":true}\n');
  put(root, `${incoming}/.claude/settings.json`, '{ "previous": [1, 2] }\n');
}

describe("add to an existing repository", () => {
  test("appends steps and preserves the project's settings and accepted step form [3.0#1]", async () => {
    const project = await scaffolded();
    const before = readManifestAt(project.root);
    // An accepted local edit remains the source of truth, rather than the registry's old step.
    const first = before.verify[0];
    expect(first).toBeDefined();
    const edited = {
      ...before,
      verify: before.verify.map((step, index) =>
        index === 0 ? { ...step, run: "true # accepted local change", timeout: "7s" } : step,
      ),
    };
    put(project.root, MANIFEST_PATH, encodeManifest(edited));
    const accept = await addCli(project, ["verify", "--accept-changes", "--json"], {
      host: { stdinIsTTY: true },
    });
    expect(accept.status).toBe(0);
    // stderr holds only verify's live events.
    expect(splitEvents(accept.stderr).rest).toBe("");
    expect(startedSteps(accept.stderr)).toEqual(["stack-check", "required-check"]);
    decodeVerify(accept.stdout);
    const accepted = readManifestAt(project.root);
    const result = await added(await addCli(project, ["add", "ci-github", "--json"]));
    expect(result).toMatchObject({
      project: project.root,
      stack: "fixture-stack",
      added: ["ci-github"],
      alreadyApplied: ["fixture-required"],
      createdManifest: false,
      tamperCheck: "full",
      stateRecord: true,
      digestRecorded: true,
      commandsKept: ["test"],
      missingRequired: [],
      warnings: [],
      name: { value: "app", source: "manifest" },
    });
    expect(result.written).toEqual([".github/workflows/ci.yml", "AGENTS.md"]);
    expect(read(project.root, ".github/workflows/ci.yml")).toBe("name: fixture\n");
    expect(read(project.root, "stack.txt")).toBe("stack bytes\n");
    expect(read(project.root, "required.txt")).toBe("required bytes\n");
    expect(existsSync(join(project.root, "default.txt"))).toBe(false);
    const after = readManifestAt(project.root);
    expect(after).toMatchObject({
      mode: before.mode,
      preset: before.preset,
      agents: before.agents,
      projectId: before.projectId,
      createdAt: before.createdAt,
      stack: before.stack,
      fragments: [...before.fragments, { id: "ci-github", origin: "bundled", trusted: true }],
      env: { SHARED: "project", OLD: "kept", NEW: "added" },
      commands: { test: "project-test", ci: "run-ci" },
    });
    expect(after.verify.slice(0, accepted.verify.length)).toEqual(accepted.verify);
    expect(after.verify.slice(accepted.verify.length)).toMatchObject([
      { name: "ci-check", owner: "ci-github" },
    ]);
    expect(after.verifyDigest).toBe(digestSteps(after));
    expect(readRecord(recordPath(project.home, after.projectId)).verifyDigest).toBe(
      after.verifyDigest,
    );
    const brief = read(project.root, ".stacks/BRIEF.md");
    expect(brief).toMatch(/Add .*ci-github.*app/);
    expect(brief).toContain("CI guidance");
    expect(brief).toContain("ADD WITH EXISTING REQUIREMENT");
    expect(brief).not.toContain("STACK BODY MUST NOT REAPPEAR");
    expect(brief).not.toContain("EXISTING BODY MUST NOT REAPPEAR");
    expect(brief).not.toContain("NEW ONLY BODY");
    expect(brief).toContain("stacks verify");
    expect(result).toMatchObject({ brief: ".stacks/BRIEF.md", briefWords: countWords(brief) });
    expect(after.briefWords).toBe(countWords(brief));
    const verified = await addCli(project, ["verify", "--json"]);
    expect(verified.status).toBe(0);
    expect(splitEvents(verified.stderr).rest).toBe("");
    expect(startedSteps(verified.stderr)).toEqual(["stack-check", "required-check", "ci-check"]);
    const report = decodeVerify(verified.stdout);
    expect(report.tamperCheck).toBe("full");
    expect(report.steps.map((step) => step.name)).toEqual([
      ...accepted.verify.map((step) => step.name),
      "ci-check",
    ]);
  });

  test("parks AGENTS.md whole and gives the agent a merge task [3.0#2]", async () => {
    const project = await scaffolded();
    put(project.root, "AGENTS.md", Buffer.from([0, 13, 10, 255, 65]));
    const original = readFileSync(join(project.root, "AGENTS.md"));
    const result = await added(await addCli(project, ["add", "ci-github", "--json"]));
    expect(result.written).toEqual([".github/workflows/ci.yml"]);
    expect(result.skipped).toEqual([]);
    expect(readFileSync(join(project.root, "AGENTS.md"))).toEqual(original);
    expect(read(project.root, `${incoming}/AGENTS.md`)).toBe("# Incoming agent guidance\n");
    expect(result.mergeNeeded).toEqual([
      { path: "AGENTS.md", incoming: [`${incoming}/AGENTS.md`] },
    ]);
    const brief = read(project.root, ".stacks/BRIEF.md");
    expect(brief).toContain("Merge needed");
    expect(brief).toContain(`${incoming}/AGENTS.md`);
    expect(brief).toMatch(/keep.*project.*choices/i);
    expect(brief).toMatch(/delete.*\.stacks\/incoming\//i);
  });

  test("merges parked JSON, numbers text copies, skips identical bytes and includes old incoming files [3.0#3]", async () => {
    const project = addProject();
    liveConflicts(project.root);
    put(project.root, "same.txt", "identical\n");
    put(project.root, `${incoming}/older.txt`, "from an earlier run\n");
    const first = await added(await addCli(project, ["add", "park-a", "--json"]));
    expect(first.written).toEqual([]);
    expect(first.skipped).toEqual(["same.txt"]);
    const parked = join(project.root, incoming, "README.md");
    const settings = join(project.root, incoming, ".claude/settings.json");
    const oldTime = new Date("2001-01-01T00:00:00Z");
    utimesSync(parked, oldTime, oldTime);
    utimesSync(settings, oldTime, oldTime);
    const before = [statSync(parked), statSync(settings)];
    const same = await added(await addCli(project, ["add", "park-identical", "--json"]));
    expect(same.mergeNeeded).toEqual([
      { path: ".claude/settings.json", incoming: [`${incoming}/.claude/settings.json`] },
      { path: "README.md", incoming: [`${incoming}/README.md`] },
      { path: "older.txt", incoming: [`${incoming}/older.txt`] },
    ]);
    for (const [index, file] of [parked, settings].entries()) {
      expect(statSync(file).mtimeMs).toBe(before[index]?.mtimeMs);
      expect(statSync(file).ino).toBe(before[index]?.ino);
    }
    const second = await added(await addCli(project, ["add", "park-b", "--json"]));
    expect(JSON.parse(read(project.root, `${incoming}/.claude/settings.json`))).toEqual({
      permissions: { deny: ["danger"], allow: ["safe"] },
      hooks: { first: true, second: true },
    });
    expect(read(project.root, `${incoming}/README.md`)).toBe("first incoming readme\n");
    expect(read(project.root, `${incoming}/README.md.2`)).toBe("second incoming readme\n");
    expect(second.mergeNeeded).toEqual([
      { path: ".claude/settings.json", incoming: [`${incoming}/.claude/settings.json`] },
      { path: "README.md", incoming: [`${incoming}/README.md`, `${incoming}/README.md.2`] },
      { path: "older.txt", incoming: [`${incoming}/older.txt`] },
    ]);
    expect(read(project.root, ".claude/settings.json")).toBe('{"mine":true}\n');
    expect(read(project.root, "README.md")).toBe("# My project\n");
    expect(read(project.root, ".stacks/BRIEF.md")).toContain(`${incoming}/older.txt`);
  });

  test("a forged manifest digest cannot replace the recorded baseline [3.0#4]", async () => {
    const project = await scaffolded();
    const old = readManifestAt(project.root);
    const changed = { ...old, verify: old.verify.map((step) => ({ ...step, run: "false" })) };
    put(
      project.root,
      MANIFEST_PATH,
      encodeManifest({ ...changed, verifyDigest: digestSteps(changed) }),
    );
    const before = snapshot(project.root);
    const file = recordPath(project.home, old.projectId);
    const state = readFileSync(file);
    const error = refused(
      await addCli(project, ["add", "ci-github", "--json"]),
      5,
      "VerifyChanged",
    );
    expect(error.details).toEqual({
      against: "state-record",
      reason: "digest",
      added: [],
      removed: [],
      edited: old.verify.map((step) => step.name).sort(),
      settings: false,
    });
    expect(snapshot(project.root)).toEqual(before);
    expect(readFileSync(file)).toEqual(state);
  });

  test("a missing state record stays missing after a manifest-only add [3.0#5]", async () => {
    const project = await scaffolded();
    const file = recordPath(project.home, readManifestAt(project.root).projectId);
    rmSync(file);
    const result = await added(await addCli(project, ["add", "ci-github", "--json"]));
    expect(result).toMatchObject({ tamperCheck: "manifest-only", stateRecord: false });
    expect(existsSync(file)).toBe(false);
    expect(readManifestAt(project.root).verifyDigest).toBe(
      digestSteps(readManifestAt(project.root)),
    );
    const verified = await addCli(project, ["verify", "--json"]);
    expect(verified.status).toBe(0);
    expect(splitEvents(verified.stderr).rest).toBe("");
    expect(startedSteps(verified.stderr)).toEqual(["stack-check", "required-check", "ci-check"]);
    expect(decodeVerify(verified.stdout).tamperCheck).toBe("manifest-only");
  });

  test.each([
    { env: { CLAUDECODE: "1" }, tty: true },
    { env: {}, tty: false },
  ])(
    "untrusted additions require human acceptance under an agent or without a terminal: %j [3.0#6]",
    async ({ env, tty }) => {
      const project = await scaffolded();
      projectFragment(project);
      const old = readManifestAt(project.root);
      const result = await added(
        await addCli(project, ["add", "local-add", "--json"], {
          env,
          host: { stdinIsTTY: tty, stdoutIsTTY: tty },
        }),
      );
      expect(result).toMatchObject({
        digestRecorded: false,
        untrusted: [{ id: "local-add", origin: "project" }],
      });
      expect(read(project.root, "local.txt")).toBe("local bytes\n");
      const next = readManifestAt(project.root);
      expect(next.verify.at(-1)).toMatchObject({ name: "local-check" });
      expect(next.verifyDigest).toBe(old.verifyDigest);
      expect(readRecord(recordPath(project.home, next.projectId)).verifyDigest).toBe(
        old.verifyDigest,
      );
      expect(read(project.root, ".stacks/BRIEF.md")).toContain("verify --accept-changes");
      const refusedVerify = await addCli(project, ["verify", "--json"], { env });
      expect(refusedVerify.status).toBe(5);
      expect(decodeVerify(refusedVerify.stdout)).toMatchObject({
        outcome: "changed",
        changed: { added: ["local-check"], edited: [], removed: [], settings: false },
      });
      expect(JSON.parse(refusedVerify.stderr)).toMatchObject({ error: { tag: "VerifyChanged" } });
      expect(existsSync(join(project.root, "local-ran"))).toBe(false);
      const accepted = await addCli(project, ["verify", "--accept-changes", "--json"], {
        host: { stdinIsTTY: true },
      });
      expect(accepted.status).toBe(0);
      expect(splitEvents(accepted.stderr).rest).toBe("");
      expect(startedSteps(accepted.stderr)).toEqual([
        "stack-check",
        "required-check",
        "local-check",
      ]);
      expect(decodeVerify(accepted.stdout).outcome).toBe("green");
      expect(read(project.root, "local-ran")).toBe("ran");
    },
  );

  test("a human can record untrusted additions but they never launch an agent [3.0#6]", async () => {
    const project = await scaffolded();
    projectFragment(project);
    const bin = join(project.home, "bin");
    put(bin, "codex", '#!/bin/sh\nprintf launched > "$HOME/launched"\n');
    chmodSync(join(bin, "codex"), 0o755);
    const run = await addCli(project, ["add", "local-add", "--launch", "codex"], {
      env: { PATH: `${bin}:${process.env.PATH ?? ""}` },
      host: { stdinIsTTY: true, stdoutIsTTY: true },
    });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout).toMatch(/not launching/i);
    expect(existsSync(join(project.home, "launched"))).toBe(false);
    const after = readManifestAt(project.root);
    expect(after.verifyDigest).toBe(digestSteps(after));
    expect(after.handoff?.kind).toBe("print");
    expect(readRecord(recordPath(project.home, after.projectId)).verifyDigest).toBe(
      after.verifyDigest,
    );
  });

  test.skipIf(process.getuid?.() === 0)(
    "a later unwritable destination restores parked JSON, metadata and earlier writes [3.0#7]",
    async () => {
      const project = await scaffolded();
      parkedRollback(project.root);
      mkdirSync(join(project.root, "z-blocked"));
      chmodSync(join(project.root, "z-blocked"), 0o555);
      const before = snapshot(project.root);
      const file = recordPath(project.home, readManifestAt(project.root).projectId);
      const state = readFileSync(file);
      try {
        refused(await addCli(project, ["add", "rollback", "--json"]), 6, "PermissionDenied");
        expect(snapshot(project.root)).toEqual(before);
        expect(readFileSync(file)).toEqual(state);
      } finally {
        chmodSync(join(project.root, "z-blocked"), 0o755);
      }
    },
  );

  test("a plain repository gets an add manifest, a state record and metadata ignores [3.0#8]", async () => {
    const project = addProject();
    const result = await added(await addCli(project, ["add", "named", "--json"]));
    expect(result).toMatchObject({
      stack: null,
      createdManifest: true,
      tamperCheck: null,
      stateRecord: true,
      digestRecorded: true,
    });
    const after = readManifestAt(project.root);
    expect(after).toMatchObject({
      schemaVersion: 1,
      stack: null,
      mode: "add",
      fragments: [{ id: "named", origin: "bundled", trusted: true }],
    });
    expect(after.verifyDigest).toBe(digestSteps(after));
    expect(readRecord(recordPath(project.home, after.projectId)).verifyDigest).toBe(
      after.verifyDigest,
    );
    expect(read(project.root, ".stacks/.gitignore")).toBe(
      "/BRIEF.md\n/NOTES.md\n/state/\n/incoming/\n",
    );
    expect(read(project.root, "name.txt")).toBe("app\n");
  });

  test("symlinked metadata refuses before reading or writing outside the project [3.0#9]", async () => {
    const project = addProject();
    const outside = join(project.home, "outside");
    put(outside, "private.txt", "private bytes\n");
    symlinkSync(outside, join(project.root, ".stacks"));
    const before = snapshot(project.root);
    const external = snapshot(outside);
    const error = refused(await addCli(project, ["add", "named", "--json"]), 6, "PermissionDenied");
    expect(error.details).toMatchObject({ path: join(project.root, ".stacks") });
    expect(snapshot(project.root)).toEqual(before);
    expect(snapshot(outside)).toEqual(external);
  });

  test("needsOwnRepo refuses an enclosing repository and permits a repository's own root [3.0#10]", async () => {
    const project = addProject();
    const child = join(project.root, "child");
    mkdirSync(child);
    const nested = { ...project, root: child };
    const before = snapshot(child);
    expect(
      refused(await addCli(nested, ["add", "own-repo", "--json"]), 2, "ComposeConflict").details,
    ).toMatchObject({ reason: "needs_own_repo" });
    expect(snapshot(child)).toEqual(before);
    expect(spawnGit(["init", "--quiet", child]).status).toBe(0);
    await added(await addCli(nested, ["add", "own-repo", "--json"]));
    expect(read(child, "own.txt")).toBe("own repo file\n");
  });

  test("missing stack requirements are reported with an actionable add command [3.0#11]", async () => {
    const project = addProject();
    writeRecordedProject(project.root, project.home, [{ name: "stack-check", run: "true" }]);
    const result = await added(await addCli(project, ["add", "named", "--json"]));
    expect(JSON.stringify(result.missingRequired)).toContain("fixture-required");
    expect(JSON.stringify(result.missingRequired)).toContain("stacks add fixture-required");
    expect(read(project.root, ".stacks/BRIEF.md")).toContain("stacks add fixture-required");
    expect(readManifestAt(project.root).fragments.map((entry) => entry.id)).toEqual(["named"]);
    expect(existsSync(join(project.root, "required.txt"))).toBe(false);
  });

  test("adding an applied fragment refuses without rewriting files or metadata [3.0#12]", async () => {
    const project = await scaffolded();
    const before = snapshot(project.root);
    const file = recordPath(project.home, readManifestAt(project.root).projectId);
    const state = readFileSync(file);
    expect(
      refused(await addCli(project, ["add", "fixture-required", "--json"]), 2, "BadInput").details,
    ).toMatchObject({ alreadyApplied: ["fixture-required"] });
    expect(snapshot(project.root)).toEqual(before);
    expect(readFileSync(file)).toEqual(state);
  });

  test("adding fragments executes only the git probe, never tools, verify steps or agents [3.0#13]", async () => {
    const project = addProject();
    const bin = join(project.home, "recording-bin");
    const log = join(project.home, "spawns");
    put(project.home, "spawns", "");
    const git = execFileSync("/bin/sh", ["-c", "command -v git"], {
      env: gitEnv(),
      encoding: "utf8",
    }).trim();
    for (const tool of [
      "git",
      "fixture-tool",
      "bun",
      "npm",
      "node",
      "claude",
      "codex",
      "opencode",
      "cursor-agent",
    ]) {
      put(
        bin,
        tool,
        `#!/bin/sh\nprintf '%s\\n' ${quote(tool)} >> ${quote(log)}\n${tool === "git" ? `exec ${quote(git)} "$@"` : "exit 91"}\n`,
      );
      chmodSync(join(bin, tool), 0o755);
    }
    const result = await added(
      await addCli(project, ["add", "own-repo", "fixture-tool", "--json"], { env: { PATH: bin } }),
    );
    expect(result.added).toEqual(["fixture-tool", "own-repo"]);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(expect.arrayContaining(["git"]));
    expect(new Set(readFileSync(log, "utf8").trim().split("\n"))).toEqual(new Set(["git"]));
    expect(existsSync(join(project.root, "ADD_MUST_NOT_RUN"))).toBe(false);
    expect(read(project.root, "tool.txt")).toBe("tool file\n");
  });
});

it.effect.prop(
  "every pre-existing live file keeps its bytes for arbitrary path subsets and contents [3.0#14]",
  [
    Schema.Array(
      Schema.Literals([
        "README.md",
        ".claude/settings.json",
        "same.txt",
        "docs/space name.md",
        "-notes.txt",
        "資料.txt",
      ]),
    ),
    Schema.String,
  ],
  ([paths, contents]) =>
    Effect.promise(async () => {
      const project = addProject();
      const originals = new Map<string, Buffer>();
      for (const path of new Set(paths)) {
        const bytes = Buffer.from(contents);
        put(
          join(project.registry, "fragments/park-a/files"),
          path,
          `${contents}incoming contribution\n`,
        );
        put(project.root, path, bytes);
        originals.set(path, bytes);
      }
      // This conflict exists even when the arbitrary selects an empty set.
      put(
        join(project.registry, "fragments/park-a/files"),
        "AGENTS.md",
        "different incoming bytes\n",
      );
      put(project.root, "AGENTS.md", "user bytes\n");
      originals.set("AGENTS.md", Buffer.from("user bytes\n"));
      const result = await added(await addCli(project, ["add", "park-a", "--json"]));
      expect(result.mergeNeeded).toContainEqual({
        path: "AGENTS.md",
        incoming: [`${incoming}/AGENTS.md`],
      });
      expect(read(project.root, `${incoming}/AGENTS.md`)).toBe("different incoming bytes\n");
      for (const [path, bytes] of originals)
        expect(readFileSync(join(project.root, path))).toEqual(bytes);
    }),
  { timeout: 60_000, arbitrary: { runs: 25 } },
);

describe("add project context", () => {
  test.each([
    { files: { "package.json": '{"name":"@acme/web"}' }, value: "web", source: "package.json" },
    { files: { "go.mod": "module example.com/acme/tool/v2\n" }, value: "tool", source: "go.mod" },
    {
      files: { "pyproject.toml": '[project]\nname = "Data Kit"\n' },
      value: "data-kit",
      source: "pyproject.toml",
    },
    {
      files: { "Cargo.toml": '[package]\nname = "rust-tool"\n' },
      value: "rust-tool",
      source: "Cargo.toml",
    },
    {
      files: { "pyproject.toml": '[tool.poetry]\nname = "poetry-tool"\n' },
      value: "poetry-tool",
      source: "pyproject.toml",
    },
    { files: {}, value: "app", source: "directory" },
  ])(
    "infers and renders the project name from $source [3.0#15]",
    async ({ files, value, source }) => {
      const project = addProject();
      for (const [path, bytes] of Object.entries(files)) put(project.root, path, bytes);
      const result = await added(await addCli(project, ["add", "named", "--json"]));
      expect(result.name.value).toBe(value);
      if (source === "directory") {
        expect(result.name.source).toEqual(expect.any(String));
        expect(result.name.source).not.toBe("");
      } else expect(result.name.source).toBe(source);
      expect(result.warnings).toEqual([]);
      expect(read(project.root, "name.txt")).toBe(`${value}\n`);
    },
  );

  test("malformed package JSON warns and falls through while name sources keep their precedence [3.0#15]", async () => {
    const project = addProject();
    put(project.root, "package.json", "{broken");
    put(
      project.root,
      "pyproject.toml",
      '[project]\nname = "Python Choice"\n[tool.poetry]\nname = "ignored-poetry"\n',
    );
    put(project.root, "go.mod", "module example.com/ignored-go\n");
    const result = await added(await addCli(project, ["add", "named", "--json"]));
    expect(result.name).toEqual({ value: "python-choice", source: "pyproject.toml" });
    expect(result.warnings).toHaveLength(1);
    expect(JSON.stringify(result.warnings)).toContain("package.json");
    expect(read(project.root, "name.txt")).toBe("python-choice\n");
    expect(read(project.root, "package.json")).toBe("{broken");
  });

  test("an unknown recorded stack is preserved and makes stack matching advisory [3.0#16]", async () => {
    const project = await scaffolded();
    const old = readManifestAt(project.root);
    const stack = { id: "gone-stack", origin: "removed-source", trusted: false };
    put(project.root, MANIFEST_PATH, encodeManifest({ ...old, stack }));
    const result = await added(await addCli(project, ["add", "ci-github", "--json"]));
    expect(result.warnings).toEqual(
      expect.arrayContaining([{ code: "stack_unknown", id: "gone-stack" }]),
    );
    expect(result.warnings).toHaveLength(2);
    expect(JSON.stringify(result.warnings)).toContain("ci-github");
    expect(JSON.stringify(readManifestAt(project.root).stack)).toBe(JSON.stringify(stack));
    expect(read(project.root, ".github/workflows/ci.yml")).toBe("name: fixture\n");
  });

  test("missing tools warn before writes and before the human merge list without blocking add [3.0#17]", async () => {
    const project = addProject();
    const result = await added(
      await addCli(project, ["add", "fixture-tool", "--json"], { env: { PATH: "" } }),
    );
    expect(result.missingTools).toEqual([
      {
        tool: "fixture-tool",
        owners: [{ kind: "fragment", id: "fixture-tool" }],
        drop: expect.any(Array),
      },
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(JSON.stringify(result.warnings)).toContain("fixture-tool");
    expect(read(project.root, "tool.txt")).toBe("tool file\n");
    const human = addProject();
    put(human.root, "AGENTS.md", "mine\n");
    const events: string[] = [];
    let writtenAtWarning: boolean | undefined;
    const run = await addCli(human, ["add", "fixture-tool", "--no-launch"], {
      env: { PATH: "" },
      host: { stdinIsTTY: true, stdoutIsTTY: true },
      stderr: async (text) => {
        events.push(text);
        if (text.includes("fixture-tool"))
          writtenAtWarning = existsSync(join(human.root, "tool.txt"));
      },
      stdout: async (text) => {
        events.push(text);
      },
    });
    expect(run.status).toBe(0);
    expect(run.stderr).toContain("fixture-tool");
    expect(writtenAtWarning).toBe(false);
    expect(run.stdout).toContain("Merge needed");
    expect(run.stdout).toContain(`${incoming}/AGENTS.md`);
    const all = events.join("");
    expect(all.indexOf("fixture-tool")).toBeGreaterThanOrEqual(0);
    expect(all.indexOf("fixture-tool")).toBeLessThan(all.indexOf("Merge needed"));
    expect(read(human.root, "tool.txt")).toBe("tool file\n");
  });

  test.each([
    { flags: ["--launch", "codex", "--json"] },
    { flags: ["--launch", "codex", "--no-launch", "--json"] },
  ])("handoff contradictions follow new's actual Usage rule: %j [3.0#18]", async ({ flags }) => {
    const project = addProject();
    const before = snapshot(project.root);
    const error = refused(await addCli(project, ["add", "named", ...flags]), 2, "Usage");
    expect(error.details).toEqual({
      flags: flags.includes("--no-launch") ? ["--launch", "--no-launch"] : ["--launch", "--json"],
    });
    expect(snapshot(project.root)).toEqual(before);
  });

  test("the launch preference is retained when its binary is absent [3.0#18]", async () => {
    const project = addProject();
    const run = await addCli(project, ["add", "named", "--launch", "codex"], {
      env: { PATH: "" },
      host: { stdinIsTTY: true, stdoutIsTTY: true },
    });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout).toContain("codex isn't on PATH");
    expect(run.stdout).toContain("For example: codex");
    expect(readManifestAt(project.root).handoff?.kind).toBe("print");
  });

  test.each(["--yes", "--sandbox"])(
    "%s tells the agent to take every decision's default [3.0#18]",
    async (flag) => {
      const project = addProject();
      await added(await addCli(project, ["add", "named", flag, "--json"]));
      expect(read(project.root, ".stacks/BRIEF.md")).toContain(T.decisions.yes);
      expect(read(project.root, ".stacks/BRIEF.md")).not.toContain(T.decisions.ask);
    },
  );
});

describe("add realistic existing-project cases", () => {
  test.each(["outside", "inside", "loop"])(
    "incoming symlink %s is refused before any traversal [3.0#20]",
    async (where) => {
      const project = addProject();
      liveConflicts(project.root);
      const destination =
        where === "outside" ? join(project.home, "outside") : join(project.root, "actual-incoming");
      put(destination, "private.txt", "untouched\n");
      mkdirSync(join(project.root, ".stacks"));
      const link = join(project.root, incoming);
      symlinkSync(where === "loop" ? link : destination, link);
      const before = snapshot(project.root);
      const outside = snapshot(destination);
      refused(await addCli(project, ["add", "park-a", "--json"]), 6, "PermissionDenied");
      expect(snapshot(project.root)).toEqual(before);
      expect(snapshot(destination)).toEqual(outside);
    },
  );

  test("a symlinked live ancestor cannot redirect a write outside the repository [3.0#21]", async () => {
    const project = addProject();
    const outside = join(project.home, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(project.root, ".claude"));
    const before = snapshot(project.root);
    refused(await addCli(project, ["add", "park-a", "--json"]), 6, "PermissionDenied");
    expect(snapshot(project.root)).toEqual(before);
    expect(snapshot(outside)).toEqual({});
  });

  test("--dir works from another cwd with spaces, a leading dash, non-ASCII and a symlinked project root [3.0#22]", async () => {
    const project = addProject("-資料 project");
    const alias = join(project.home, "project link");
    symlinkSync(project.root, alias);
    // Project-local registry selection must use --dir, rather than the invocation's cwd.
    projectFragment(project);
    const run = await addCli(project, ["add", "local-add", "--dir", "project link", "--json"], {
      host: { cwd: project.home },
    });
    const result = await added(run);
    expect(result).toMatchObject({
      added: ["local-add"],
      untrusted: [{ id: "local-add", origin: "project" }],
    });
    expect(read(project.root, "local.txt")).toBe("local bytes\n");
    expect(existsSync(join(project.home, "local.txt"))).toBe(false);
  });

  test.each(["broken", "newer", "directory"])(
    "an existing %s manifest is not mistaken for an absent one [3.0#23]",
    async (kind) => {
      const project = addProject();
      if (kind === "directory") mkdirSync(join(project.root, MANIFEST_PATH), { recursive: true });
      else
        put(project.root, MANIFEST_PATH, kind === "broken" ? "{broken" : '{"schemaVersion":999}');
      const before = snapshot(project.root);
      refused(
        await addCli(project, ["add", "named", "--json"]),
        kind === "directory" ? 6 : 3,
        kind === "directory" ? "PermissionDenied" : "InvalidConfig",
      );
      expect(snapshot(project.root)).toEqual(before);
    },
  );

  test("a file occupying a destination's parent rolls back without altering the file [3.0#24]", async () => {
    const project = await scaffolded();
    parkedRollback(project.root);
    put(project.root, "z-blocked", "this is a file\n");
    const before = snapshot(project.root);
    const file = recordPath(project.home, readManifestAt(project.root).projectId);
    const state = readFileSync(file);
    refused(await addCli(project, ["add", "rollback", "--json"]), 6, "PermissionDenied");
    expect(snapshot(project.root)).toEqual(before);
    expect(readFileSync(file)).toEqual(state);
    expect(
      refused(await addCli(project, ["add", "rollback", "--json"]), 6, "PermissionDenied").details,
    ).toEqual({ reason: "blocked", path: join(realpathSync(project.root), "z-blocked") });
    const text = await addCli(project, ["add", "rollback"]);
    expect(text.status).toBe(6);
    expect(text.stdout).toBe("");
    expect(text.stderr).toContain(
      "A file or directory in the project is in the way of a planned path. Nothing was changed.",
    );
    expect(text.stderr).toContain("Next: move or rename the blocking item, then run add again.");
  });

  test("a directory occupying a planned file is refused unchanged", async () => {
    const project = await scaffolded();
    mkdirSync(join(project.root, "name.txt"));
    const before = snapshot(project.root);
    expect(
      refused(await addCli(project, ["add", "named", "--json"]), 6, "PermissionDenied").details,
    ).toEqual({ reason: "blocked", path: join(realpathSync(project.root), "name.txt") });
    expect(snapshot(project.root)).toEqual(before);
  });

  test.each(['a"b', "a\\b"])("add refuses an unsafe manifest name: %s", async (name) => {
    const project = await scaffolded();
    const manifest = readManifestAt(project.root);
    put(project.root, MANIFEST_PATH, encodeManifest({ ...manifest, name }));
    const before = snapshot(project.root);
    expect(
      refused(await addCli(project, ["add", "named", "--json"]), 2, "BadInput").details,
    ).toEqual({ id: name, flag: "name" });
    expect(snapshot(project.root)).toEqual(before);
  });

  test("git-hook repository variables cannot make an own-repo fragment probe the wrong repository [3.0#25]", async () => {
    const project = addProject();
    const elsewhere = join(project.home, "other repo");
    mkdirSync(elsewhere);
    expect(spawnGit(["init", "--quiet", elsewhere]).status).toBe(0);
    const before = snapshot(elsewhere);
    await added(
      await addCli(project, ["add", "own-repo", "--json"], {
        env: {
          GIT_DIR: join(elsewhere, ".git"),
          GIT_WORK_TREE: elsewhere,
          GIT_INDEX_FILE: join(elsewhere, "index"),
        },
      }),
    );
    expect(read(project.root, "own.txt")).toBe("own repo file\n");
    expect(snapshot(elsewhere)).toEqual(before);
    expect(existsSync(join(elsewhere, "index"))).toBe(false);
  });

  test("edited metadata ignores and pending incoming files survive a later unrelated add [3.0#26]", async () => {
    const project = await scaffolded();
    put(project.root, ".stacks/.gitignore", "# edited by the project\n/NOTES.md\n");
    put(project.root, `${incoming}/unmerged.yml`, "earlier contribution\n");
    const result = await added(await addCli(project, ["add", "named", "--json"]));
    expect(read(project.root, ".stacks/.gitignore")).toBe("# edited by the project\n/NOTES.md\n");
    expect(result.mergeNeeded).toEqual([
      { path: "unmerged.yml", incoming: [`${incoming}/unmerged.yml`] },
    ]);
    expect(read(project.root, `${incoming}/unmerged.yml`)).toBe("earlier contribution\n");
    expect(read(project.root, ".stacks/BRIEF.md")).toContain(`${incoming}/unmerged.yml`);
  });

  test("existing fragments satisfy requires and conflicts while personal always defaults stay out [3.0#27]", async () => {
    const project = await scaffolded();
    put(project.home, "config/stacks/config.json", '{"always":["other-only"]}');
    const result = await added(await addCli(project, ["add", "ci-github", "--json"]));
    expect(result.added).toEqual(["ci-github"]);
    expect(result.warnings).toEqual([]);
    expect(
      readManifestAt(project.root).verify.filter((step) => step.name === "required-check"),
    ).toHaveLength(1);
    expect(existsSync(join(project.root, "other.txt"))).toBe(false);
    const before = snapshot(project.root);
    expect(
      refused(await addCli(project, ["add", "conflicting", "--json"]), 2, "ComposeConflict")
        .details,
    ).toMatchObject({ reason: "conflicts" });
    expect(snapshot(project.root)).toEqual(before);
    expect(
      refused(await addCli(project, ["add", "step-clash", "--json"]), 2, "ComposeConflict").details,
    ).toMatchObject({ reason: "step_name" });
    expect(snapshot(project.root)).toEqual(before);
  });

  test("a new fragment's malformed conditionals fail before any writes [3.0#28]", async () => {
    const project = addProject();
    const dir = writeEntry({
      root: project.registry,
      kind: "fragment",
      dir: "bad-conditional",
      frontmatter: minimal("fragment", "bad-conditional"),
      body: "<!-- stacks:when mode=add -->\nunclosed\n",
    });
    put(dir, "files/should-not-exist.txt", "must not land\n");
    const before = snapshot(project.root);
    expect(
      refused(await addCli(project, ["add", "bad-conditional", "--json"]), 2, "EntryInvalid")
        .details,
    ).toMatchObject({ reason: "conditional" });
    expect(snapshot(project.root)).toEqual(before);
  });

  test("case-colliding destinations are parked on case-insensitive volumes (macOS) [3.0#29]", async () => {
    const project = addProject();
    put(project.root, "readme.md", "user's lower-case readme\n");
    const insensitive = existsSync(join(project.root, "README.md"));
    const result = await added(await addCli(project, ["add", "park-a", "--json"]));
    expect(read(project.root, "readme.md")).toBe("user's lower-case readme\n");
    if (insensitive) {
      expect(result.mergeNeeded).toContainEqual({
        path: "README.md",
        incoming: [`${incoming}/README.md`],
      });
      expect(read(project.root, `${incoming}/README.md`)).toBe("first incoming readme\n");
    } else expect(read(project.root, "README.md")).toBe("first incoming readme\n");
  });

  test.skipIf(process.getuid?.() === 0)(
    "an unwritable state directory rolls back all project changes and preserves the old record [3.0#30]",
    async () => {
      const project = await scaffolded();
      parkedRollback(project.root);
      const file = recordPath(project.home, readManifestAt(project.root).projectId);
      const state = readFileSync(file);
      const directory = join(file, "..");
      chmodSync(directory, 0o555);
      const before = snapshot(project.root);
      try {
        refused(await addCli(project, ["add", "rollback", "--json"]), 6, "PermissionDenied");
        expect(snapshot(project.root)).toEqual(before);
        expect(readFileSync(file)).toEqual(state);
      } finally {
        chmodSync(directory, 0o755);
      }
    },
  );
});

test("an untrusted first add records the empty baseline until a human accepts it [3.0#6]", async () => {
  const project = addProject();
  projectFragment(project);
  const result = await added(
    await addCli(project, ["add", "local-add", "--json"], { env: { CLAUDECODE: "1" } }),
  );
  expect(result).toMatchObject({ createdManifest: true, digestRecorded: false, tamperCheck: null });
  const after = readManifestAt(project.root);
  expect(after.verifyDigest).toBe(digestSteps({ verify: [], env: {}, preset: after.preset }));
  expect(readRecord(recordPath(project.home, after.projectId)).verifyDigest).toBe(
    after.verifyDigest,
  );
  expect(read(project.root, "local.txt")).toBe("local bytes\n");
  const run = await addCli(project, ["verify", "--json"]);
  expect(run.status).toBe(5);
  expect(decodeVerify(run.stdout)).toMatchObject({
    outcome: "changed",
    changed: { added: ["local-check"] },
  });
  expect(JSON.parse(run.stderr)).toMatchObject({ error: { tag: "VerifyChanged" } });
  expect(existsSync(join(project.root, "local-ran"))).toBe(false);
});

test.each([{ flags: ["--sandbox"] }, { flags: ["--agents", "codex"] }])(
  "flags cannot silently change a recorded preset or agent selection: %j [3.0#31]",
  async ({ flags }) => {
    const project = await scaffolded();
    const before = snapshot(project.root);
    const file = recordPath(project.home, readManifestAt(project.root).projectId);
    const state = readFileSync(file);
    refused(await addCli(project, ["add", "named", ...flags, "--json"]), 2, "BadInput");
    expect(snapshot(project.root)).toEqual(before);
    expect(readFileSync(file)).toEqual(state);
  },
);

test.each([
  { ids: ["named", "namde"], tag: "NotFound" },
  { ids: ["fixture-stack"], tag: "BadInput" },
  { ids: [], tag: "Usage" },
])("invalid fragment requests refuse the whole operation: %j [3.0#32]", async ({ ids, tag }) => {
  const project = addProject();
  const before = snapshot(project.root);
  const error = refused(await addCli(project, ["add", ...ids, "--json"]), 2, tag);
  if (tag === "NotFound")
    expect(error.details).toMatchObject({ id: "namde", suggestions: ["named"] });
  expect(snapshot(project.root)).toEqual(before);
});

test.skipIf(process.getuid?.() === 0)(
  "an unreadable existing manifest refuses without replacing metadata [3.0#33]",
  async () => {
    const project = await scaffolded();
    const file = join(project.root, MANIFEST_PATH);
    const bytes = readFileSync(file);
    chmodSync(file, 0o000);
    try {
      refused(await addCli(project, ["add", "named", "--json"]), 6, "PermissionDenied");
    } finally {
      chmodSync(file, 0o644);
    }
    expect(readFileSync(file)).toEqual(bytes);
    expect(existsSync(join(project.root, "name.txt"))).toBe(false);
  },
);

test("a known stack enforces fragment compatibility without changing project or state [3.0#16]", async () => {
  const project = await scaffolded();
  const before = snapshot(project.root);
  const file = recordPath(project.home, readManifestAt(project.root).projectId);
  const state = readFileSync(file);
  expect(
    refused(await addCli(project, ["add", "other-only", "--json"]), 2, "ComposeConflict").details,
  ).toMatchObject({ reason: "applies_to", ids: ["other-only"] });
  expect(snapshot(project.root)).toEqual(before);
  expect(readFileSync(file)).toEqual(state);
});

test("astro-blog refuses bun-release as inapplicable", async () => {
  const project = addProject();
  project.registry = join(import.meta.dirname, "../registry");
  const created = await addCli(project, [
    "new",
    "astro-blog",
    project.root,
    "--no-launch",
    "--json",
  ]);
  expect(created.status).toBe(0);
  expect(created.stderr).toBe("");
  const before = snapshot(project.root);
  expect(
    refused(await addCli(project, ["add", "bun-release", "--json"]), 2, "ComposeConflict").details,
  ).toMatchObject({ reason: "applies_to", ids: ["bun-release"] });
  expect(snapshot(project.root)).toEqual(before);
});

test("an absent dependency is added once before its dependent in a plain repository [3.0#1]", async () => {
  const project = addProject();
  const result = await added(await addCli(project, ["add", "ci-github", "--json"]));
  expect(result.added).toEqual(["fixture-required", "ci-github"]);
  expect(result.alreadyApplied).toEqual([]);
  expect(result.written).toEqual([".github/workflows/ci.yml", "AGENTS.md", "required.txt"]);
  const after = readManifestAt(project.root);
  expect(after.fragments.map((entry) => entry.id)).toEqual(["fixture-required", "ci-github"]);
  expect(after.verify.map((step) => step.name)).toEqual(["required-check", "ci-check"]);
  expect(read(project.root, "required.txt")).toBe("required bytes\n");
  expect(read(project.root, ".github/workflows/ci.yml")).toBe("name: fixture\n");
});

test("without yes or sandbox the brief asks for its decisions [3.0#18]", async () => {
  const project = addProject();
  await added(await addCli(project, ["add", "named", "--json"]));
  const brief = read(project.root, ".stacks/BRIEF.md");
  expect(brief).toContain(T.decisions.ask);
  expect(brief).not.toContain(T.decisions.yes);
});

test("add examples use the manifest's first target agent when --agents is omitted", async () => {
  const project = addProject();
  const created = await addCli(project, [
    "new",
    "fixture-stack",
    project.root,
    "--agents",
    "codex",
    "--json",
  ]);
  expect(created.status).toBe(0);
  expect(created.stderr).toBe("");
  expect(JSON.parse(created.stdout).agents).toEqual(["codex"]);
  const result = await addCli(project, ["add", "ci-github", "--no-launch"], {
    host: { stdinIsTTY: true, stdoutIsTTY: true },
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.trimEnd().split("\n").at(-1)).toBe(
    `For example: codex "Read .stacks/BRIEF.md and carry it out. It's your full task for this project; you're done when stacks verify passes."`,
  );
  expect(readManifestAt(project.root).agents).toEqual(["codex"]);
});

test.each([
  ["go-api", "docker-deploy", "health"],
  ["astro-blog", "cloudflare-pages", "adapter"],
])("add %s notes under %s from the current recipe", async (stack, fragment, note) => {
  const project = { ...addProject(), registry: join(import.meta.dirname, "../registry") };
  const created = await addCli(project, ["new", stack, project.root, "--json"]);
  expect(created.status).toBe(0);
  await added(await addCli(project, ["add", fragment, "--json"]));
  const brief = read(project.root, ".stacks/BRIEF.md");
  expect(brief).toContain(`From the \`${stack}\` recipe`);
  expect(brief.slice(brief.indexOf(`From the \`${stack}\` recipe`))).toContain(note);
});

test("add includes only matching notes from the stack and applied fragments, and protects untrusted notes", async () => {
  const project = await scaffolded();
  const notes = (label: string) =>
    `\n<!-- stacks:when with=ci-github mode=add -->\n${label}\n<!-- stacks:end -->\n<!-- stacks:when with=named -->\nOTHER NOTE\n<!-- stacks:end -->\n`;
  for (const [source, label] of [
    ["stacks/fixture-stack/STACK.md", "STACK ADD NOTE"],
    ["fragments/fixture-required/FRAGMENT.md", "APPLIED ADD NOTE"],
  ] as const)
    put(project.registry, source, read(project.registry, source) + notes(label));
  cpSync(
    join(project.registry, "stacks/fixture-stack"),
    join(project.root, ".stacks/stacks/fixture-stack"),
    { recursive: true },
  );
  const result = await added(await addCli(project, ["add", "ci-github", "--json"]));
  const brief = read(project.root, ".stacks/BRIEF.md");
  expect(brief).toContain("STACK ADD NOTE");
  expect(brief).toContain("APPLIED ADD NOTE");
  expect(brief).not.toContain("OTHER NOTE");
  expect(brief).not.toContain("STACK BODY MUST NOT REAPPEAR");
  expect(brief).not.toContain("EXISTING BODY MUST NOT REAPPEAR");
  expect(result.untrusted).toMatchObject([{ id: "fixture-stack", origin: "project" }]);
  expect(result.handoff.kind).toBe("print");
  expect(
    decideHandoff({
      detected: "none",
      json: false,
      launch: true,
      stdinIsTTY: true,
      stdoutIsTTY: true,
      configured: [],
      found: new Map([
        ["codex", "/bin/codex"],
        ["claude", "/bin/claude"],
      ]),
      prompt: "apply",
      untrusted: result.untrusted.map((entry) => entry.id),
    }),
  ).toMatchObject({ kind: "print", reason: "untrusted" });
});

test("add selects the recorded stack overlay and parks conflicts without overwriting", async () => {
  const project = await scaffolded();
  const dir = writeEntry({
    root: project.registry,
    kind: "fragment",
    dir: "overlaid",
    frontmatter: minimal("fragment", "overlaid"),
  });
  put(dir, "stacks/fixture-stack/chosen.txt.tmpl", "{{project_name}} overlay\\n");
  put(dir, "stacks/other-stack/other.txt", "wrong host");
  put(project.root, "chosen.txt", "keep mine");
  const result = await added(await addCli(project, ["add", "overlaid", "--json"]));
  expect(result.written).not.toContain("other.txt");
  expect(result.mergeNeeded).toEqual([
    { path: "chosen.txt", incoming: [".stacks/incoming/chosen.txt"] },
  ]);
  expect(read(project.root, "chosen.txt")).toBe("keep mine");
  expect(read(project.root, ".stacks/incoming/chosen.txt")).toBe("app overlay\\n");
});

test("an unavailable recorded stack falls back to inferred tags", async () => {
  const project = await scaffolded();
  rmSync(join(project.registry, "stacks/fixture-stack"), { recursive: true });
  put(project.root, "go.mod", "module example.test/app\n");
  writeEntry({
    root: project.registry,
    kind: "fragment",
    dir: "tagged",
    frontmatter: minimal("fragment", "tagged"),
    body: "<!-- stacks:when tag=go -->\nGO NOTE\n<!-- stacks:end -->\n",
  });
  const result = await added(await addCli(project, ["add", "tagged", "--json"]));
  expect(result.inferredTags).toEqual(["go"]);
  expect(result.warnings).toContainEqual({ code: "stack_unknown", id: "fixture-stack" });
  expect(read(project.root, ".stacks/BRIEF.md")).toContain("GO NOTE");
});

test("add does not ask to create AGENTS.md when guidance only mentions the file", async () => {
  const project = addProject();
  writeEntry({
    root: project.registry,
    kind: "fragment",
    dir: "mention",
    frontmatter: minimal("fragment", "mention"),
    body: "Read `AGENTS.md` if present.\n",
  });
  await added(await addCli(project, ["add", "mention", "--json"]));
  expect(read(project.root, ".stacks/BRIEF.md")).not.toContain("Create `AGENTS.md`");
});

test.each([
  {
    files: {
      "package.json": '{"scripts":{},"workspaces":[]}',
      Makefile: "all:",
      "bun.lockb": "lock",
      "tsconfig.json": "{}",
      "pyproject.toml": "",
      "Cargo.toml": "",
    },
    tags: ["bun", "make", "monorepo", "node", "python", "rust", "typescript"],
  },
  {
    files: { "first/go.mod": "", "second/Cargo.toml": "", "third/child/package.json": "{}" },
    tags: ["monorepo"],
  },
  {
    files: {
      "first/go.mod": "",
      "first/package.json": "{}",
      "second/child/Cargo.toml": "",
      "package.json": "broken json",
      "bun.lock": "",
    },
    tags: ["bun", "node"],
  },
])(
  "inferred tags inspect immediate manifest directories and honour Makefile precedence: $tags",
  async ({ files, tags }) => {
    const project = addProject();
    for (const [path, bytes] of Object.entries(files))
      if (bytes !== undefined) put(project.root, path, bytes);
    const result = await added(await addCli(project, ["add", "named", "--json"]));
    expect(result.inferredTags).toEqual(tags);
  },
);

test.each([
  [
    "go",
    { "go.mod": "module example.test/app\n", Makefile: "test:\n\tgo test ./...\n" },
    ["go", "make"],
  ],
  [
    "bun",
    { "package.json": '{"scripts":{},"packageManager":"bun@1"}' },
    ["bun", "node", "scripts"],
  ],
])(
  "add infers %s tags for conditionals without restricting stackless fit",
  async (_name, files, tags) => {
    const project = addProject();
    for (const [path, text] of Object.entries(files))
      if (text !== undefined) put(project.root, path, text);
    writeEntry({
      root: project.registry,
      kind: "fragment",
      dir: "tagged",
      frontmatter: minimal("fragment", "tagged", "applies_to: [unrelated]"),
      body: tags
        .map((tag) => `<!-- stacks:when tag=${tag} -->\nBRANCH ${tag}\n<!-- stacks:end -->`)
        .join("\n"),
    });
    await added(await addCli(project, ["add", "tagged", "--json"]));
    const brief = read(project.root, ".stacks/BRIEF.md");
    expect(brief).toContain(`Inferred tags: ${tags.join(", ")}`);
    for (const tag of tags) expect(brief).toContain(`BRANCH ${tag}`);
    expect(readManifestAt(project.root)).not.toHaveProperty("inferredTags");
    const recorded = await scaffolded();
    cpSync(
      join(project.registry, "fragments/tagged"),
      join(recorded.registry, "fragments/tagged"),
      { recursive: true },
    );
    refused(await addCli(recorded, ["add", "tagged", "--json"]), 2, "ComposeConflict");
  },
);

test("an add brief tells the agent to keep .stacks out of the repository's formatter and linter", async () => {
  const project = addProject();
  writeEntry({
    root: project.registry,
    kind: "fragment",
    dir: "plain",
    frontmatter: minimal("fragment", "plain"),
    body: "Plain guidance.",
  });
  await added(await addCli(project, ["add", "plain", "--json"]));
  expect(read(project.root, ".stacks/BRIEF.md")).toContain(
    '- Exclude `.stacks/` from the repository\'s formatter and linter (Biome `"!.stacks"` in `files.includes`, `.prettierignore`, ruff `extend-exclude`), then format the files this brief added.',
  );
});

test("add into a recorded sandbox takes decision defaults without the flag", async () => {
  const project = addProject();
  expect(
    (await addCli(project, ["new", "fixture-stack", project.root, "--sandbox", "--json"])).status,
  ).toBe(0);
  writeEntry({
    root: project.registry,
    kind: "fragment",
    dir: "decision",
    frontmatter: minimal("fragment", "decision", "decisions: [Choose a colour (default blue)]"),
  });
  await added(await addCli(project, ["add", "decision", "--json"]));
  expect(read(project.root, ".stacks/BRIEF.md")).toContain(T.decisions.yes);
  expect(read(project.root, ".stacks/BRIEF.md")).not.toContain(T.decisions.ask);
});

test.each([false, true])(
  "add asks to create AGENTS.md only when a section needs it (present=%s)",
  async (present) => {
    const project = addProject();
    if (present) put(project.root, "AGENTS.md", "# Project\n");
    writeEntry({
      root: project.registry,
      kind: "fragment",
      dir: "guidance",
      frontmatter: minimal("fragment", "guidance"),
      body: "## AGENTS.md\n\nA **Testing** section describing real checks.\n",
    });
    await added(await addCli(project, ["add", "guidance", "--json"]));
    expect(read(project.root, ".stacks/BRIEF.md").includes("Create `AGENTS.md`")).toBe(!present);
  },
);
