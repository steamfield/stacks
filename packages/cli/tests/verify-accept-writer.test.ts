import {
  chmodSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { digestSteps, encodeManifest, MANIFEST_PATH } from "../src/core/manifest";
import { ErrorEnvelope } from "../src/errors";
import { quiet, runCli } from "./helpers/cli";
import {
  manifest,
  readManifestAt,
  readRecord,
  recordPath,
  type StepInput,
  splitEvents,
  stateEnv,
  workspace,
  writeRecordedProject,
} from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());
const tty = { stdinIsTTY: true, stdoutIsTTY: true };
const original: StepInput[] = [{ name: "check", run: "true" }];
const changed: StepInput[] = [{ name: "check", run: "true # accepted edit" }];

function project() {
  const home = realpathSync(space.dir());
  const root = realpathSync(space.dir());
  const before = writeRecordedProject(root, home, original);
  const edited = manifest(changed, { verifyDigest: before.verifyDigest });
  const path = join(root, MANIFEST_PATH);
  writeFileSync(path, encodeManifest(edited));
  return { home, root, path, before, env: { ...quiet, ...stateEnv(home) } };
}

function accept(input: ReturnType<typeof project>, env = input.env) {
  return runCli(["verify", "--accept-changes", "--json"], {
    home: input.home,
    host: { ...tty, cwd: input.root },
    env: { PATH: process.env.PATH, ...env },
  });
}

function error(result: Awaited<ReturnType<typeof accept>>) {
  expect(result.status).toBe(6);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim().split("\n")).toHaveLength(1);
  return Schema.decodeUnknownSync(ErrorEnvelope, { onExcessProperty: "error" })(
    JSON.parse(result.stderr),
  );
}

test("accepting a symlinked manifest refuses the escape and leaves its target untouched", async () => {
  const input = project();
  const outside = join(space.dir(), "manifest.json");
  const bytes = readFileSync(input.path);
  writeFileSync(outside, bytes);
  unlinkSync(input.path);
  symlinkSync(outside, input.path);
  const result = await accept(input);
  expect(error(result).error).toMatchObject({
    tag: "PermissionDenied",
    details: { reason: "escape" },
  });
  expect(readFileSync(outside)).toEqual(bytes);
  expect(lstatSync(input.path).isSymbolicLink()).toBe(true);
  expect(readRecord(recordPath(input.home, input.before.projectId)).verifyDigest).toBe(
    input.before.verifyDigest,
  );
});

test.skipIf(process.getuid?.() === 0)(
  "an unwritable state directory has a decoded state-unwritable envelope before manifest changes",
  async () => {
    const input = project();
    const directory = join(input.home, "state/stacks/projects");
    const bytes = readFileSync(input.path);
    chmodSync(directory, 0o500);
    try {
      const result = await accept(input);
      expect(error(result).error).toMatchObject({
        tag: "PermissionDenied",
        details: { reason: "state-unwritable" },
      });
      expect(readFileSync(input.path)).toEqual(bytes);
    } finally {
      chmodSync(directory, 0o700);
    }
  },
);

test.skipIf(process.getuid?.() === 0)(
  "an unwritable manifest directory has a decoded unwritable envelope and restores state",
  async () => {
    const input = project();
    const directory = join(input.root, ".stacks");
    const record = recordPath(input.home, input.before.projectId);
    const stateBytes = readFileSync(record);
    const manifestBytes = readFileSync(input.path);
    chmodSync(input.path, 0o400);
    chmodSync(directory, 0o500);
    try {
      const result = await accept(input);
      expect(error(result).error).toMatchObject({
        tag: "PermissionDenied",
        details: { reason: "unwritable", path: input.path },
      });
      expect(readFileSync(record)).toEqual(stateBytes);
      expect(readFileSync(input.path)).toEqual(manifestBytes);
    } finally {
      chmodSync(directory, 0o700);
      chmodSync(input.path, 0o600);
    }
  },
);

test("successful acceptance leaves a regular manifest with the accepted digest and no temp files", async () => {
  const input = project();
  const result = await accept(input);
  expect(result.status).toBe(0);
  expect(splitEvents(result.stderr).rest).toBe("");
  expect(result.stdout).not.toBe("");
  expect(lstatSync(input.path).isFile()).toBe(true);
  const written = readManifestAt(input.root);
  expect(written.verifyDigest).toBe(digestSteps(written));
  expect(written.verifyDigest).not.toBe(input.before.verifyDigest);
  expect(written.verify[0]?.run).toBe("true # accepted edit");
  expect(readRecord(recordPath(input.home, input.before.projectId)).verifyDigest).toBe(
    written.verifyDigest,
  );
  expect(readdirSync(join(input.root, ".stacks")).sort()).toEqual(["manifest.json", "state"]);
});
