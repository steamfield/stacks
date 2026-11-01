import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Category, FragmentMeta, StackMeta } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterEach, describe, expect, test, vi } from "vitest";
import { parseDocument } from "yaml";
import { splitFrontmatter } from "../src/core/registry/entry";
import { ListResult } from "../src/schemas/list";
import { NewResult } from "../src/schemas/new";
import { ValidateReport } from "../src/schemas/validate";
import { VerifyResult } from "../src/schemas/verify";
import {
  authoringGuide,
  bundledRegistry,
  createCli,
  created,
  createFailure,
  createFixture,
  createWorkspace,
  entryPath,
  entrySnapshot,
  jsonResult,
  putCreate,
  releaseCreate,
  userRoot,
} from "./helpers/create";
import { spawnGit } from "./helpers/git";
import { minimal, writeEntry } from "./helpers/registry";
import { splitEvents } from "./helpers/verify";

afterEach(releaseCreate);
const read = (path: string) => readFileSync(path, "utf8");
/** A fragment skeleton has no verify step until its author adds one. */
const noVerify = (entry: string) => ({
  check: "fragment-no-verify",
  entry,
  file: `fragments/${entry}/FRAGMENT.md`,
  kind: "fragment",
  message:
    "This fragment has no verify step; add a check for its deliverable, or explain in its body why it cannot be checked.",
  severity: "note",
});
async function validate(home: string, target: string) {
  return jsonResult(await createCli(home, ["validate", target, "--json"]), ValidateReport);
}
function source(home: string, kind: "stack" | "fragment" = "stack", id = "x") {
  return writeEntry({
    root: join(home, ".stacks"),
    kind,
    dir: id,
    frontmatter: minimal(kind, id),
    body: "PROJECT GUIDANCE\n",
  });
}
function metadata(path: string) {
  const parts = splitFrontmatter(read(path));
  expect(parts).toBeDefined();
  if (!parts) throw new Error("Scaffold must have frontmatter");
  const doc = parseDocument(parts.frontmatter, { logLevel: "silent" });
  expect(doc.errors).toEqual([]);
  expect(doc.warnings).toEqual([]);
  return {
    ...parts,
    frontmatter: Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(doc.toJS()),
  };
}

