import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Manifest } from "@steamfield/stacks-format";
import { Exit, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { digestSteps, encodeManifest, MANIFEST_PATH } from "../src/core/project/manifest";
import {
  ProjectState,
  projectStateFor,
  readProjectState,
  removeProjectState,
  writeProjectState,
} from "../src/core/project/state";
import { PermissionDenied } from "../src/errors";
import { tempDir } from "./helpers/cli";
import { manifestOf, runWith, succeed } from "./helpers/state";

const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});
function temp() {
  const dir = tempDir();
  dirs.push(dir);
  return dir.path;
}
const asRoot = process.getuid?.() === 0;

/** A project with its manifest written, reached through a symlink to its real directory. */
function project(manifest: Manifest) {
  const root = temp();
  const real = join(root, "real");
  mkdirSync(join(real, ".stacks"), { recursive: true });
  writeFileSync(join(real, MANIFEST_PATH), encodeManifest(manifest));
  symlinkSync(real, join(root, "link"));
  return { root, via: join(root, "link", MANIFEST_PATH) };
}
const stateEnv = (state: string) => ({ HOME: temp(), XDG_STATE_HOME: state });

test("the record lands under XDG_STATE_HOME by project id, with the manifest's digest and real path", async () => {
  const manifest = await manifestOf({ preset: "sandbox" });
  const { via } = project(manifest);
  const state = temp();
  const write = await succeed(runWith(writeProjectState(manifest, via), stateEnv(state)));
  const file = join(state, "stacks", "projects", `${manifest.projectId}.json`);
  expect(write).toEqual({ written: true, path: file });
  const record = Schema.decodeUnknownSync(ProjectState)(JSON.parse(readFileSync(file, "utf8")), {
    onExcessProperty: "error",
  });
  expect(record).toEqual({
    schemaVersion: 1,
    projectId: manifest.projectId,
    manifestPath: realpathSync(via),
    verifyDigest: manifest.verifyDigest,
    stepDigests: expect.any(Object),
    settingsDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    createdAt: manifest.createdAt,
    firstGreenAt: null,
    firstTestPassAt: null,
  });
  expect(record.manifestPath).not.toContain("/link/");
  expect(Object.keys(record.stepDigests).sort()).toEqual(
    manifest.verify.map((step) => step.name).sort(),
  );
  // Nothing but the record is left in the directory.
  expect(readdirSync(join(state, "stacks", "projects"))).toEqual([`${manifest.projectId}.json`]);
  expect(await succeed(runWith(readProjectState(manifest.projectId), stateEnv(state)))).toEqual(
    record,
  );
});

test("the state directory defaults to ~/.local/state/stacks", async () => {
  const manifest = await manifestOf();
  const { via } = project(manifest);
  const home = temp();
  const write = await succeed(runWith(writeProjectState(manifest, via), { HOME: home }));
  expect(write).toEqual({
    written: true,
    path: join(home, ".local", "state", "stacks", "projects", `${manifest.projectId}.json`),
  });
});

test("STACKS_STATE_DIR replaces the state directory, stacks/ suffix included", async () => {
  const manifest = await manifestOf();
  const { via } = project(manifest);
  const state = temp();
  const env = { ...stateEnv(join(temp(), "xdg")), STACKS_STATE_DIR: state };
  expect(await succeed(runWith(writeProjectState(manifest, via), env))).toEqual({
    written: true,
    path: join(state, "projects", `${manifest.projectId}.json`),
  });
});

test("a project id that isn't a valid id is never turned into a path: no write, no read", async () => {
  const manifest = await manifestOf();
  const { via } = project(manifest);
  const state = temp();
  const outside = join(state, "stacks", "escaped.json");
  for (const projectId of ["../escaped", "a/b", "", ".hidden", "a\nb"]) {
    expect(
      await succeed(runWith(writeProjectState({ ...manifest, projectId }, via), stateEnv(state))),
    ).toEqual({ written: false });
  }
  expect(existsSync(outside)).toBe(false);
  expect(existsSync(join(state, "stacks"))).toBe(false);
  // A record that does sit there under the escaping name is still not read.
  mkdirSync(join(state, "stacks", "projects"), { recursive: true });
  const good = await succeed(runWith(writeProjectState(manifest, via), stateEnv(state)));
  expect(good.written).toBe(true);
  writeFileSync(
    outside,
    readFileSync(join(state, "stacks", "projects", `${manifest.projectId}.json`)),
  );
  expect(await succeed(runWith(readProjectState("../escaped"), stateEnv(state)))).toBeUndefined();
});

test("a file blocking the state directory gives written: false", async () => {
  const manifest = await manifestOf();
  const { via } = project(manifest);
  const file = join(temp(), "a-file");
  writeFileSync(file, "");
  expect(await succeed(runWith(writeProjectState(manifest, via), stateEnv(file)))).toEqual({
    written: false,
  });
});

