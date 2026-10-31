import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, FileSystem } from "effect";
import { afterEach, expect, test } from "vitest";
import { replaceFile } from "../src/core/replace-file";
import { tempDir } from "./helpers/cli";

const directories: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) directory.cleanup();
});

const directory = () => {
  const temporary = tempDir();
  directories.push(temporary);
  return temporary.path;
};

const run = (target: string, text: string, options?: { mode?: number }) =>
  Effect.runPromise(replaceFile(target, text, options).pipe(Effect.provide(NodeServices.layer)));

test("replaces a target with the requested mode and removes staging files", async () => {
  const root = directory();
  const target = join(root, "state.json");
  writeFileSync(target, "old");
  await run(target, "new", { mode: 0o600 });
  expect(readFileSync(target, "utf8")).toBe("new");
  expect(statSync(target).mode & 0o777).toBe(0o600);
  expect(readdirSync(root)).toEqual(["state.json"]);
});

test("a failed rename leaves the target and removes staging files", async () => {
  const root = directory();
  const target = join(root, "state.json");
  mkdirSync(target);
  const exit = await Effect.runPromiseExit(
    replaceFile(target, "new").pipe(Effect.provide(NodeServices.layer)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  expect(readdirSync(root)).toEqual(["state.json"]);
  expect(readdirSync(target)).toEqual([]);
});

test("interruption after staging removes the temporary directory and preserves the target", async () => {
  const root = directory();
  const target = join(root, "state.json");
  writeFileSync(target, "original");
  const controller = new AbortController();
  let staged = false;
  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* replaceFile(target, "new").pipe(
      Effect.provideService(FileSystem.FileSystem, {
        ...fs,
        rename: () =>
          Effect.sync(() => {
            staged = readdirSync(root).some((name) => name.startsWith(".write-"));
            controller.abort();
          }).pipe(Effect.andThen(Effect.never)),
      }),
    );
  }).pipe(Effect.provide(NodeServices.layer));
  const exit = await Effect.runPromiseExit(program, { signal: controller.signal });
  expect(staged).toBe(true);
  expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
  expect(readFileSync(target, "utf8")).toBe("original");
  expect(readdirSync(root)).toEqual(["state.json"]);
});

test("replaces an existing symlink without writing through it", async () => {
  const root = directory();
  const other = join(root, "other.json");
  const target = join(root, "state.json");
  writeFileSync(other, "original");
  symlinkSync(other, target);
  await run(target, "replacement");
  expect(lstatSync(target).isSymbolicLink()).toBe(false);
  expect(readFileSync(target, "utf8")).toBe("replacement");
  expect(readFileSync(other, "utf8")).toBe("original");
  expect(readdirSync(root).sort()).toEqual(["other.json", "state.json"]);
});
