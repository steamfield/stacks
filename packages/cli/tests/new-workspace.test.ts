import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Manifest } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import { MANIFEST_PATH } from "../src/core/project/manifest";
import { NewResult } from "../src/schemas/new";
import { VerifyResult } from "../src/schemas/verify";
import { fakeAgent } from "./helpers/agents";
import { quiet, runCli, tempDir } from "./helpers/cli";
import { newWorkspace, workspaceRegistry, workspaceVariant } from "./helpers/workspace";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
/** `newWorkspace`, with its temp HOME removed after the test. */
async function created(options: Parameters<typeof newWorkspace>[0] = {}) {
  const made = await newWorkspace(options);
  cleanups.push(() => rmSync(dirname(made.target), { recursive: true, force: true }));
  return { ...made, home: dirname(made.target) };
}
function variant(edit: (root: string) => void): string {
  const { root, cleanup } = workspaceVariant(edit);
  cleanups.push(cleanup);
  return root;
}
function replaceIn(root: string, file: string, from: string, to: string) {
  const path = join(root, file);
  const text = readFileSync(path, "utf8");
  if (!text.includes(from)) throw new Error(`${file} has no ${JSON.stringify(from)}`);
  writeFileSync(path, text.replace(from, to));
}
const PAIR = "stacks/pair/STACK.md";
const API = "stacks/api-part/STACK.md";

const manifestAt = (project: string) =>
  Schema.decodeUnknownSync(Manifest)(
    JSON.parse(readFileSync(join(project, MANIFEST_PATH), "utf8")),
    { onExcessProperty: "error" },
  );
/** The last stderr line, parsed but not decoded: the envelope schema keeps only one details shape. */
const envelope = (stderr: string) =>
  JSON.parse(stderr.trim().split("\n").at(-1) ?? "") as {
    error: { tag: string; details?: Record<string, unknown> };
  };
const verifyIn = (home: string, project: string, args: string[]) =>
  runCli(["verify", ...args, "--json"], {
    home,
    env: { ...quiet, PATH: process.env.PATH ?? "" },
    host: { cwd: project, registry: workspaceRegistry },
  });

describe("new pair", () => {
  test("writes each part under its directory, the workspace and hoisted files at the root, and a manifest with parts and cwd steps", async () => {
    const { result, target } = await created();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(Schema.decodeUnknownSync(NewResult)(JSON.parse(result.stdout)).stack).toBe("pair");
    for (const path of [
      "Makefile",
      "README.md",
      "AGENTS.md",
      ".env.example",
      ".claude/settings.json",
      ".claude/hooks/shared-guard.sh",
      ".claude/hooks/harness-guard.sh",
      ".github/workflows/ci.yml",
      "backend/README.md",
      "backend/AGENTS.md",
      "backend/src/index.ts",
      "backend/src/notes.ts",
      "backend/config/app.json",
      "backend/.claude/rules/api.md",
      "frontend/README.md",
      "frontend/AGENTS.md",
      "frontend/src/main.ts",
      "frontend/orval.config.ts",
    ])
      expect(existsSync(join(target, path)), path).toBe(true);
    for (const path of [
      "src",
      "backend/.claude/settings.json",
      "frontend/.claude",
      "orval.config.ts",
    ])
      expect(existsSync(join(target, path)), path).toBe(false);
    expect(JSON.parse(readFileSync(join(target, "backend/package.json"), "utf8"))).toEqual({
      name: "app-api",
      private: true,
    });
    expect(statSync(join(target, ".claude/hooks/shared-guard.sh")).mode & 0o111).not.toBe(0);

    const manifest = manifestAt(target);
    expect(manifest.parts).toEqual([
      { name: "backend", role: "api", stack: { id: "api-part", origin: "bundled", trusted: true } },
      {
        name: "frontend",
        role: "web",
        stack: { id: "web-part", origin: "bundled", trusted: true },
      },
    ]);
    expect(manifest.verify.map(({ name, cwd, owner }) => [name, cwd ?? null, owner])).toEqual([
      ["both", null, "pair"],
      ["readme-filled", null, "pair"],
      ["backend-install", "backend", "api-part"],
      ["backend-lint", "backend", "api-part"],
      ["backend-test", "backend", "api-part"],
      ["backend-openapi-drift", "backend", "api-part"],
      ["backend-api", "backend", "api-part"],
      ["frontend-install", "frontend", "web-part"],
      ["frontend-lint", "frontend", "web-part"],
      ["frontend-test", "frontend", "web-part"],
      ["frontend-web", "frontend", "web-part"],
      ["frontend-client-drift", "frontend", "client-link"],
      ["harness-ok", null, "harness"],
      ["ci-config", null, "root-ci"],
    ]);
    expect(manifest.commands["backend-lint"]).toBe("Check the source");
  });

  test("a single stack's manifest has no parts key", async () => {
    const home = tempDir();
    cleanups.push(home.cleanup);
    const result = await runCli(
      ["new", "api-part", join(home.path, "solo"), "--no-launch", "--json"],
      {
        home: home.path,
        env: { ...quiet, PATH: process.env.PATH ?? "" },
        host: { registry: workspaceRegistry },
      },
    );
    expect(result.status).toBe(0);
    const raw = JSON.parse(readFileSync(join(home.path, "solo", MANIFEST_PATH), "utf8"));
    expect(Object.hasOwn(raw, "parts")).toBe(false);
  });

  test("verify --only a part step runs it in the part directory the manifest's digested cwd names", async () => {
    const { target, home } = await created();
    const ran = await verifyIn(home, target, ["--only", "backend-lint"]);
    expect(ran.status).toBe(0);
    const report = Schema.decodeUnknownSync(VerifyResult)(JSON.parse(ran.stdout));
    expect(report.steps.find((step) => step.name === "backend-lint")?.status).toBe("passed");
    // The same check from the root fails, so the pass came from `backend/`.
    expect(existsSync(join(target, "src/index.ts"))).toBe(false);
  });
});

