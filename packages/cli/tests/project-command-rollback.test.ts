import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, PlatformError, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { ErrorEnvelope } from "../src/errors";
import { commandWithFileSystem } from "./helpers/command-filesystem";
import {
  createCli,
  createWorkspace,
  entryPath,
  entrySnapshot,
  putCreate,
  releaseCreate,
  userRoot,
} from "./helpers/create";
import { pickerCli, pickerManifest, pickerNew, pickerWorkspace } from "./helpers/picker";
import { minimal, writeEntry } from "./helpers/registry";
import { reviewSearchFixture } from "./helpers/search-fixture";
import { recordPath } from "./helpers/verify";

afterEach(releaseCreate);

const envelope = Schema.decodeUnknownSync(Schema.fromJsonString(ErrorEnvelope), {
  onExcessProperty: "error",
});
const denied = (method: string, path: string) =>
  Effect.fail(
    PlatformError.systemError({
      _tag: "PermissionDenied",
      module: "FileSystem",
      method,
      pathOrDescriptor: path,
    }),
  );

test("new removes the partial scaffold and its new parent after the manifest write fails", async () => {
  const workspace = pickerWorkspace();
  try {
    const parent = join(workspace.home, "new-parent");
    const project = join(parent, "app");
    const manifest = join(project, ".stacks/manifest.json");
    const args = ["new", "picker-stack", project, "--json"];
    const program = commandWithFileSystem(args, (fs) => ({
      writeFile: (path, bytes, options) =>
        path === manifest
          ? fs
              .writeFile(path, bytes.subarray(0, 16), options)
              .pipe(Effect.andThen(denied("writeFile", path)))
          : fs.writeFile(path, bytes, options),
    }));

    const run = await pickerCli(workspace, args, { program });

    expect(run.status).toBe(6);
    expect(run.stdout).toBe("");
    expect(envelope(run.stderr).error).toEqual({
      tag: "PermissionDenied",
      message: "Permission denied.",
      retryable: false,
      next: "pick a directory you can write to, or fix this one's permissions.",
      details: { reason: "unwritable", path: manifest },
    });
    expect(existsSync(parent)).toBe(false);
    expect(existsSync(join(workspace.home, "state/stacks/projects"))).toBe(false);
  } finally {
    workspace.cleanup();
  }
});

test.each(["brief", "state record"])(
  "add reports the %s it could not restore after the manifest write fails and rolls back the other writes",
  async (failedRestore) => {
    const workspace = pickerWorkspace();
    try {
      expect(await pickerNew(workspace, ["--json"])).toMatchObject({ status: 0, stderr: "" });
      writeEntry({
        root: workspace.registry,
        kind: "fragment",
        dir: "picker-extra",
        frontmatter: minimal(
          "fragment",
          "picker-extra",
          'verify: [{ name: extra-check, run: "true" }]',
        ),
      });
      const manifest = join(workspace.project, ".stacks/manifest.json");
      const briefPath = ".stacks/BRIEF.md";
      const brief = join(workspace.project, briefPath);
      const record = recordPath(workspace.home, pickerManifest(workspace.project).projectId);
      const recordBefore = readFileSync(record, "utf8");
      const before = entrySnapshot(workspace.project);
      const incomplete = failedRestore === "brief" ? brief : record;
      const restoredProjectFile = ({ path }: { path: string }) =>
        incomplete !== brief || path !== briefPath;
      const args = ["add", "picker-extra", "--dir", workspace.project, "--json"];
      let recordAtFailure: string | undefined;
      const program = commandWithFileSystem(args, (fs) => ({
        rename: (source, target) => {
          if (target === incomplete && recordAtFailure !== undefined)
            return denied("rename", target);
          if (target === manifest && recordAtFailure === undefined)
            return Effect.sync(() => {
              recordAtFailure = readFileSync(record, "utf8");
            }).pipe(Effect.andThen(denied("rename", target)));
          return fs.rename(source, target);
        },
      }));

      const run = await pickerCli(workspace, args, { program });

      expect(run.status).toBe(6);
      expect(run.stdout).toBe("");
      expect(envelope(run.stderr).error).toEqual({
        tag: "PermissionDenied",
        message: "Permission denied.",
        retryable: false,
        next: "pick a directory you can write to, or fix this one's permissions.",
        details: { reason: "unwritable", path: manifest },
        rollback: { incomplete: [incomplete] },
      });
      if (incomplete === brief) expect(readFileSync(brief, "utf8")).toContain("picker-extra");
      expect(entrySnapshot(workspace.project).filter(restoredProjectFile)).toEqual(
        before.filter(restoredProjectFile),
      );
      expect(recordAtFailure).toBeDefined();
      expect(recordAtFailure).not.toEqual(recordBefore);
      expect(readFileSync(record, "utf8")).toBe(
        incomplete === record ? recordAtFailure : recordBefore,
      );
    } finally {
      workspace.cleanup();
    }
  },
);

