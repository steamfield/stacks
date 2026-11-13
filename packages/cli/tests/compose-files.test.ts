import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { composeFiles, NEUTRAL_VARS, type RenderedFile } from "../src/core/compose/files";
import type { Composition } from "../src/core/compose/types";
import { envPrefix, slug } from "../src/core/slug";
import type { TemplateValues } from "../src/core/template";
import type { EntryInvalid, PermissionDenied } from "../src/errors";
import {
  BINARY,
  composition,
  fileFixture,
  newResult,
  projectFiles,
  scaffoldCli,
  workspace,
} from "./fixtures/composed-files";
import { gitShim, NOT_A_REPO, spawnGit } from "./helpers/git";

const space = workspace();
afterEach(() => space.release());

const render = (c: Composition, vars: TemplateValues = NEUTRAL_VARS) =>
  Effect.runPromise<ReadonlyArray<RenderedFile>, EntryInvalid | PermissionDenied>(
    composeFiles(c, vars).pipe(Effect.provide(NodeServices.layer)),
  );
const text = (file: RenderedFile | undefined) => {
  expect(file).toBeDefined();
  return new TextDecoder().decode(file?.bytes);
};
const cliFiles = [
  ".stacks/.gitignore",
  ".stacks/BRIEF.md",
  ".stacks/NOTES.md",
  ".stacks/manifest.json",
];

it.effect.prop(
  "new writes exactly the rendered paths, bytes and executable flags [2.0a#1]",
  [
    Schema.Literals(["app", "My App", "naïve-notes"]),
    Schema.Literals(["claude", "codex"]),
    Schema.Boolean,
    Schema.Literals(["", "team"]),
  ],
  ([name, agent, sandbox, scope]) =>
    Effect.promise(async () => {
      const home = space.dir();
      const fixture = fileFixture(home);
      const c = await composition(fixture, {
        agents: [agent],
        preset: sandbox ? "sandbox" : "default",
      });
      const vars: TemplateValues = {
        project_name: name,
        project_slug: slug(name),
        env_prefix: envPrefix(slug(name)),
        package_scope: scope,
        author: "Fixture Author",
        year: String(new Date().getUTCFullYear()),
      };
      const xdg = join(home, "config");
      mkdirSync(join(xdg, "stacks"), { recursive: true });
      writeFileSync(join(xdg, "stacks/config.json"), JSON.stringify({ author: vars.author }));
      const files = await render(c, vars);
      const result = newResult(
        await scaffoldCli(fixture, home, name, { agents: agent, sandbox, scope }),
      );
      expect(result.git).toBe("fresh");
      const target = join(home, name);
      expect(spawnGit(["rev-parse", "--show-toplevel"], { cwd: target }).status).toBe(0);
      const paths = files.map((file) => file.path);
      expect(paths).toEqual([...paths].sort());
      expect(new Set(paths).size).toBe(paths.length);
      expect(paths.some((path) => path.startsWith(".stacks/"))).toBe(false);
      expect(projectFiles(target)).toEqual([...paths, ...cliFiles].sort());
      expect(result.written).toEqual([...paths, ...cliFiles].sort());
      for (const file of files) {
        expect(new Uint8Array(readFileSync(join(target, file.path)))).toEqual(file.bytes);
        expect((statSync(join(target, file.path)).mode & 0o111) !== 0).toBe(file.executable);
      }
    }),
  { timeout: 60_000, arbitrary: { runs: 16 } },
);

