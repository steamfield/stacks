import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Manifest } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import { encodeManifest, MANIFEST_PATH } from "../src/core/project/manifest";
import { ErrorEnvelope } from "../src/errors";
import { added, refused, snapshot } from "./helpers/add";
import { quiet, runCli } from "./helpers/cli";
import { minimal, writeEntry } from "./helpers/registry";
import { newWorkspace, workspaceRegistry, workspaceVariant } from "./helpers/workspace";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A `pair` project from `newWorkspace`, its temp HOME removed after the test. */
async function created() {
  const { result, target } = await newWorkspace();
  const home = dirname(target);
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  expect(result.status, result.stderr).toBe(0);
  return { home, project: target };
}
function variant(edit: (root: string) => void): string {
  const { root, cleanup } = workspaceVariant(edit);
  cleanups.push(cleanup);
  return root;
}
type Created = Awaited<ReturnType<typeof created>>;
const addIn = (
  { home, project }: Created,
  args: string[],
  options: { registry?: string; env?: Record<string, string> } = {},
) =>
  runCli(["add", ...args, "--json"], {
    home,
    env: { ...quiet, PATH: process.env.PATH ?? "", ...options.env },
    host: { cwd: project, registry: options.registry ?? workspaceRegistry },
  });
const manifestAt = (project: string) =>
  Schema.decodeUnknownSync(Manifest)(
    JSON.parse(readFileSync(join(project, MANIFEST_PATH), "utf8")),
    { onExcessProperty: "error" },
  );
const editManifest = (project: string, edit: (manifest: Manifest) => Manifest) =>
  writeFileSync(join(project, MANIFEST_PATH), encodeManifest(edit(manifestAt(project))));
/** The paths `after` adds or changes relative to `before`. */
const changedPaths = (before: Record<string, string>, after: Record<string, string>) =>
  Object.keys(after)
    .filter((path) => before[path] !== after[path])
    .sort();
const stepsOf = (manifest: Manifest, names: string[]) =>
  manifest.verify
    .filter((step) => names.includes(step.name))
    .map(({ name, cwd, owner }) => ({ name, cwd, owner }));

/** The files and directories a successful `add db` changes on a `pair` project mounted at `dir`. */
const dbChanges = (dir: string) => [
  ".stacks/BRIEF.md",
  ".stacks/incoming",
  ".stacks/incoming/backend",
  ".stacks/incoming/backend/config",
  ".stacks/incoming/backend/config/app.json",
  ".stacks/manifest.json",
  ".stacks/sources.json",
  `${dir}/src/db.ts`,
];

