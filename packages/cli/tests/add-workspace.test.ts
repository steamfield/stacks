import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Manifest } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import { encodeManifest, MANIFEST_PATH } from "../src/core/project/manifest";
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