test("an interrupt after add writes a fragment file removes it and preserves the completed scaffold", async () => {
  const workspace = pickerWorkspace();
  try {
    expect(await pickerNew(workspace, ["--json"])).toMatchObject({ status: 0, stderr: "" });
    const before = entrySnapshot(workspace.project);
    const record = recordPath(workspace.home, pickerManifest(workspace.project).projectId);
    const recordBefore = readFileSync(record);
    const added = join(workspace.project, "extra.txt");
    const controller = new AbortController();
    const args = ["add", "picker-extra", "--dir", workspace.project, "--json"];
    const program = commandWithFileSystem(args, (fs) => ({
      writeFile: (path, bytes, options) => {
        const write = fs.writeFile(path, bytes, options);
        return path === added
          ? write.pipe(Effect.tap(() => Effect.sync(() => controller.abort())))
          : write;
      },
    }));

    const run = await pickerCli(workspace, args, { program, signal: controller.signal });

    expect(run.status).toBe(130);
    expect(run.stdout).toBe("");
    expect(envelope(run.stderr).error).toEqual({
      tag: "Interrupted",
      message: "Command interrupted.",
      retryable: false,
      next: "run the same command again when you're ready.",
    });
    expect(existsSync(added)).toBe(false);
    expect(entrySnapshot(workspace.project)).toEqual(before);
    expect(readFileSync(record)).toEqual(recordBefore);
  } finally {
    workspace.cleanup();
  }
});

test("a conflicting search card rolls back the copied entry and preserves the user's registry", async () => {
  const home = createWorkspace();
  const registry = createWorkspace();
  const entry = writeEntry({
    root: registry,
    kind: "fragment",
    dir: "copied",
    frontmatter: minimal("fragment", "copied"),
  });
  putCreate(entry, "files/extra.txt", "source material\n");
  reviewSearchFixture(registry);
  const cardPath = "search/fragments/copied.json";
  putCreate(userRoot(home), cardPath, "my existing search card\n");
  const before = entrySnapshot(userRoot(home));
  const sourceBefore = entrySnapshot(registry);
  const target = entryPath(home, "fragment", "copied");
  const args = ["create", "fragment", "copied", "--from", "bundled", "--json"];
  let beforeCollision: ReturnType<typeof entrySnapshot> | undefined;
  const program = commandWithFileSystem(args, (fs) => ({
    writeFile: (path, bytes, options) => {
      const write = fs.writeFile(path, bytes, options);
      if (path !== join(userRoot(home), cardPath)) return write;
      return Effect.sync(() => {
        if (existsSync(target)) beforeCollision = entrySnapshot(target);
      }).pipe(Effect.andThen(write));
    },
  }));

  const run = await createCli(home, args, { host: { registry }, program });

  expect(run.status).toBe(2);
  expect(run.stdout).toBe("");
  expect(envelope(run.stderr).error).toEqual({
    tag: "BadInput",
    message: "Invalid input.",
    retryable: false,
    next: "edit the existing entry, or choose an unused id.",
    details: { flag: "create_target", id: target },
  });
  expect(beforeCollision).toEqual(entrySnapshot(entry));
  expect(existsSync(target)).toBe(false);
  expect(entrySnapshot(userRoot(home))).toEqual(before);
  expect(entrySnapshot(registry)).toEqual(sourceBefore);
});