test("rendering preserves binary copies, literal dotfiles, templates, merges and ordered owners [2.0a#1]", async () => {
  const fixture = fileFixture(space.dir());
  const c = await composition(fixture);
  // Merge bytes belong to the composition already; rendering must not read or merge them again.
  for (const entry of [fixture.stack, fixture.first, fixture.last])
    fixture.put(entry, "files/.shared/settings.json", "no longer JSON");
  const files = await render(c);
  expect(files.map((file) => [file.path, file.owner, file.executable])).toEqual([
    ["-flags.txt", "stack:sample", false],
    [".githooks/pre-commit", "fragment:sample", true],
    [".gitignore", "stack:sample", false],
    [".shared/settings.json", "stack:sample+fragment:sample+fragment:z-extra", false],
    ["AGENTS.md", "stack:sample", false],
    ["README.md", "stack:sample", false],
    ["docs/naïve notes.txt", "stack:sample", false],
    ["payload.bin", "stack:sample", false],
  ]);
  expect(files.find((file) => file.path === "payload.bin")?.bytes).toEqual(BINARY);
  expect(text(files.find((file) => file.path === ".gitignore"))).toBe(
    "node_modules/\n{{ project_name }}\n",
  );
  expect(JSON.parse(text(files.find((file) => file.path === ".shared/settings.json")))).toEqual({
    nested: { stack: true, first: true, last: true },
    order: ["stack", "first", "last"],
  });
  expect(text(files.find((file) => file.path === "README.md"))).toBe(
    "name=example\nslug=example\nenv=EXAMPLE\nscope=\nauthor=\nyear=2000\n",
  );
  expect(NEUTRAL_VARS).toEqual({
    project_name: "example",
    project_slug: "example",
    env_prefix: "EXAMPLE",
    package_scope: "",
    author: "",
    year: "2000",
  });
});

test("spaces, leading dashes, non-ASCII and quotes or backslashes stay literal [2.0a#4]", async () => {
  const home = space.dir();
  const fixture = fileFixture(home);
  const name = 'Café "notes" \\draft';
  const cwd = join(home, "working directory");
  mkdirSync(cwd);
  const c = await composition(fixture);
  const vars: TemplateValues = {
    ...NEUTRAL_VARS,
    project_name: name,
    project_slug: slug(name),
    env_prefix: envPrefix(slug(name)),
    author: 'Ada "A" \\ Lovelace',
  };
  const files = await render(c, vars);
  expect(text(files.find((file) => file.path === "README.md"))).toBe(
    `name=${name}\nslug=${vars.project_slug}\nenv=${vars.env_prefix}\nscope=\nauthor=${vars.author}\nyear=2000\n`,
  );
  const safeName = "Café 'notes' draft";
  const safeFiles = await render(c, {
    ...vars,
    project_name: safeName,
    project_slug: slug(safeName),
    env_prefix: envPrefix(slug(safeName)),
    author: "",
  });
  const result = newResult(await scaffoldCli(fixture, home, safeName, { cwd }));
  expect(result.project).toBe(join(cwd, safeName));
  expect(readFileSync(join(cwd, safeName, "README.md"), "utf8")).toContain(`name=${safeName}\n`);
  for (const path of ["-flags.txt", "docs/naïve notes.txt", ".gitignore"])
    expect(new Uint8Array(readFileSync(join(cwd, safeName, path)))).toEqual(
      safeFiles.find((file) => file.path === path)?.bytes,
    );
});

test("a user-linked bundled root renders the same files as its real path [2.0a#5]", async () => {
  const home = space.dir();
  const fixture = fileFixture(home);
  const linked = join(home, "linked registry");
  symlinkSync(fixture.root, linked, "dir");
  const original = await render(await composition(fixture));
  expect(await render(await composition({ ...fixture, root: linked }))).toEqual(original);
});

test("a source directory replaced by a symlink after compose is never followed [2.0a#5]", async () => {
  const home = space.dir();
  const fixture = fileFixture(home);
  const c = await composition(fixture);
  const outside = join(home, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "naïve notes.txt"), "private outside content");
  rmSync(join(fixture.stack, "files/docs"), { recursive: true });
  symlinkSync(outside, join(fixture.stack, "files/docs"), "dir");
  await expect(render(c)).rejects.toMatchObject({
    _tag: "EntryInvalid",
    details: { id: "sample", reason: "symlink" },
  });
  expect(readFileSync(join(outside, "naïve notes.txt"), "utf8")).toBe("private outside content");
});

