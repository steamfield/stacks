import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { expect } from "vitest";
import { quiet, runCli, tempDir } from "./cli";

export const createFixture = fileURLToPath(new URL("../fixtures/create/", import.meta.url));
const bundledRegistry = fileURLToPath(new URL("../../registry/", import.meta.url));
export const authoringGuide = fileURLToPath(new URL("../../docs/authoring.md", import.meta.url));
const dirs: ReturnType<typeof tempDir>[] = [];
export function createWorkspace() {
  const dir = tempDir();
  dirs.push(dir);
  return realpathSync(dir.path);
}
export function releaseCreate() {
  for (const dir of dirs.splice(0)) dir.cleanup();
}
export const userRoot = (home: string) => join(home, "config", "stacks");
export const entryPath = (home: string, kind: "stack" | "fragment", id: string) =>
  join(userRoot(home), kind === "stack" ? "stacks" : "fragments", id);
export function putCreate(root: string, path: string, text: string | Uint8Array) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}
export async function createCli(
  home: string,
  args: readonly string[],
  options: Omit<NonNullable<Parameters<typeof runCli>[1]>, "home"> = {},
) {
  const result = await runCli(args, {
    ...options,
    home,
    env: { ...quiet, ...options.env },
    host: { registry: bundledRegistry, ...options.host },
  });
  return { ...result, home, args };
}
export function jsonResult<A>(
  run: Awaited<ReturnType<typeof runCli>>,
  schema: Schema.ConstraintDecoder<A, never>,
) {
  expect(run.status, run.stderr).toBe(0);
  expect(run.stderr).toBe("");
  expect(run.stdout.trim().split("\n")).toHaveLength(1);
  return Schema.decodeUnknownSync(schema)(JSON.parse(run.stdout));
}
// Import lazily so absent create code does not prevent the other acceptance tests from running.
export async function created(run: Awaited<ReturnType<typeof createCli>>) {
  expect(run.status, run.stderr).toBe(0);
  const { CreateResult } = await import("../../src/schemas/create");
  const result = jsonResult(run, CreateResult);
  const kind = run.args[1];
  const id = run.args[2];
  if ((kind !== "stack" && kind !== "fragment") || !id)
    throw new Error("created() needs a create stack|fragment id invocation");
  expect(result).toMatchObject({
    kind,
    id,
    path: expect.any(String),
    guide: authoringGuide,
  });
  const paths = Schema.decodeUnknownSync(Schema.Struct({ path: Schema.String }))(result);
  expect(isAbsolute(paths.path)).toBe(true);
  expect(realpathSync(paths.path)).toBe(realpathSync(entryPath(run.home, kind, id)));
  return result;
}
const ErrorEnvelope = Schema.Struct({
  error: Schema.Struct({
    tag: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
    details: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  }),
});
export function createFailure(
  run: Awaited<ReturnType<typeof runCli>>,
  status: number,
  tag: string,
) {
  expect(run.status).toBe(status);
  expect(run.stdout).toBe("");
  expect(run.stderr.trim().split("\n")).toHaveLength(1);
  const error = Schema.decodeUnknownSync(ErrorEnvelope)(JSON.parse(run.stderr)).error;
  expect(error).toMatchObject({ tag, retryable: false });
  return error;
}
/** Capture empty directories, links, binary bytes and executable bits without following links. */
export function entrySnapshot(root: string) {
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .sort()
    .map((path) => {
      const target = join(root, path);
      const stat = lstatSync(target);
      if (stat.isSymbolicLink()) return { path, type: "symlink", link: readlinkSync(target) };
      if (stat.isDirectory()) return { path, type: "directory" };
      return { path, type: "file", bytes: readFileSync(target), executable: stat.mode & 0o111 };
    });
}
