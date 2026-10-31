import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, FileSystem } from "effect";
import { Command } from "effect/cli";
import { afterEach, expect, test } from "vitest";
import { cli } from "../src/cli";
import { VERSION } from "../src/version";
import { quiet, runCli } from "./helpers/cli";
import { ledgerRecord, writeLedger } from "./helpers/ledger";
import { minimal, writeEntry } from "./helpers/registry";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

test("a deep symlink rejection still names the bundled copy it hides", async () => {
  const home = realpathSync(space.dir());
  const bundled = realpathSync(space.dir());
  writeEntry({
    root: bundled,
    kind: "fragment",
    dir: "shared",
    frontmatter: minimal("fragment", "shared"),
  });
  const user = writeEntry({
    root: join(home, "config", "stacks"),
    kind: "fragment",
    dir: "shared",
    frontmatter: minimal("fragment", "wrong"),
  });
  mkdirSync(join(user, "files"));
  symlinkSync("/etc/hosts", join(user, "files", "escape"));
  const result = await runCli(["list", "--json"], {
    home,
    env: quiet,
    host: { registry: bundled },
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toMatchObject({
    rejected: [
      {
        id: "shared",
        kind: "fragment",
        origin: "user",
        error: "symlink: files/escape; hides bundled copy",
      },
    ],
  });
});

test("show fragment omits stacks whose deep tree is rejected from fits", async () => {
  const home = realpathSync(space.dir());
  const registry = realpathSync(space.dir());
  writeEntry({
    root: registry,
    kind: "fragment",
    dir: "chosen",
    frontmatter: minimal("fragment", "chosen"),
  });
  writeEntry({ root: registry, kind: "stack", dir: "good", frontmatter: minimal("stack", "good") });
  const bad = writeEntry({
    root: registry,
    kind: "stack",
    dir: "bad",
    frontmatter: minimal("stack", "bad"),
  });
  mkdirSync(join(bad, "files"));
  symlinkSync("/etc/hosts", join(bad, "files", "escape"));
  const result = await runCli(["show", "chosen", "--kind", "fragment", "--json"], {
    home,
    env: quiet,
    host: { registry },
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout).fits).toEqual(["good"]);
});

test("unrelated ledger stacks do not make show fragment walk their trees", async () => {
  const home = realpathSync(space.dir());
  const registry = realpathSync(space.dir());
  writeEntry({
    root: registry,
    kind: "fragment",
    dir: "chosen",
    frontmatter: minimal("fragment", "chosen"),
  });
  writeEntry({
    root: registry,
    kind: "fragment",
    dir: "other",
    frontmatter: minimal("fragment", "other"),
  });
  writeEntry({
    root: registry,
    kind: "stack",
    dir: "sample",
    frontmatter: minimal("stack", "sample"),
  });
  for (let index = 0; index < 12; index++) {
    const id = `unrelated-${index}`;
    const dir = writeEntry({
      root: registry,
      kind: "stack",
      dir: id,
      frontmatter: minimal("stack", id),
    });
    mkdirSync(join(dir, "files"));
    writeFileSync(join(dir, "files", "note.txt"), "unrelated\n");
  }
  const paths: string[] = [];
  const measure = async () => {
    paths.length = 0;
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
      yield* Command.runWith(cli, { version: VERSION, renderErrors: false })([
        "show",
        "chosen",
        "--kind",
        "fragment",
        "--json",
      ]).pipe(Effect.provideService(FileSystem.FileSystem, counted));
    });
    const result = await runCli(["show", "chosen", "--kind", "fragment", "--json"], {
      home,
      env: quiet,
      host: { registry },
      program,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).lastRun).toBe(null);
    return paths.length;
  };
  const before = await measure();
  const record = await ledgerRecord(registry, { with: ["other"] });
  writeLedger(
    registry,
    Array.from({ length: 12 }, (_, index) => ({
      ...record,
      stack: `unrelated-${index}`,
      date: `2026-10-${String(index + 1).padStart(2, "0")}`,
    })),
  );
  const after = await measure();
  expect(after - before).toBeLessThanOrEqual(8);
});