test("a source removed between compose and rendering is EntryInvalid [2.0a#6]", async () => {
  const home = space.dir();
  const fixture = fileFixture(home);
  const c = await composition(fixture);
  rmSync(join(fixture.stack, "files/payload.bin"));
  await expect(render(c)).rejects.toMatchObject({
    _tag: "EntryInvalid",
    details: { id: "sample", reason: "missing", path: "files/payload.bin" },
  });
});

test("a source vanished during new's post-composition git probe leaves no project [2.0a#6]", async () => {
  const home = space.dir();
  const fixture = fileFixture(home);
  const source = join(fixture.stack, "files/payload.bin");
  const marker = join(home, "source-removed");
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const shim = gitShim(
    home,
    NOT_A_REPO.replace(
      "rev-parse)",
      `rev-parse) /bin/rm -f ${quote(source)}; /usr/bin/touch ${quote(marker)};`,
    ),
  );
  const result = await scaffoldCli(fixture, home, "app", { env: { PATH: shim } });
  expect(existsSync(marker)).toBe(true);
  expect(existsSync(source)).toBe(false);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim().split("\n")).toHaveLength(1);
  expect(JSON.parse(result.stderr)).toEqual({
    error: {
      tag: "EntryInvalid",
      message: "Entry is invalid.",
      retryable: false,
      next: "fix that entry or leave it out; stacks validate lists every problem in a registry.",
      details: { id: "sample", origin: "bundled", reason: "missing", path: "files/payload.bin" },
    },
  });
  expect(existsSync(join(home, "app"))).toBe(false);
});

test("an unknown template variable fails before new writes and preserves existing litter [2.0a#7]", async () => {
  const home = space.dir();
  const fixture = fileFixture(home);
  fixture.put(fixture.stack, "files/README.md.tmpl", "# Intro\n{{ user_defined }}\n");
  await expect(render(await composition(fixture))).rejects.toMatchObject({
    _tag: "EntryInvalid",
    details: { id: "sample", reason: "template", path: "files/README.md.tmpl", line: 2 },
  });
  const target = join(home, "app");
  mkdirSync(target);
  writeFileSync(join(target, ".DS_Store"), "keep me");
  const result = await scaffoldCli(fixture, home, "app");
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim().split("\n")).toHaveLength(1);
  expect(JSON.parse(result.stderr)).toEqual({
    error: {
      tag: "EntryInvalid",
      message: "Entry is invalid.",
      retryable: false,
      next: "use only project_name, project_slug, env_prefix, package_scope, author, year in that file's {{ }} tokens, or drop its .tmpl suffix to copy it as is.",
      details: {
        id: "sample",
        origin: "bundled",
        reason: "template",
        path: "files/README.md.tmpl",
        line: 2,
      },
    },
  });
  expect(readdirSync(target)).toEqual([".DS_Store"]);
  expect(readFileSync(join(target, ".DS_Store"), "utf8")).toBe("keep me");
});

test("a file blocking a later directory rolls back earlier writes and preserves existing files [2.0a#8]", async () => {
  const home = space.dir();
  const fixture = fileFixture(home);
  fixture.put(fixture.stack, "files/desktop.ini/late.txt", "cannot be written\n");
  const target = join(home, "app");
  mkdirSync(target);
  writeFileSync(join(target, "desktop.ini"), "OS litter, keep me");
  writeFileSync(join(home, "sibling.txt"), "outside the target");
  const result = await scaffoldCli(fixture, home, "app");
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim().split("\n")).toHaveLength(1);
  expect(JSON.parse(result.stderr)).toEqual({
    error: {
      tag: "TargetNotEmpty",
      message: "The target directory is not empty.",
      retryable: false,
      next: "pick a directory that doesn't exist yet or is empty.",
      details: { path: realpathSync(target), entries: ["desktop.ini"] },
    },
  });
  expect(readdirSync(target)).toEqual(["desktop.ini"]);
  expect(readFileSync(join(target, "desktop.ini"), "utf8")).toBe("OS litter, keep me");
  expect(readFileSync(join(home, "sibling.txt"), "utf8")).toBe("outside the target");
});
