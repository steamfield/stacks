import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem } from "effect";
import { Command } from "effect/cli";
import { afterEach, expect, test } from "vitest";
import { cli } from "../src/cli";
import { Registry } from "../src/core/registry/registry";
import { VERSION } from "../src/version";
import { quiet, runCli } from "./helpers/cli";
import { ledgerRecord, writeLedger } from "./helpers/ledger";
import { minimal, writeEntry } from "./helpers/registry";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

function fixture() {
  const home = realpathSync(space.dir());
  const registry = realpathSync(space.dir());
  writeEntry({ root: registry, kind: "stack", dir: "base", frontmatter: minimal("stack", "base") });
  writeEntry({
    root: registry,
    kind: "fragment",
    dir: "chosen",
    frontmatter: minimal("fragment", "chosen"),
  });
  const bad = writeEntry({
    root: registry,
    kind: "fragment",
    dir: "tainted",
    frontmatter: minimal("fragment", "tainted"),
  });
  mkdirSync(join(bad, "files", "nested"), { recursive: true });
  symlinkSync("/etc/hosts", join(bad, "files", "nested", "escape"));
  const options = { home, env: quiet, host: { registry } };
  return { home, registry, bad, options };
}

function countProgram(args: readonly string[], paths: string[], reads: string[] = []) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const counted: FileSystem.FileSystem = {
      ...fs,
      lstat: (file) =>
        Effect.tap(fs.lstat(file), () =>
          Effect.sync(() => {
            paths.push(file);
          }),
        ),
      readFile: (file) =>
        Effect.tap(fs.readFile(file), () =>
          Effect.sync(() => {
            reads.push(file);
          }),
        ),
      readFileString: (file, options) =>
        Effect.tap(fs.readFileString(file, options), () =>
          Effect.sync(() => {
            reads.push(file);
          }),
        ),
    };
    yield* Command.runWith(cli, { version: VERSION, renderErrors: false })(args).pipe(
      Effect.provideService(FileSystem.FileSystem, counted),
    );
  });
}

async function measured(args: string[], options: ReturnType<typeof fixture>["options"]) {
  const paths: string[] = [];
  const reads: string[] = [];
  const result = await runCli(args, { ...options, program: countProgram(args, paths, reads) });
  return { ...result, paths, reads };
}

function addUnrelated(root: string, count: number) {
  for (let index = 0; index < count; index++) {
    const id = `extra-${String(index).padStart(3, "0")}`;
    const dir = writeEntry({
      root,
      kind: "fragment",
      dir: id,
      frontmatter: minimal("fragment", id),
    });
    mkdirSync(join(dir, "files", "nested"), { recursive: true });
    writeFileSync(join(dir, "files", "nested", "file.txt"), "fixture\n");
  }
}

test.each([
  ["stack", "base"],
  ["fragment", "chosen"],
] as const)("show of an unrelated %s does not walk other fragment trees", async (kind, id) => {
  const f = fixture();
  let relevantDate: string | undefined;
  if (kind === "fragment") {
    writeEntry({
      root: f.registry,
      kind: "stack",
      dir: "sample",
      frontmatter: minimal("stack", "sample", "fragments:\n  default: [chosen]"),
    });
    const record = await ledgerRecord(f.registry);
    relevantDate = record.date;
    writeLedger(f.registry, [record]);
  }
  const args = ["show", id, "--kind", kind, "--json"];
  const before = await measured(args, f.options);
  expect(before.status, before.stderr).toBe(0);
  if (relevantDate !== undefined)
    expect(JSON.parse(before.stdout)).toMatchObject({
      lastRun: { stack: "sample", date: relevantDate },
    });
  addUnrelated(f.registry, 12);
  const after = await measured(args, f.options);
  expect(after.status, after.stderr).toBe(0);
  if (relevantDate !== undefined)
    expect(JSON.parse(after.stdout)).toMatchObject({
      lastRun: { stack: "sample", date: relevantDate },
    });
  // Loading may lstat each unrelated entry's directory and markdown file, never its tree.
  const unrelated = after.paths.filter((path) => path.includes("/fragments/extra-"));
  expect(unrelated.filter((path) => path.includes("/files"))).toEqual([]);
  expect(after.paths).not.toContain(join(f.bad, "files", "nested", "escape"));
  expect(after.paths.length - before.paths.length).toBeLessThanOrEqual(2 * 12);
});