describe("the tamper check", () => {
  test("an edited mounted cwd is a changed step; an edited parts name is outside the digest", async () => {
    const { target, home } = await created();
    const path = join(target, MANIFEST_PATH);
    const original = readFileSync(path, "utf8");
    const renamed = JSON.parse(original);
    renamed.parts[0].name = "server";
    writeFileSync(path, `${JSON.stringify(renamed, null, 2)}\n`);
    const unchanged = await verifyIn(home, target, ["--only", "backend-lint"]);
    expect(unchanged.status).toBe(0);

    const moved = JSON.parse(original);
    const lint = moved.verify.find((step: { name: string }) => step.name === "backend-lint");
    lint.cwd = "frontend";
    writeFileSync(path, `${JSON.stringify(moved, null, 2)}\n`);
    const changed = await verifyIn(home, target, ["--only", "backend-lint"]);
    expect(changed.status).toBe(5);
    expect(envelope(changed.stderr).error.tag).toBe("VerifyChanged");
    const report = Schema.decodeUnknownSync(VerifyResult)(JSON.parse(changed.stdout));
    expect(new Set(report.steps.map((step) => step.status))).toEqual(new Set(["skipped"]));
  });
});

describe("refusals", () => {
  const refused = async (root: string, details: Record<string, unknown>) => {
    const { result, target } = await created({ root });
    expect(result.stdout).toBe("");
    expect(result.status).toBe(2);
    expect(envelope(result.stderr).error).toMatchObject({ tag: "EntryInvalid" });
    expect(envelope(result.stderr).error.details).toEqual(details);
    expect(existsSync(target)).toBe(false);
  };

  test.each([
    ["part_stack", "stack: web-part }", "stack: no-such-stack }", "frontend"],
    ["part_role", "role: web, stack: web-part", "role: mobile, stack: web-part", "frontend"],
    ["part_name_duplicate", "name: frontend,", "name: backend,", "backend"],
    ["part_nested", "stack: web-part }", "stack: pair }", "frontend"],
    ["part_roles", "role: web, stack: web-part", "role: api, stack: web-part", undefined],
    ["part_roles", "role: api, stack: api-part", "role: web, stack: api-part", undefined],
  ])("%s (%s to %s) is EntryInvalid naming the workspace", async (reason, from, to, part) => {
    await refused(
      variant((at) => replaceIn(at, PAIR, from, to)),
      {
        id: "pair",
        origin: "bundled",
        reason,
        ...(part ? { part } : {}),
      },
    );
  });

  test("a part name that isn't kebab-case fails to decode, as before", async () => {
    await refused(
      variant((at) => replaceIn(at, PAIR, "name: backend,", "name: Backend,")),
      { id: "pair", origin: "bundled", reason: "decode", path: "STACK.md" },
    );
  });

  test("a part step whose cwd leaves the part is part_cwd, and nothing is written", async () => {
    const root = variant((at) =>
      replaceIn(
        at,
        API,
        "verify:\n",
        'verify:\n  - { name: escape, layer: check, run: "true", cwd: ".." }\n',
      ),
    );
    await refused(root, {
      id: "pair",
      origin: "bundled",
      reason: "part_cwd",
      part: "backend",
      step: "backend-escape",
    });
  });

  test("the workspace shipping a file where a part directory goes is file_owner naming both", async () => {
    const root = variant((at) =>
      cpSync(join(at, "stacks/pair/files/README.md"), join(at, "stacks/pair/files/backend")),
    );
    const { result, target } = await created({ root });
    expect(result.stdout).toBe("");
    expect(result.status).toBe(2);
    expect(envelope(result.stderr).error).toMatchObject({ tag: "ComposeConflict" });
    expect(envelope(result.stderr).error.details).toEqual({
      reason: "file_owner",
      stack: "pair",
      ids: [],
      path: "backend/.claude/rules/api.md",
      parts: ["backend"],
    });
    expect(existsSync(target)).toBe(false);
  });
});

describe("trust", () => {
  test("a project-root shadow of a part makes the workspace untrusted: listed, and never launched", async () => {
    const home = tempDir();
    cleanups.push(home.cleanup);
    const shadow = join(home.path, ".stacks", "stacks", "web-part");
    mkdirSync(dirname(shadow), { recursive: true });
    cpSync(join(workspaceRegistry, "stacks", "web-part"), shadow, { recursive: true });
    const claude = fakeAgent(join(home.path, "bin"), "claude");
    const result = await runCli(["new", "pair", "app"], {
      home: home.path,
      env: { ...quiet, PATH: `${join(home.path, "bin")}:${process.env.PATH ?? ""}` },
      host: { registry: workspaceRegistry, cwd: home.path, stdinIsTTY: true, stdoutIsTTY: true },
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "Not launching an agent: this project uses entries this machine hasn't trusted (web-part; listed above).",
    );
    expect(claude.ran()).toBe(false);
    expect(manifestAt(join(home.path, "app")).parts?.[1]?.stack).toEqual({
      id: "web-part",
      origin: "project",
      trusted: false,
    });
  });
});