test.skipIf(asRoot)(
  "an unwritable state directory gives written: false and leaves nothing behind",
  async () => {
    const manifest = await manifestOf();
    const { via } = project(manifest);
    const locked = join(temp(), "projects-locked");
    mkdirSync(join(locked, "stacks", "projects"), { recursive: true });
    chmodSync(join(locked, "stacks", "projects"), 0o500);
    try {
      expect(await succeed(runWith(writeProjectState(manifest, via), stateEnv(locked)))).toEqual({
        written: false,
      });
      expect(readdirSync(join(locked, "stacks", "projects"))).toEqual([]);
    } finally {
      chmodSync(join(locked, "stacks", "projects"), 0o700);
    }
  },
);

test("a link planted at the record's path is replaced, never written through", async () => {
  const manifest = await manifestOf();
  const { via } = project(manifest);
  const state = temp();
  const outside = join(temp(), "outside.txt");
  writeFileSync(outside, "untouched");
  const projects = join(state, "stacks", "projects");
  mkdirSync(projects, { recursive: true });
  symlinkSync(outside, join(projects, `${manifest.projectId}.json`));
  const write = await succeed(runWith(writeProjectState(manifest, via), stateEnv(state)));
  expect(write.written).toBe(true);
  expect(readFileSync(outside, "utf8")).toBe("untouched");
  expect(lstatSync(join(projects, `${manifest.projectId}.json`)).isSymbolicLink()).toBe(false);
});

test("a manifest that isn't on disk is PermissionDenied read, and no record is written", async () => {
  const manifest = await manifestOf();
  const state = temp();
  const missing = join(temp(), MANIFEST_PATH);
  expect(await runWith(writeProjectState(manifest, missing), stateEnv(state))).toEqual(
    Exit.fail(new PermissionDenied({ details: { reason: "read", path: missing } })),
  );
  expect(existsSync(join(state, "stacks"))).toBe(false);
});

test("removeProjectState rolls a write back, and does nothing for a write that didn't happen", async () => {
  const manifest = await manifestOf();
  const { via } = project(manifest);
  const state = temp();
  const write = await succeed(runWith(writeProjectState(manifest, via), stateEnv(state)));
  if (!write.written) throw new Error("expected a record");
  await succeed(runWith(removeProjectState(write)));
  expect(existsSync(write.path)).toBe(false);
  await succeed(runWith(removeProjectState(write)));
  await succeed(runWith(removeProjectState({ written: false })));
  expect(await succeed(runWith(readProjectState(manifest.projectId), stateEnv(state)))).toBe(
    undefined,
  );
});

test("a record that doesn't decode reads as missing", async () => {
  const state = temp();
  const projects = join(state, "stacks", "projects");
  mkdirSync(projects, { recursive: true });
  writeFileSync(join(projects, "bad.json"), "{not json");
  writeFileSync(join(projects, "newer.json"), JSON.stringify({ schemaVersion: 2 }));
  for (const id of ["bad", "newer", "absent"])
    expect(await succeed(runWith(readProjectState(id), stateEnv(state)))).toBe(undefined);
});

/** The record for a manifest after an edit, with the whole-set digest recomputed. */
const recordAfter = (manifest: Manifest, edit: Partial<Manifest>) => {
  const edited = { ...manifest, ...edit };
  return projectStateFor({ ...edited, verifyDigest: digestSteps(edited) }, "/p/manifest.json");
};

test("editing one step changes only that step's digest; an env change only the settings digest [1.2b#10]", async () => {
  const manifest = await manifestOf();
  const before = projectStateFor(manifest, "/p/manifest.json");
  const [first, ...rest] = manifest.verify;
  if (!first) throw new Error("expected steps");
  const stepEdited = recordAfter(manifest, {
    verify: [{ ...first, run: `${first.run} --strict` }, ...rest],
  });
  expect(stepEdited.verifyDigest).not.toBe(before.verifyDigest);
  expect(stepEdited.settingsDigest).toBe(before.settingsDigest);
  for (const step of manifest.verify)
    if (step.name === first.name)
      expect(stepEdited.stepDigests[step.name]).not.toBe(before.stepDigests[step.name]);
    else expect(stepEdited.stepDigests[step.name]).toBe(before.stepDigests[step.name]);

  const envEdited = recordAfter(manifest, { env: { ...manifest.env, EXTRA: "1" } });
  expect(envEdited.verifyDigest).not.toBe(before.verifyDigest);
  expect(envEdited.settingsDigest).not.toBe(before.settingsDigest);
  expect(envEdited.stepDigests).toEqual(before.stepDigests);

  const presetEdited = recordAfter(manifest, { preset: "sandbox" });
  expect(presetEdited.settingsDigest).not.toBe(before.settingsDigest);
  expect(presetEdited.stepDigests).toEqual(before.stepDigests);
});