test("a registry layer checks a selected entry tree once across repeated gets", async () => {
  const f = fixture();
  const selected = join(f.registry, "fragments", "chosen");
  mkdirSync(join(selected, "files", "nested"), { recursive: true });
  writeFileSync(join(selected, "files", "nested", "note.txt"), "chosen\n");
  const checked = join(selected, "files", "nested", "note.txt");
  const paths: string[] = [];
  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const counted: FileSystem.FileSystem = {
      ...fs,
      lstat: (file) =>
        Effect.tap(fs.lstat(file), () =>
          Effect.sync(() => {
            paths.push(file);
          }),
        ),
    };
    return yield* Effect.gen(function* () {
      const registry = yield* Registry;
      const first = yield* registry.get("fragment", "chosen");
      const second = yield* registry.get("fragment", "chosen");
      return [first.id, second.id];
    }).pipe(
      Effect.provide(Registry.layer([{ origin: "bundled", path: f.registry }])),
      Effect.provideService(FileSystem.FileSystem, counted),
    );
  });
  expect(await Effect.runPromise(program.pipe(Effect.provide(NodeServices.layer)))).toEqual([
    "chosen",
    "chosen",
  ]);
  expect(paths.filter((path) => path === checked)).toHaveLength(1);
});

test("show and new reject a selected deep symlink with the same error envelope", async () => {
  const f = fixture();
  const expected = {
    error: {
      tag: "EntryInvalid",
      message: "Entry is invalid.",
      retryable: false,
      next: "fix that entry or leave it out; stacks validate lists every problem in a registry.",
      details: { id: "tainted", origin: "bundled", reason: "symlink", path: "files/nested/escape" },
    },
  };
  for (const args of [
    ["show", "tainted", "--kind", "fragment", "--json"],
    ["new", "base", join(f.home, "created"), "--with", "tainted", "--no-launch", "--json"],
  ]) {
    const result = await runCli(args, f.options);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual(expected);
  }
});

test("a symlinked markdown file is rejected without reading its target", async () => {
  const f = fixture();
  const dir = join(f.registry, "fragments", "linked-markdown");
  mkdirSync(dir);
  symlinkSync("/etc/hosts", join(dir, "FRAGMENT.md"));
  const result = await measured(
    ["show", "linked-markdown", "--kind", "fragment", "--json"],
    f.options,
  );
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr)).toMatchObject({
    error: {
      tag: "EntryInvalid",
      details: { id: "linked-markdown", reason: "symlink", path: "FRAGMENT.md" },
    },
  });
  expect(result.reads).not.toContain(join(dir, "FRAGMENT.md"));
});

test("unrelated ledger records do not make show fragment recompose their stacks", async () => {
  const f = fixture();
  const other = writeEntry({
    root: f.registry,
    kind: "stack",
    dir: "other",
    frontmatter: minimal("stack", "other"),
  });
  mkdirSync(join(other, "files"));
  writeFileSync(join(other, "files", "README.md"), "other\n");
  const unrelated = writeEntry({
    root: f.registry,
    kind: "fragment",
    dir: "unrelated",
    frontmatter: minimal("fragment", "unrelated"),
  });
  mkdirSync(join(unrelated, "files"));
  writeFileSync(join(unrelated, "files", "note.txt"), "other\n");
  writeEntry({
    root: f.registry,
    kind: "stack",
    dir: "sample",
    frontmatter: minimal("stack", "sample"),
  });
  const record = await ledgerRecord(f.registry, {
    stack: "other",
    with: ["unrelated"],
    preset: "default",
  });
  const args = ["show", "chosen", "--kind", "fragment", "--json"];
  const before = await measured(args, f.options);
  writeLedger(
    f.registry,
    Array.from({ length: 20 }, (_, index) => ({
      ...record,
      ...(index === 18 ? { agent: "none" } : {}),
      ...(index === 19 ? { preset: "unsupported" } : {}),
      date: `2026-10-${String(index + 1).padStart(2, "0")}`,
    })),
  );
  const after = await measured(args, f.options);
  expect(after.status, after.stderr).toBe(0);
  expect(JSON.parse(after.stdout)).toMatchObject({ lastRun: null });
  expect(after.paths.length - before.paths.length).toBeLessThanOrEqual(8);
});

test("list, validate and search keep the same rejected rows and entry order", async () => {
  const f = fixture();
  const invalid = writeEntry({
    root: f.registry,
    kind: "fragment",
    dir: "broken-and-linked",
    frontmatter: minimal("fragment", "wrong-id"),
  });
  mkdirSync(join(invalid, "files"));
  symlinkSync("/etc/hosts", join(invalid, "files", "escape"));
  const listed = await runCli(["list", "--json"], f.options);
  expect(listed.status, listed.stderr).toBe(0);
  const validated = await runCli(["validate", "--json"], f.options);
  expect(validated.status).toBe(2);
  const searched = await runCli(["search", "tainted", "--local", "--json"], f.options);
  expect(searched.status, searched.stderr).toBe(0);
  const actual = JSON.parse(
    JSON.stringify({
      list: JSON.parse(listed.stdout),
      validation: JSON.parse(validated.stdout),
      search: JSON.parse(searched.stdout),
    })
      .replaceAll(f.registry, "<REGISTRY>")
      .replaceAll(f.home, "<HOME>"),
  );
  const expected = JSON.parse(
    readFileSync(join(import.meta.dirname, "fixtures/registry-single-entry-baseline.json"), "utf8"),
  );
  expect(actual).toEqual(expected);
});
