import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { afterEach, expect, test } from "vitest";
import { shownPath } from "../src/core/text/shown-path";
import { tempDir } from "./helpers/cli";

const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});
function temp() {
  const dir = tempDir();
  dirs.push(dir);
  return dir.path;
}
const show = (cwd: string, target: string) =>
  Effect.runPromise(shownPath(cwd, target).pipe(Effect.provide(NodeServices.layer)));

test("a target equal to cwd is shown as a dot", async () => {
  const cwd = temp();
  expect(await show(cwd, cwd)).toBe(".");
});

test("a target nested inside cwd is shown relative to cwd", async () => {
  const cwd = temp();
  const target = join(cwd, "project", "src");
  mkdirSync(target, { recursive: true });
  expect(await show(cwd, target)).toBe(join("project", "src"));
});

test("a nonexistent target inside cwd is still shown relative to cwd", async () => {
  const cwd = temp();
  expect(await show(cwd, join(cwd, "missing", "project"))).toBe(join("missing", "project"));
});

test("a sibling target is returned unchanged even when its name starts with cwd's name", async () => {
  const root = temp();
  const cwd = join(root, "project");
  const target = join(root, "project-other");
  mkdirSync(cwd);
  mkdirSync(target);
  expect(await show(cwd, target)).toBe(target);
});

test("a parent target is returned unchanged", async () => {
  const target = temp();
  const cwd = join(target, "project");
  mkdirSync(cwd);
  expect(await show(cwd, target)).toBe(target);
});

test("a symlinked cwd and its real directory are shown as a dot", async () => {
  const root = temp();
  const real = join(root, "real");
  const link = join(root, "link");
  mkdirSync(real);
  symlinkSync(real, link);
  expect(await show(link, realpathSync(real))).toBe(".");
});

test("a target inside the real directory of a symlinked cwd is shown relative to cwd", async () => {
  const root = temp();
  const real = join(root, "real");
  const link = join(root, "link");
  mkdirSync(join(real, "project", "src"), { recursive: true });
  symlinkSync(real, link);
  expect(await show(link, realpathSync(join(real, "project", "src")))).toBe(join("project", "src"));
});

test("a symlinked target resolving inside cwd is shown relative to the real cwd", async () => {
  const root = temp();
  const cwd = join(root, "cwd");
  const target = join(root, "link");
  mkdirSync(join(cwd, "project"), { recursive: true });
  symlinkSync(join(cwd, "project"), target);
  expect(await show(cwd, target)).toBe("project");
});

test("a symlinked target outside cwd keeps its given path rather than its real path", async () => {
  const root = temp();
  const cwd = join(root, "cwd");
  const outside = join(root, "outside");
  const target = join(root, "link");
  mkdirSync(cwd);
  mkdirSync(outside);
  symlinkSync(outside, target);
  expect(await show(cwd, target)).toBe(target);
});

test("a nonexistent target outside cwd is returned unchanged", async () => {
  const root = temp();
  const cwd = join(root, "cwd");
  const target = join(root, "missing", "project");
  mkdirSync(cwd);
  expect(await show(cwd, target)).toBe(target);
});

test("a target that cannot resolve is compared as given against the real cwd", async () => {
  const root = temp();
  const real = join(root, "real");
  const link = join(root, "link");
  mkdirSync(real);
  symlinkSync(real, link);
  expect(await show(link, join(realpathSync(real), "missing"))).toBe("missing");
});

test("a cwd that cannot resolve still returns an outside target unchanged", async () => {
  const root = temp();
  const target = join(root, "project");
  mkdirSync(target);
  expect(await show(join(root, "missing"), target)).toBe(target);
});
