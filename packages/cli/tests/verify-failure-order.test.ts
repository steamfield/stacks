import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { ErrorEnvelope } from "../src/errors";
import { quiet, runCli } from "./helpers/cli";
import { commandWithFileSystem } from "./helpers/command-filesystem";
import {
  readRecord,
  recordPath,
  runRecords,
  stateEnv,
  workspace,
  writeProject,
  writeRecordedProject,
} from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

test.each([
  { mode: "ordinary verify", flags: [], newerRecord: false },
  {
    mode: "verify with --accept-changes from a terminal",
    flags: ["--accept-changes"],
    newerRecord: false,
  },
  { mode: "verify with a newer state record", flags: [], newerRecord: true },
])("$mode rejects an unknown step before handling edited steps", async ({ flags, newerRecord }) => {
  const home = realpathSync(space.dir());
  const root = realpathSync(space.dir());
  const recorded = writeRecordedProject(root, home, [{ name: "check", run: "true" }]);
  const manifest = writeProject(root, [{ name: "check", run: "touch ran" }], {
    verifyDigest: recorded.verifyDigest,
  });
  const record = recordPath(home, recorded.projectId);
  if (newerRecord)
    writeFileSync(record, JSON.stringify({ ...readRecord(record), schemaVersion: 2 }));
  const files = () => ({
    manifest: readFileSync(manifest, "utf8"),
    record: readFileSync(record, "utf8"),
  });
  const before = files();
  const attemptedWrites: string[] = [];
  const observeWrite = (path: string) =>
    Effect.sync(() => {
      if (path === manifest || path === record) attemptedWrites.push(path);
    });
  const args = ["verify", "--only", "bogus", ...flags, "--json"];
  const program = commandWithFileSystem(args, (fs) => ({
    writeFile: (path, bytes, options) =>
      observeWrite(path).pipe(Effect.andThen(fs.writeFile(path, bytes, options))),
    rename: (source, target) =>
      observeWrite(target).pipe(Effect.andThen(fs.rename(source, target))),
  }));

  const run = await runCli(args, {
    home,
    env: { ...quiet, ...stateEnv(home) },
    host: { cwd: root, stdinIsTTY: true, stdoutIsTTY: true },
    program,
  });

  expect(run.status, run.stderr).toBe(2);
  expect(run.stdout).toBe("");
  expect(
    Schema.decodeUnknownSync(Schema.fromJsonString(ErrorEnvelope), {
      onExcessProperty: "error",
    })(run.stderr),
  ).toEqual({
    error: {
      tag: "BadInput",
      message: "Invalid input.",
      retryable: false,
      next: "pass --only names from that list; setup and teardown steps always run.",
      details: { id: "bogus", flag: "only", known: ["check"] },
    },
  });
  expect(files()).toEqual(before);
  expect(attemptedWrites).toEqual([]);
  expect(runRecords(root)).toEqual([]);
  expect(existsSync(join(root, "ran"))).toBe(false);
});