describe("add on a workspace project", () => {
  test("add db writes only the api part's overlay under backend/ with prefixed cwd steps", async () => {
    const made = await created();
    const before = snapshot(made.project);
    const previous = manifestAt(made.project);
    const result = await added(await addIn(made, ["db"]));
    expect(result).toMatchObject({
      stack: "pair",
      added: ["db"],
      written: ["backend/src/db.ts"],
      mergeNeeded: [
        { path: "backend/config/app.json", incoming: [".stacks/incoming/backend/config/app.json"] },
      ],
      missingRequired: [],
      warnings: [],
      untrusted: [],
      digestRecorded: true,
    });
    expect(changedPaths(before, snapshot(made.project))).toEqual(dbChanges("backend"));
    expect(existsSync(join(made.project, "frontend/src/db-client.ts"))).toBe(false);
    const manifest = manifestAt(made.project);
    expect(stepsOf(manifest, ["backend-up", "backend-migrate"])).toEqual([
      { name: "backend-up", cwd: "backend", owner: "db" },
      { name: "backend-migrate", cwd: "backend", owner: "db" },
    ]);
    expect(manifest.parts).toEqual(previous.parts);
    expect(manifest.fragments.map((ref) => ref.id)).toEqual([
      ...previous.fragments.map((ref) => ref.id),
      "db",
    ]);
  });

  test("a fragment that fits neither a part nor the workspace is refused with nothing written", async () => {
    const made = await created();
    const registry = variant((root) =>
      writeEntry({
        root,
        kind: "fragment",
        dir: "go-only",
        frontmatter: minimal("fragment", "go-only", "applies_to: [go-cli]"),
      }),
    );
    const before = snapshot(made.project);
    const error = refused(await addIn(made, ["go-only"], { registry }), 2, "ComposeConflict");
    expect(error.details).toEqual({ reason: "applies_to", ids: ["go-only"] });
    expect(snapshot(made.project)).toEqual(before);
  });

  test("a placed fragment whose prefixed step equals an existing step is refused before writing", async () => {
    const made = await created();
    const registry = variant((root) =>
      writeEntry({
        root,
        kind: "fragment",
        dir: "lint-again",
        frontmatter: minimal(
          "fragment",
          "lint-again",
          [
            "applies_to: [api-part]",
            "verify:",
            '  - { name: lint, layer: lint, run: "true" }',
          ].join("\n"),
        ),
      }),
    );
    const before = snapshot(made.project);
    const error = refused(await addIn(made, ["lint-again"], { registry }), 2, "ComposeConflict");
    expect(error.details).toEqual({
      reason: "step_name",
      ids: ["lint-again"],
      step: "backend-lint",
    });
    expect(snapshot(made.project)).toEqual(before);
  });

  test("missingRequired names a workspace-required fragment the project dropped", async () => {
    const made = await created();
    editManifest(made.project, (manifest) => ({
      ...manifest,
      fragments: manifest.fragments.filter((ref) => ref.id !== "client-link"),
    }));
    const result = await added(await addIn(made, ["db"]));
    expect(result.missingRequired).toEqual([
      { id: "client-link", command: expect.stringMatching(/ add client-link$/) },
    ]);
  });

  test.each([
    ["removed", (dir: string) => rmSync(dir, { recursive: true })],
    [
      "a file",
      (dir: string) => {
        rmSync(dir, { recursive: true });
        writeFileSync(dir, "not a directory\n");
      },
    ],
    [
      "a symlink to another directory",
      (dir: string) => {
        rmSync(dir, { recursive: true });
        mkdirSync(`${dir}-elsewhere`);
        symlinkSync(`${dir}-elsewhere`, dir);
      },
    ],
  ])(
    "a part directory that is %s is refused as blocked with the project unchanged",
    async (_, edit) => {
      const made = await created();
      edit(join(made.project, "frontend"));
      const before = snapshot(made.project);
      const error = refused(await addIn(made, ["db"]), 6, "PermissionDenied");
      expect(error.details).toEqual({ reason: "blocked", path: "frontend" });
      expect(snapshot(made.project)).toEqual(before);
    },
  );

  test("an edited Manifest.parts name places the fragment in that directory, tamper baseline untouched", async () => {
    const made = await created();
    mkdirSync(join(made.project, "server"));
    editManifest(made.project, (manifest) => ({
      ...manifest,
      parts: (manifest.parts ?? []).map((part) =>
        part.name === "backend" ? { ...part, name: "server" } : part,
      ),
    }));
    const before = snapshot(made.project);
    const result = await added(await addIn(made, ["db"]));
    // `server/` has no live config, so the merge path is written rather than parked.
    expect(result).toMatchObject({
      written: ["server/config/app.json", "server/src/db.ts"],
      mergeNeeded: [],
      tamperCheck: "full",
    });
    expect(stepsOf(manifestAt(made.project), ["server-up", "server-migrate"])).toEqual([
      { name: "server-up", cwd: "server", owner: "db" },
      { name: "server-migrate", cwd: "server", owner: "db" },
    ]);
    expect(changedPaths(before, snapshot(made.project))).not.toContain("backend/src/db.ts");
  });

  test("with the api part's stack gone from the registry, add db warns part_unknown and still writes under backend/", async () => {
    const made = await created();
    const registry = variant((root) =>
      rmSync(join(root, "stacks", "api-part"), { recursive: true }),
    );
    const result = await added(await addIn(made, ["db"], { registry }));
    expect(result.warnings).toEqual([{ code: "part_unknown", id: "api-part" }]);
    expect(result.written).toEqual(["backend/src/db.ts"]);
    const manifest = manifestAt(made.project);
    expect(stepsOf(manifest, ["backend-up", "backend-migrate"])).toEqual([
      { name: "backend-up", cwd: "backend", owner: "db" },
      { name: "backend-migrate", cwd: "backend", owner: "db" },
    ]);
    expect(manifest.parts?.map((part) => part.stack.id)).toEqual(["api-part", "web-part"]);
  });

  test("with the workspace stack gone from the registry, add db warns stack_unknown and still writes under backend/", async () => {
    const made = await created();
    const registry = variant((root) => rmSync(join(root, "stacks", "pair"), { recursive: true }));
    const before = snapshot(made.project);
    const result = await added(await addIn(made, ["db"], { registry }));
    expect(result).toMatchObject({
      added: ["db"],
      written: ["backend/src/db.ts"],
      mergeNeeded: [
        { path: "backend/config/app.json", incoming: [".stacks/incoming/backend/config/app.json"] },
      ],
      warnings: [{ code: "stack_unknown", id: "pair" }],
    });
    expect(changedPaths(before, snapshot(made.project))).toEqual(dbChanges("backend"));
    const manifest = manifestAt(made.project);
    expect(stepsOf(manifest, ["backend-up", "backend-migrate"])).toEqual([
      { name: "backend-up", cwd: "backend", owner: "db" },
      { name: "backend-migrate", cwd: "backend", owner: "db" },
    ]);
    expect(manifest.commands).toMatchObject({ "backend-db-up": "Start the local database" });
    expect(Object.hasOwn(manifest.commands, "db-up")).toBe(false);
  });

  // The workspace root is reported as the real path found walking up from the real directory.
  describe("run inside a part's directory", () => {
    const addFrom = (made: Created, cwd: string, json: boolean) =>
      runCli(["add", "db", ...(json ? ["--json"] : [])], {
        home: made.home,
        env: { ...quiet, PATH: process.env.PATH ?? "", CLAUDECODE: "1" },
        host: { cwd, registry: workspaceRegistry },
      });

    test("--json refuses with BadInput part_dir naming the workspace root, nothing written", async () => {
      const made = await created();
      const before = snapshot(made.project);
      const run = await addFrom(made, join(made.project, "backend"), true);
      expect(run.status).toBe(2);
      expect(run.stdout).toBe("");
      expect(run.stderr.trim().split("\n")).toHaveLength(1);
      const { error } = Schema.decodeUnknownSync(ErrorEnvelope)(JSON.parse(run.stderr));
      expect(error).toEqual({
        tag: "BadInput",
        message: "Invalid input.",
        retryable: false,
        details: { flag: "part_dir", part: "backend", root: realpathSync(made.project) },
        next: `run stacks add <fragment> --dir ${realpathSync(made.project)}; add places each fragment on the part it fits.`,
      });
      expect(snapshot(made.project)).toEqual(before);
    });

    test("an agent sees the part, the workspace root and the Next: line on stderr", async () => {
      const made = await created();
      const before = snapshot(made.project);
      const run = await addFrom(made, join(made.project, "frontend"), false);
      expect(run.status).toBe(2);
      expect(run.stdout).toBe("");
      expect(run.stderr).toBe(
        [
          "Invalid input.",
          "  This directory is the frontend part of a workspace project.",
          `  Workspace root: ${realpathSync(made.project)}`,
          `  Next: run stacks add <fragment> --dir ${realpathSync(made.project)}; add places each fragment on the part it fits.`,
          "",
        ].join("\n"),
      );
      expect(snapshot(made.project)).toEqual(before);
    });

    test("a symlink to the part directory is the part too", async () => {
      const made = await created();
      const link = join(made.home, "backend-link");
      symlinkSync(join(made.project, "backend"), link);
      const before = snapshot(made.project);
      const run = await addFrom(made, link, true);
      expect(run.status).toBe(2);
      expect(JSON.parse(run.stderr).error.details).toEqual({
        flag: "part_dir",
        part: "backend",
        root: realpathSync(made.project),
      });
      expect(snapshot(made.project)).toEqual(before);
    });

    test("a directory of the workspace that is no part still gets a project of its own", async () => {
      const made = await created();
      mkdirSync(join(made.project, "tools"));
      const result = await added(await addFrom(made, join(made.project, "tools"), true));
      expect(result.added).toEqual(["db"]);
      expect(existsSync(join(made.project, "tools", MANIFEST_PATH))).toBe(true);
    });
  });

  test("a project-root api-part shadow with a with=db block is untrusted and keeps the baseline under an agent", async () => {
    const made = await created();
    cpSync(
      join(workspaceRegistry, "stacks", "api-part"),
      join(made.project, ".stacks", "stacks", "api-part"),
      { recursive: true },
    );
    const previous = manifestAt(made.project);
    const result = await added(await addIn(made, ["db"], { env: { CLAUDECODE: "1" } }));
    expect(result).toMatchObject({
      digestRecorded: false,
      untrusted: [
        {
          id: "api-part",
          kind: "stack",
          origin: "project",
          dir: join(made.project, ".stacks/stacks/api-part"),
        },
      ],
    });
    const manifest = manifestAt(made.project);
    expect(manifest.verifyDigest).toBe(previous.verifyDigest);
    expect(stepsOf(manifest, ["backend-up"])).toEqual([
      { name: "backend-up", cwd: "backend", owner: "db" },
    ]);
    expect(readFileSync(join(made.project, ".stacks/BRIEF.md"), "utf8")).toContain(
      "verify --accept-changes",
    );
  });
});