describe("create an entry", () => {
  test.skipIf(process.getuid?.() === 0)(
    "an unreadable registry refuses create without writing anything",
    async () => {
      const home = createWorkspace();
      const fragments = join(userRoot(home), "fragments");
      mkdirSync(fragments, { recursive: true });
      const before = entrySnapshot(home);
      chmodSync(fragments, 0);
      try {
        const error = createFailure(
          await createCli(home, ["create", "stack", "fresh", "--json"], { host: { cwd: home } }),
          6,
          "PermissionDenied",
        );
        expect(error.details).toEqual({ reason: "read", path: fragments });
        expect(existsSync(entryPath(home, "stack", "fresh"))).toBe(false);
      } finally {
        chmodSync(fragments, 0o755);
      }
      expect(entrySnapshot(home)).toEqual(before);
    },
  );

  test.each([false, true])(
    "a fresh skeleton refuses an existing id (project copy: %s)",
    async (projectCopy) => {
      const home = createWorkspace();
      if (projectCopy) source(home, "stack", "go-cli");
      const before = entrySnapshot(home);
      const args = ["create", "stack", "go-cli"];
      const error = createFailure(
        await createCli(home, [...args, "--json"], { host: { cwd: home } }),
        2,
        "BadInput",
      );
      expect(error).toEqual({
        tag: "BadInput",
        message: "Invalid input.",
        retryable: false,
        details: {
          id: "go-cli",
          flag: "create_shadows",
          origins: projectCopy ? ["project", "bundled"] : ["bundled"],
        },
      });
      expect(entrySnapshot(home)).toEqual(before);
      expect(existsSync(entryPath(home, "stack", "go-cli"))).toBe(false);
      const text = await createCli(home, args, { host: { cwd: home } });
      expect(text.status).toBe(2);
      expect(text.stdout).toBe("");
      expect(text.stderr).toContain(
        `Next: use --from ${projectCopy ? "project" : "bundled"} to start from a copy, or pick another id.`,
      );
      if (!projectCopy) {
        const preview = jsonResult(
          await createCli(home, ["new", "go-cli", "demo", "--dry-run", "--json"], {
            host: { cwd: home },
          }),
          NewResult,
        );
        expect(preview.fragments.length).toBeGreaterThan(0);
        expect(preview.written).toContain("Makefile");
        expect(existsSync(join(home, "demo"))).toBe(false);
      }
    },
  );

  test("reference skeletons pin today's complete validate findings [3.1b#1]", async () => {
    const home = createWorkspace();
    cpSync(createFixture, userRoot(home), { recursive: true });
    expect((await validate(home, entryPath(home, "stack", "my-api"))).findings).toEqual([
      {
        check: "search-missing",
        entry: "my-api",
        file: "search/stacks/my-api.json",
        kind: "stack",
        message: "No search card; add a reviewed sidecar for search discovery.",
        severity: "note",
      },
    ]);
    expect((await validate(home, entryPath(home, "fragment", "my-ci"))).findings).toEqual([
      noVerify("my-ci"),
      {
        check: "search-missing",
        entry: "my-ci",
        file: "search/fragments/my-ci.json",
        kind: "fragment",
        message: "No search card; add a reviewed sidecar for search discovery.",
        severity: "note",
      },
    ]);
    const invalid = await createCli(home, [
      "validate",
      entryPath(home, "fragment", "my-app"),
      "--json",
    ]);
    expect(invalid.status).toBe(2);
    expect(invalid.stdout.trim().split("\n")).toHaveLength(1);
    expect(Schema.decodeUnknownSync(ValidateReport)(JSON.parse(invalid.stdout)).findings).toEqual([
      {
        check: "schema",
        severity: "error",
        kind: "fragment",
        entry: "my-app",
        file: "fragments/my-app/FRAGMENT.md",
        message: "applies_to: an app must name at least one stack or tag",
      },
    ]);
    expect(invalid.stderr.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(invalid.stderr)).toEqual({
      error: {
        tag: "ValidationFailed",
        message: "Validation failed.",
        retryable: false,
        next: "fix the error findings in the report on stdout, then run stacks validate again.",
        details: { errors: 1, warnings: 0 },
      },
    });
    // Three real validations load the registry and run its reference checks under concurrent gates.
  }, 30_000);

  test("fresh stack and fragment skeletons have exactly the missing-card and missing-check notes [3.1b#1]", async () => {
    const home = createWorkspace();
    await created(await createCli(home, ["create", "stack", "my-api", "--json"]));
    await created(await createCli(home, ["create", "fragment", "my-ci", "--json"]));
    const stack = entryPath(home, "stack", "my-api");
    const fragment = entryPath(home, "fragment", "my-ci");
    expect((await validate(home, stack)).findings).toEqual([
      {
        check: "search-missing",
        entry: "my-api",
        file: "search/stacks/my-api.json",
        kind: "stack",
        message: "No search card; add a reviewed sidecar for search discovery.",
        severity: "note",
      },
    ]);
    expect((await validate(home, fragment)).findings).toEqual([
      noVerify("my-ci"),
      {
        check: "search-missing",
        entry: "my-ci",
        file: "search/fragments/my-ci.json",
        kind: "fragment",
        message: "No search card; add a reviewed sidecar for search discovery.",
        severity: "note",
      },
    ]);
    const parts = metadata(join(stack, "STACK.md"));
    const meta = Schema.decodeUnknownSync(StackMeta, { onExcessProperty: "error" })(
      parts.frontmatter,
    );
    const shared = [
      "schema_version",
      "id",
      "kind",
      "name",
      "description",
      "tags",
      "deps",
      "commands",
      "tools",
      "decisions",
      "env",
      "verify",
      "merge",
    ];
    expect(Object.keys(parts.frontmatter).sort()).toEqual([...shared, "fragments"].sort());
    expect(meta).toMatchObject({ id: "my-api", kind: "stack" });
    expect(meta.description).toContain("stacks:fill");
    expect(meta.decisions.length).toBeGreaterThan(0);
    expect(meta.decisions.every((decision) => /\(default\b/i.test(decision))).toBe(true);
    for (const [layer, command] of [
      ["install", "make install"],
      ["lint", "make lint"],
      ["typecheck", "make typecheck"],
      ["test", "make test"],
    ])
      expect(meta.verify).toEqual(
        expect.arrayContaining([expect.objectContaining({ layer, run: command })]),
      );
    expect(meta.verify).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "readme", phase: "check", layer: "docs" }),
      ]),
    );
    expect(lstatSync(join(stack, "files/.gitignore")).isFile()).toBe(true);
    expect(read(join(stack, "files/README.md"))).toContain("stacks:fill");
    for (const heading of [
      "Layout",
      "Setup",
      "Conventions",
      "Tool configuration",
      "Testing",
      "Commands",
      "Gotchas",
    ])
      expect(parts.body).toContain(`## ${heading}`);
    const fragmentParts = metadata(join(fragment, "FRAGMENT.md"));
    expect(Object.keys(fragmentParts.frontmatter).sort()).toEqual(
      [
        ...shared,
        "category",
        "applies_to",
        "needs_own_repo",
        "requires",
        "conflicts",
        "requires_tools",
      ].sort(),
    );
    expect(Schema.decodeUnknownSync(FragmentMeta)(fragmentParts.frontmatter)).toMatchObject({
      id: "my-ci",
      kind: "fragment",
    });
    for (const heading of ["What to add", "Tool configuration", "Verify", "AGENTS.md"])
      expect(fragmentParts.body).toContain(`## ${heading}`);
    // Two creates and two real validations traverse the registry; this is heavier than one command.
  }, 30_000);

  test("the skeleton's readme step rejects empty and fill-marker files and accepts filled prose [3.1b#1]", async () => {
    const home = createWorkspace();
    await created(await createCli(home, ["create", "stack", "my-api", "--json"]));
    const result = jsonResult(
      await createCli(home, ["new", "my-api", "app", "--json", "--author", ""]),
      NewResult,
    );
    const readme = join(result.project, "README.md");
    putCreate(
      result.project,
      "Makefile",
      ".PHONY: install lint typecheck test\ninstall lint typecheck test:\n\t@true\n",
    );
    for (const [text, status, outcome] of [
      ["", 5, "failed"],
      ["<!-- stacks:fill: write this -->\n", 5, "failed"],
      ["# A filled project\n\nRun make test.\n", 0, "green"],
    ] as const) {
      writeFileSync(readme, text);
      const run = await createCli(home, ["verify", "--json"], {
        host: { cwd: result.project },
        env: { PATH: process.env.PATH ?? "" },
      });
      expect(run.status).toBe(status);
      expect(run.stdout.trim().split("\n")).toHaveLength(1);
      const report = Schema.decodeUnknownSync(VerifyResult)(JSON.parse(run.stdout));
      expect(report.outcome).toBe(outcome);
      expect(report.steps.find((step) => step.name === "readme")?.status).toBe(
        status === 0 ? "passed" : "failed",
      );
      // Besides verify's live events, stderr is empty on green and one envelope on failure.
      const { rest } = splitEvents(run.stderr);
      if (status === 0) expect(rest).toBe("");
      else {
        expect(rest.trim().split("\n")).toHaveLength(1);
        expect(JSON.parse(rest)).toMatchObject({
          error: { tag: "VerifyFailed", retryable: false },
        });
      }
    }
  });

  test("an app starts with only the applies_to schema error and becomes valid when filled [3.1b#1]", async () => {
    const home = createWorkspace();
    await created(await createCli(home, ["create", "stack", "my-api", "--json"]));
    await created(
      await createCli(home, ["create", "fragment", "my-app", "--category", "app", "--json"]),
    );
    const path = join(entryPath(home, "fragment", "my-app"), "FRAGMENT.md");
    const run = await createCli(home, ["validate", dirname(path), "--json"]);
    expect(run.status).toBe(2);
    expect(run.stdout.trim().split("\n")).toHaveLength(1);
    expect(Schema.decodeUnknownSync(ValidateReport)(JSON.parse(run.stdout)).findings).toEqual([
      {
        check: "schema",
        severity: "error",
        kind: "fragment",
        entry: "my-app",
        file: "fragments/my-app/FRAGMENT.md",
        message: "applies_to: an app must name at least one stack or tag",
      },
    ]);
    expect(run.stderr.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(run.stderr)).toMatchObject({
      error: { tag: "ValidationFailed", details: { errors: 1, warnings: 0 } },
    });
    const before = read(path);
    expect(before).toMatch(/^applies_to:\s*\[\]/m);
    writeFileSync(path, before.replace(/^applies_to:\s*\[\]/m, "applies_to: [my-api]"));
    expect((await validate(home, dirname(path))).findings).toEqual([
      noVerify("my-app"),
      {
        check: "search-missing",
        entry: "my-app",
        file: "search/fragments/my-app.json",
        kind: "fragment",
        message: "No search card; add a reviewed sidecar for search discovery.",
        severity: "note",
      },
    ]);
    expect(Schema.decodeUnknownSync(FragmentMeta)(metadata(path).frontmatter).category).toBe("app");
    // Two creates and two validations cover the invalid-to-valid transition against the registry.
  }, 30_000);

  test("a bundled working copy shadows its origin and new reads the edited body [3.1b#2]", async () => {
    const home = createWorkspace();
    await created(
      await createCli(home, ["create", "stack", "go-cli", "--from", "bundled", "--json"]),
    );
    const copy = entryPath(home, "stack", "go-cli");
    expect(entrySnapshot(copy)).toEqual(entrySnapshot(join(bundledRegistry, "stacks/go-cli")));
    const rows = jsonResult(await createCli(home, ["list", "--json"]), ListResult);
    expect(rows.rejected).toEqual([]);
    expect(rows.entries.find((row) => row.id === "go-cli" && row.kind === "stack")).toMatchObject({
      origin: "user",
      trusted: true,
      shadows: ["bundled"],
    });
    const path = join(copy, "STACK.md");
    writeFileSync(path, `${read(path)}\nPERSONAL COPY GUIDANCE\n`);
    const result = jsonResult(
      await createCli(home, ["new", "go-cli", "app", "--json", "--author", ""]),
      NewResult,
    );
    expect(read(join(result.project, result.brief))).toContain("PERSONAL COPY GUIDANCE");
    expect(result.untrusted.some((entry) => entry.id === "go-cli")).toBe(false);
  });

  test.each([
    { env: { CLAUDECODE: "1" }, stdinIsTTY: true, reason: "agent" },
    { env: {}, stdinIsTTY: false, reason: "no-tty" },
  ])(
    "project copies refuse trust elevation even with --yes: $reason [3.1b#3]",
    async ({ env, stdinIsTTY, reason }) => {
      const home = createWorkspace();
      source(home);
      const before = entrySnapshot(join(home, ".stacks"));
      const error = createFailure(
        await createCli(home, ["create", "stack", "x", "--from", "project", "--yes", "--json"], {
          env,
          host: { stdinIsTTY },
        }),
        6,
        "PermissionDenied",
      );
      expect(error.details).toMatchObject({ reason });
      expect(existsSync(userRoot(home))).toBe(false);
      expect(entrySnapshot(join(home, ".stacks"))).toEqual(before);
    },
  );

  test("a human sees the full trust report before a project copy becomes trusted [3.1b#3]", async () => {
    const home = createWorkspace();
    const entry = source(home);
    putCreate(entry, "files/nested/data.bin", Buffer.from([0, 255, 13, 10]));
    putCreate(entry, "adapters/claude/hook.sh", "#!/bin/sh\nexit 0\n");
    chmodSync(join(entry, "adapters/claude/hook.sh"), 0o755);
    putCreate(entry, "notes.txt", "author notes\r\n");
    writeFileSync(
      join(entry, "STACK.md"),
      `---\n${minimal("stack", "x", "commands: { test: project-test }\nverify: [{ name: test, run: make test, layer: test }]")}\n---\nPROJECT GUIDANCE\n`,
    );
    const run = await createCli(home, ["create", "stack", "x", "--from", "project", "--yes"], {
      host: { stdinIsTTY: true, stdoutIsTTY: true },
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("config/stacks/stacks/x");
    expect(run.stdout).toContain(authoringGuide);
    for (const text of [
      "PROJECT GUIDANCE",
      "project-test",
      "make test",
      "nested/data.bin",
      "hook.sh",
    ])
      expect(run.stderr).toContain(text);
    expect(entrySnapshot(entryPath(home, "stack", "x"))).toEqual(entrySnapshot(entry));
    // Project resolution wins in the source cwd; inspect the copy from a separate cwd.
    const listing = jsonResult(
      await createCli(home, ["list", "--json"], { host: { cwd: createWorkspace() } }),
      ListResult,
    );
    expect(listing.rejected).toEqual([]);
    expect(listing.entries.find((row) => row.id === "x")).toMatchObject({
      origin: "user",
      trusted: true,
    });
  });

  test("the user origin cannot be copied into itself [3.1b#4]", async () => {
    const home = createWorkspace();
    createFailure(
      await createCli(home, ["create", "stack", "x", "--from", "user", "--json"]),
      2,
      "BadInput",
    );
    expect(readdirSync(home)).toEqual([]);
  });

  test("create never executes tools, entry steps or HTTP probes [3.1b#7]", async () => {
    const home = createWorkspace();
    const bin = join(home, "bin");
    for (const tool of [
      "git",
      "make",
      "bun",
      "npm",
      "pnpm",
      "yarn",
      "go",
      "curl",
      "wget",
      "node",
      "codex",
      "claude",
    ])
      putCreate(bin, tool, '#!/bin/sh\nprintf ran >> "$HOME/process-ran"\nexit 0\n');
    for (const tool of readdirSync(bin)) chmodSync(join(bin, tool), 0o755);
    const registry = createWorkspace();
    writeEntry({
      root: registry,
      kind: "stack",
      dir: "probe",
      frontmatter: minimal(
        "stack",
        "probe",
        'tools: [make]\nverify: [{ name: serve, phase: serve, run: make serve, expect: { http: "https://example.invalid/create-must-not-probe" } }]',
      ),
    });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("create must not fetch"));
    try {
      for (const args of [
        ["stack", "fresh"],
        ["fragment", "fresh"],
        ["stack", "probe", "--from", "bundled"],
      ])
        await created(
          await createCli(home, ["create", ...args, "--json"], {
            env: { PATH: bin },
            host: { registry },
          }),
        );
      expect(existsSync(join(home, "process-ran"))).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  test.each(["empty", "partial", "file"])(
    "an existing %s target is BadInput and keeps its bytes [3.1b#9]",
    async (state) => {
      const home = createWorkspace();
      const path = entryPath(home, "stack", "x");
      mkdirSync(dirname(path), { recursive: true });
      if (state === "file") writeFileSync(path, "previous file\n");
      else {
        mkdirSync(path);
        if (state === "partial") putCreate(path, "STACK.md", "unfinished previous scaffold\n");
      }
      const before = entrySnapshot(userRoot(home));
      createFailure(await createCli(home, ["create", "stack", "x", "--json"]), 2, "BadInput");
      expect(entrySnapshot(userRoot(home))).toEqual(before);
      expect(lstatSync(path).isDirectory()).toBe(state !== "file");
    },
  );

  test.each(["../escape", "Upper", "café", "two words", "line\nbreak", "bad\u001b[31m"])(
    "invalid id %j writes nothing [3.1b#10]",
    async (id) => {
      const home = createWorkspace();
      createFailure(await createCli(home, ["create", "fragment", id, "--json"]), 2, "BadInput");
      expect(readdirSync(home)).toEqual([]);
    },
  );

  test("a dotfiles user-root symlink and unusual cwd preserve XDG placement [3.1b#11]", async () => {
    const home = createWorkspace();
    const actual = join(createWorkspace(), "-café registry");
    mkdirSync(actual);
    mkdirSync(dirname(userRoot(home)), { recursive: true });
    symlinkSync(actual, userRoot(home));
    const cwd = join(createWorkspace(), "-café project");
    mkdirSync(cwd);
    expect(spawnGit(["init", "--quiet", cwd]).status).toBe(0);
    const before = entrySnapshot(cwd);
    await created(
      await createCli(home, ["create", "fragment", "ci-team", "--category", "ci", "--json"], {
        host: { cwd },
        env: { GIT_DIR: join(cwd, ".git") },
      }),
    );
    expect(lstatSync(userRoot(home)).isSymbolicLink()).toBe(true);
    expect(
      Schema.decodeUnknownSync(FragmentMeta)(
        metadata(join(actual, "fragments/ci-team/FRAGMENT.md")).frontmatter,
      ).category,
    ).toBe("ci");
    expect(entrySnapshot(cwd)).toEqual(before);
    expect(existsSync(join(home, ".config"))).toBe(false);
  });

  test.each(["file", "directory", "loop"])(
    "a %s symlink inside a source is rejected without a partial copy [3.1b#12]",
    async (type) => {
      const home = createWorkspace();
      const registry = createWorkspace();
      const entry = writeEntry({
        root: registry,
        kind: "fragment",
        dir: "x",
        frontmatter: minimal("fragment", "x"),
      });
      putCreate(entry, "files/a-ordinary.txt", "copy this first\n");
      const outside = createWorkspace();
      putCreate(outside, "private.txt", "keep private\n");
      let destination = join(outside, "private.txt");
      if (type === "loop") destination = "z-link";
      else if (type === "directory") destination = outside;
      symlinkSync(destination, join(entry, "files/z-link"));
      createFailure(
        await createCli(home, ["create", "fragment", "x", "--from", "bundled", "--json"], {
          host: { registry },
        }),
        2,
        "EntryInvalid",
      );
      expect(existsSync(entryPath(home, "fragment", "x"))).toBe(false);
      expect(readdirSync(home)).toEqual([]);
      expect(read(join(outside, "private.txt"))).toBe("keep private\n");
      expect(lstatSync(join(entry, "files/z-link")).isSymbolicLink()).toBe(true);
    },
  );

  test.skipIf(process.getuid?.() === 0)(
    "an unwritable destination is PermissionDenied and preserves siblings [3.1b#13]",
    async () => {
      const home = createWorkspace();
      const stacks = dirname(entryPath(home, "stack", "x"));
      mkdirSync(stacks, { recursive: true });
      putCreate(stacks, "keep.txt", "mine\n");
      mkdirSync(join(stacks, "empty-before"));
      chmodSync(stacks, 0o555);
      try {
        createFailure(
          await createCli(home, ["create", "stack", "x", "--json"]),
          6,
          "PermissionDenied",
        );
      } finally {
        chmodSync(stacks, 0o755);
      }
      expect(readdirSync(stacks).sort()).toEqual(["empty-before", "keep.txt"]);
      expect(read(join(stacks, "keep.txt"))).toBe("mine\n");
    },
  );

  test("--from resolves only the named origin despite a higher-precedence copy [3.1b#14]", async () => {
    const home = createWorkspace();
    source(home);
    const registry = createWorkspace();
    const entry = writeEntry({
      root: registry,
      kind: "stack",
      dir: "x",
      frontmatter: minimal("stack", "x"),
      body: "BUNDLED GUIDANCE\n",
    });
    await created(
      await createCli(home, ["create", "stack", "x", "--from", "bundled", "--json"], {
        host: { registry },
      }),
    );
    expect(entrySnapshot(entryPath(home, "stack", "x"))).toEqual(entrySnapshot(entry));
    const other = createWorkspace();
    writeEntry({
      root: registry,
      kind: "stack",
      dir: "only-bundled",
      frontmatter: minimal("stack", "only-bundled"),
    });
    createFailure(
      await createCli(
        other,
        ["create", "stack", "only-bundled", "--from", "project", "--yes", "--json"],
        { host: { registry, stdinIsTTY: true } },
      ),
      2,
      "NotFound",
    );
    expect(readdirSync(other)).toEqual([]);
  });

  test.each(Category.literals)(
    "a requested %s category is written without falling back [3.1b#15]",
    async (category) => {
      const home = createWorkspace();
      await created(
        await createCli(home, ["create", "fragment", "x", "--category", category, "--json"]),
      );
      const path = join(entryPath(home, "fragment", "x"), "FRAGMENT.md");
      const parts = metadata(path);
      expect(parts.frontmatter.category).toBe(category);
      // Apps deliberately need applies_to filled before the complete schema can decode them.
      if (category !== "app")
        expect(Schema.decodeUnknownSync(FragmentMeta)(parts.frontmatter).category).toBe(category);
    },
  );

  test.each(["APP", "unknown"])(
    "invalid category %s is Usage and writes nothing [3.1b#15]",
    async (category) => {
      const home = createWorkspace();
      createFailure(
        await createCli(home, ["create", "fragment", "x", "--category", category, "--json"]),
        2,
        "Usage",
      );
      expect(readdirSync(home)).toEqual([]);
    },
  );

  test("a target symlink is an existing target and is never followed [3.1b#16]", async () => {
    const home = createWorkspace();
    const target = entryPath(home, "stack", "x");
    const outside = createWorkspace();
    putCreate(outside, "keep.txt", "personal file\n");
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(outside, target);
    const before = entrySnapshot(outside);
    createFailure(await createCli(home, ["create", "stack", "x", "--json"]), 2, "BadInput");
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(entrySnapshot(outside)).toEqual(before);
  });

  test.skipIf(process.getuid?.() === 0)(
    "an unreadable source leaves no partial copy and keeps existing entries [3.1b#17]",
    async () => {
      const home = createWorkspace();
      const registry = createWorkspace();
      const entry = writeEntry({
        root: registry,
        kind: "fragment",
        dir: "x",
        frontmatter: minimal("fragment", "x"),
      });
      putCreate(entry, "files/a.txt", "readable\n");
      putCreate(entry, "files/z.txt", "unreadable\n");
      writeEntry({
        root: userRoot(home),
        kind: "fragment",
        dir: "keep",
        frontmatter: minimal("fragment", "keep"),
      });
      const before = entrySnapshot(userRoot(home));
      chmodSync(join(entry, "files/z.txt"), 0o000);
      try {
        createFailure(
          await createCli(home, ["create", "fragment", "x", "--from", "bundled", "--json"], {
            host: { registry },
          }),
          6,
          "PermissionDenied",
        );
      } finally {
        chmodSync(join(entry, "files/z.txt"), 0o644);
      }
      expect(existsSync(entryPath(home, "fragment", "x"))).toBe(false);
      expect(entrySnapshot(userRoot(home))).toEqual(before);
      expect(read(join(entry, "files/z.txt"))).toBe("unreadable\n");
    },
  );
});
