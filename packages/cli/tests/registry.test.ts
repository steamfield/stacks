import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { APP_TAG, Manifest } from "@steamfield/stacks-format";
import { Effect, Exit, Schema } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import { MANIFEST_PATH } from "../src/core/project/manifest";
import { type Entry, isRejected } from "../src/core/registry/entry";
import { Registry, trustOf } from "../src/core/registry/registry";
import type { RegistryRoots } from "../src/core/registry/roots";
import { BUDGET } from "../src/core/validate/compositions/budget";
import { EntryInvalid, NotFound, PermissionDenied } from "../src/errors";
import { NewResult } from "../src/schemas/new";
import { quiet, runCli, tempDir } from "./helpers/cli";
import { gitShim, spawnGit } from "./helpers/git";
import {
  brokenRegistry,
  composeRegistry,
  minimal,
  realRegistry,
  smallRegistry,
  writeEntry,
} from "./helpers/registry";

const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});
function temp() {
  const dir = tempDir();
  dirs.push(dir);
  return dir.path;
}
function run<A, E>(roots: RegistryRoots, program: Effect.Effect<A, E, Registry>) {
  return Effect.runPromiseExit(
    program.pipe(Effect.provide(Registry.layer(roots)), Effect.provide(NodeServices.layer)),
  );
}
const bundled = [{ origin: "bundled", path: smallRegistry }] as const;

test("files lists literal dotfiles and strips the files/ and adapters/<agent>/ prefixes [1.0#11]", async () => {
  const exit = await run(
    bundled,
    Effect.gen(function* () {
      const registry = yield* Registry;
      return yield* registry.files(yield* registry.get("fragment", "editor-config"));
    }),
  );
  expect(Exit.isSuccess(exit) && exit.value.map(({ source, path }) => ({ source, path }))).toEqual([
    { source: "adapters/claude/.claude/settings.json", path: ".claude/settings.json" },
    { source: "files/.editorconfig", path: ".editorconfig" },
    { source: "files/.gitignore", path: ".gitignore" },
  ]);
  expect(Exit.isSuccess(exit) && exit.value.every((file) => file.mode > 0)).toBe(true);
});

test("an entry without files/ or adapters/ ships no files", async () => {
  const exit = await run(
    bundled,
    Effect.gen(function* () {
      const registry = yield* Registry;
      return yield* registry.files(yield* registry.get("stack", "go-api"));
    }),
  );
  expect(exit).toEqual(Exit.succeed([]));
});

test("get returns the winning entry with its marks and body", async () => {
  const user = temp();
  writeEntry({
    root: user,
    kind: "stack",
    dir: "bun-web",
    frontmatter: minimal("stack", "bun-web"),
    body: "Body text.\n",
  });
  const exit = await run(
    [
      { origin: "user", path: user },
      { origin: "bundled", path: smallRegistry },
    ],
    Effect.flatMap(Registry, (registry) => registry.get("stack", "bun-web")),
  );
  expect(Exit.isSuccess(exit) && exit.value).toMatchObject({
    id: "bun-web",
    kind: "stack",
    origin: "user",
    dir: join(user, "stacks", "bun-web"),
    trusted: true,
    shadows: ["bundled"],
    body: "Body text.\n",
  });
});

test.each([
  ["decode", minimal("stack", "broken", "unknown_key: 1"), "broken", "STACK.md"],
  ["id_mismatch", minimal("stack", "other"), "broken", "STACK.md"],
] as const)(
  "get on an entry that is rejected for %s fails EntryInvalid",
  async (reason, frontmatter, id, path) => {
    const user = temp();
    writeEntry({ root: user, kind: "stack", dir: id, frontmatter });
    const exit = await run(
      [{ origin: "user", path: user }],
      Effect.flatMap(Registry, (registry) => registry.get("stack", id)),
    );
    expect(exit).toEqual(
      Exit.fail(new EntryInvalid({ details: { id, origin: "user", reason, path } })),
    );
  },
);

test("get on an entry holding a symlink fails EntryInvalid with the link's path", async () => {
  const project = temp();
  const entry = writeEntry({
    root: project,
    kind: "fragment",
    dir: "linky",
    frontmatter: minimal("fragment", "linky"),
  });
  mkdirSync(join(entry, "files"));
  symlinkSync("/etc/hosts", join(entry, "files", "hosts"));
  const exit = await run(
    [{ origin: "project", path: project }],
    Effect.flatMap(Registry, (registry) => registry.get("fragment", "linky")),
  );
  expect(exit).toEqual(
    Exit.fail(
      new EntryInvalid({
        details: { id: "linky", origin: "project", reason: "symlink", path: "files/hosts" },
      }),
    ),
  );
});

test.each(["..", "../stacks/go-api"])("registry lookup refuses a path as an id: %s", async (id) => {
  const result = await run(
    bundled,
    Effect.gen(function* () {
      return yield* (yield* Registry).get("stack", id);
    }),
  );
  expect(result).toEqual(
    Exit.fail(new NotFound({ details: { suggestions: [], id, kind: "stack" } })),
  );
});

test("get on an unknown id, or the right id under the other kind, fails NotFound naming the id and kind", async () => {
  for (const [kind, id] of [
    ["stack", "nope"],
    ["fragment", "bun-web"],
  ] as const) {
    const exit = await run(
      bundled,
      Effect.flatMap(Registry, (registry) => registry.get(kind, id)),
    );
    expect(exit).toEqual(Exit.fail(new NotFound({ details: { suggestions: [], id, kind } })));
  }
});

test("roots that don't exist are empty, not errors", async () => {
  const exit = await run(
    [
      { origin: "project", path: join(temp(), "missing") },
      { origin: "bundled", path: smallRegistry },
    ],
    Effect.flatMap(Registry, (registry) => registry.all),
  );
  expect(Exit.isSuccess(exit) && exit.value.filter((item) => !isRejected(item))).toHaveLength(6);
});

test("trust is by origin and root in 1.0: project entries and an overridden bundled root are untrusted", () => {
  const entry = (origin: "project" | "user" | "bundled") => ({
    id: "s",
    kind: "stack" as const,
    origin,
    dir: "/x",
    shadows: [],
    meta: {} as never,
    body: "",
  });
  expect(trustOf(entry("project"), { origin: "project", path: "/p" })).toBe(false);
  expect(trustOf(entry("user"), { origin: "user", path: "/u" })).toBe(true);
  expect(trustOf(entry("bundled"), { origin: "bundled", path: "/b" })).toBe(true);
  expect(trustOf(entry("bundled"), { origin: "bundled", path: "/b", overridden: true })).toBe(
    false,
  );
});

test.each([
  ["the filesystem root", (): string => "/"],
  ["its own parent, a loop", (): string => ".."],
  [
    "a tree with an unreadable directory",
    (): string => {
      const outside = temp();
      mkdirSync(join(outside, "deep", "locked"), { recursive: true });
      chmodSync(join(outside, "deep", "locked"), 0o000);
      return outside;
    },
  ],
] as const)(
  "a symlinked directory to %s is rejected as a symlink without being walked",
  async (_case, target) => {
    const root = temp();
    const entry = writeEntry({
      root,
      kind: "fragment",
      dir: "escape",
      frontmatter: minimal("fragment", "escape"),
    });
    mkdirSync(join(entry, "files"));
    const to = target();
    symlinkSync(to, join(entry, "files", "escape"));
    const started = performance.now();
    try {
      const exit = await run(
        [{ origin: "user", path: root }],
        Effect.flatMap(Registry, (registry) => registry.get("fragment", "escape")),
      );
      expect(exit).toEqual(
        Exit.fail(
          new EntryInvalid({
            details: { id: "escape", origin: "user", reason: "symlink", path: "files/escape" },
          }),
        ),
      );
      expect(performance.now() - started).toBeLessThan(1000);
    } finally {
      if (to.startsWith("/") && to !== "/") chmodSync(join(to, "deep", "locked"), 0o755);
    }
  },
);

test("files stops at a symlink under adapters/ without following it", async () => {
  const root = temp();
  const entry = writeEntry({
    root,
    kind: "fragment",
    dir: "linked",
    frontmatter: minimal("fragment", "linked"),
  });
  mkdirSync(join(entry, "adapters", "claude"), { recursive: true });
  symlinkSync("/", join(entry, "adapters", "claude", "all"));
  const exit = await run(
    [{ origin: "user", path: root }],
    Effect.flatMap(Registry, (registry) => registry.get("fragment", "linked")),
  );
  expect(exit).toEqual(
    Exit.fail(
      new EntryInvalid({
        details: { id: "linked", origin: "user", reason: "symlink", path: "adapters/claude/all" },
      }),
    ),
  );
});

/** `read(entry, source)` on a fresh `readable` user entry, after `change` has altered it on disk. */
function readAfter(source: string, change: (entry: string) => void = () => {}) {
  const user = temp();
  const entry = writeEntry({
    root: user,
    kind: "fragment",
    dir: "readable",
    frontmatter: minimal("fragment", "readable"),
  });
  mkdirSync(join(entry, "files", "sub"), { recursive: true });
  writeFileSync(join(entry, "files", "sub", "a.txt"), "inside\n");
  const exit = run(
    [{ origin: "user", path: user }],
    Effect.gen(function* () {
      const registry = yield* Registry;
      const loaded = yield* registry.get("fragment", "readable");
      // The change lands after the entry was loaded, as a race with another writer would.
      yield* Effect.sync(() => change(entry));
      return yield* registry.read(loaded, source);
    }),
  );
  return { entry, exit };
}
const readInvalid = (reason: "symlink" | "missing", path: string) =>
  Exit.fail(new EntryInvalid({ details: { id: "readable", origin: "user", reason, path } }));

test("read returns an entry file's text", async () => {
  expect(await readAfter("files/sub/a.txt").exit).toEqual(Exit.succeed("inside\n"));
});

test("read refuses a symlinked segment or entry directory without reading behind it", async () => {
  const outside = temp();
  mkdirSync(join(outside, "secret"));
  writeFileSync(join(outside, "secret", "a.txt"), "SECRET\n");
  // files/sub replaced by a link to a directory holding a file of the same name.
  const segment = readAfter("files/sub/a.txt", (entry) => {
    rmSync(join(entry, "files", "sub"), { recursive: true });
    symlinkSync(join(outside, "secret"), join(entry, "files", "sub"));
  });
  expect(await segment.exit).toEqual(readInvalid("symlink", "files/sub"));
  // The file itself a link.
  const file = readAfter("files/sub/a.txt", (entry) => {
    rmSync(join(entry, "files", "sub", "a.txt"));
    symlinkSync(join(outside, "secret", "a.txt"), join(entry, "files", "sub", "a.txt"));
  });
  expect(await file.exit).toEqual(readInvalid("symlink", "files/sub/a.txt"));
  // The entry directory moved away and linked back.
  const dir = readAfter("files/sub/a.txt", (entry) => {
    renameSync(entry, `${entry}-real`);
    symlinkSync(`${entry}-real`, entry);
  });
  expect(await dir.exit).toEqual(readInvalid("symlink", "."));
});

test("read reports an absent file, and an empty, . or .. segment, as missing", async () => {
  for (const source of ["files/sub/none.txt", "files//a.txt", "files/./sub/a.txt", "../x", ""])
    expect(await readAfter(source).exit).toEqual(readInvalid("missing", source));
});

test.skipIf(process.getuid?.() === 0)(
  "read on an unreadable file or directory fails PermissionDenied read with the path",
  async () => {
    const locked = readAfter("files/sub/a.txt", (entry) =>
      chmodSync(join(entry, "files", "sub", "a.txt"), 0o000),
    );
    expect(await locked.exit).toEqual(
      Exit.fail(
        new PermissionDenied({
          details: { reason: "read", path: join(locked.entry, "files", "sub", "a.txt") },
        }),
      ),
    );
    const closed = readAfter("files/sub/a.txt", (entry) => chmodSync(join(entry, "files"), 0o000));
    try {
      expect(await closed.exit).toEqual(
        Exit.fail(
          new PermissionDenied({
            details: { reason: "read", path: join(closed.entry, "files", "sub") },
          }),
        ),
      );
    } finally {
      chmodSync(join(closed.entry, "files"), 0o755);
    }
  },
);

/** The registry that ships with the CLI. */
const catalogRoot = join(import.meta.dirname, "..", "registry");
const catalog = await Effect.runPromise(
  Effect.flatMap(Registry, (registry) => registry.all).pipe(
    Effect.provide(Registry.layer([{ origin: "bundled", path: catalogRoot }])),
    Effect.provide(NodeServices.layer),
  ),
);
const catalogEntries = catalog.filter((item): item is Entry => !isRejected(item));
const catalogStacks = catalogEntries.filter((entry) => entry.meta.kind === "stack");
/** Each app in the catalog with every catalog stack it applies to, by id or by a stack tag. */
const catalogApps = catalogEntries.flatMap((app) => {
  const meta = app.meta;
  if (meta.kind !== "fragment" || meta.category !== "app") return [];
  return catalogStacks
    .filter(
      (stack) =>
        meta.appliesTo.includes(stack.id) ||
        stack.meta.tags.some((tag: string) => meta.appliesTo.includes(tag)),
    )
    .map((stack) => ({ stack: stack.id, app: app.id }));
});
const PRESETS = ["default", "sandbox"] as const;
/** D7: the layers every stack's base composition verifies. */
const D7_LAYERS = ["install", "lint", "typecheck", "test"];

/** Output paths of the `.tmpl` files an entry ships, `files/` and `adapters/claude/` stripped. */
function templateOutputs(entry: Entry): string[] {
  return ["files", join("adapters", "claude")].flatMap((sub) => {
    const root = join(entry.dir, sub);
    if (!existsSync(root)) return [];
    return readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((item) => item.isFile() && item.name.endsWith(".tmpl"))
      .map((item) => relative(root, join(item.parentPath, item.name)).slice(0, -".tmpl".length));
  });
}

/**
 * `new <stack> app --json` from the bundled catalog into a fresh HOME whose PATH holds only a
 * `git` shim that records each call, so nothing else can run. The shim answers as git does
 * outside a repository and makes `.git` on `init`.
 */
async function newFromCatalog(stack: string, preset: (typeof PRESETS)[number], app?: string) {
  const home = temp();
  const log = join(home, "git-calls");
  const record = `echo "$1" >> ${JSON.stringify(log)}`;
  const bin = gitShim(
    home,
    [
      `  rev-parse) ${record}; echo "fatal: not a git repository (or any of the parent directories): .git" >&2; exit 128 ;;`,
      `  init) ${record}; /bin/mkdir .git ;;`,
      `  *) ${record}; exit 1 ;;`,
    ].join("\n"),
  );
  const result = await runCli(
    [
      "new",
      stack,
      "app",
      "--json",
      ...(preset === "sandbox" ? ["--sandbox"] : []),
      ...(app === undefined ? [] : ["--with", app]),
    ],
    { home, env: { ...quiet, PATH: bin }, host: { registry: catalogRoot, cwd: home } },
  );
  const project = join(home, "app");
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
  return { ...result, project, calls };
}

describe("every bundled stack scaffolds through new", () => {
  // Each matrix row renders and writes a shipped composition, fingerprints its files and runs
  // git through the shim; concurrent gates can push that work past the default 5 s budget.
  // 1.4 adds the agent handoff; once it lands these runs pass --no-launch.
  test.each(catalogStacks.flatMap((stack) => PRESETS.map((preset) => [stack.id, preset] as const)))(
    "new %s (%s) writes a project under the budget whose manifest covers D7 [1.6a#2]",
    async (id, preset) => {
      const { status, stdout, stderr, project, calls } = await newFromCatalog(id, preset);
      expect(stderr).toBe("");
      expect(status).toBe(0);
      const result = Schema.decodeUnknownSync(NewResult)(JSON.parse(stdout));
      expect(result.preset).toBe(preset);
      expect(result.briefWords).toBeLessThanOrEqual(BUDGET.composed);
      // Nothing but the shim's git ran, and only the commands `new` itself issues.
      expect(calls.every((call) => ["rev-parse", "init", "config"].includes(call))).toBe(true);
      const manifest = Schema.decodeUnknownSync(Manifest)(
        JSON.parse(readFileSync(join(project, MANIFEST_PATH), "utf8")),
      );
      const base = manifest.verify.filter(
        (step) => !(step.tags ?? []).includes(APP_TAG) && !step.skipByDefault,
      );
      for (const layer of D7_LAYERS) expect(base.map((step) => step.layer)).toContain(layer);
      const stack = catalogStacks.find((entry) => entry.id === id);
      if (stack?.meta.tags.some((tag: string) => tag === "web" || tag === "api"))
        expect(base.some((step) => step.phase === "serve" && step.expect)).toBe(true);
      // Every rendered template left no token behind.
      const entries = [id, ...result.fragments].map((name, index) =>
        catalogEntries.find(
          (entry) => entry.id === name && (index === 0) === (entry.meta.kind === "stack"),
        ),
      );
      const templates = new Set(entries.flatMap((entry) => (entry ? templateOutputs(entry) : [])));
      const rendered = result.written.filter((path) => templates.has(path));
      expect(rendered.length).toBeGreaterThan(0);
      for (const path of rendered)
        expect({ path, token: readFileSync(join(project, path), "utf8").includes("{{") }).toEqual({
          path,
          token: false,
        });
    },
    30_000,
  );

  test.each(
    catalogApps.flatMap(({ stack, app }) => PRESETS.map((preset) => [stack, app, preset] as const)),
  )(
    "new %s --with %s (%s) writes the app under its budget with every app step tagged app [1.6a#3]",
    async (stack, app, preset) => {
      const { status, stdout, stderr, project, calls } = await newFromCatalog(stack, preset, app);
      expect(stderr).toBe("");
      expect(status).toBe(0);
      const result = Schema.decodeUnknownSync(NewResult)(JSON.parse(stdout));
      expect(result.fragments).toContain(app);
      expect(result.briefWords).toBeLessThanOrEqual(BUDGET.composedWithApp);
      expect(calls.every((call) => ["rev-parse", "init", "config"].includes(call))).toBe(true);
      const manifest = Schema.decodeUnknownSync(Manifest)(
        JSON.parse(readFileSync(join(project, MANIFEST_PATH), "utf8")),
      );
      const own = manifest.verify.filter((step) => step.owner === app);
      expect(own.length).toBeGreaterThan(0);
      for (const step of own) expect(step.tags ?? []).toContain(APP_TAG);
      const base = manifest.verify.filter((step) => step.owner !== app);
      for (const step of base) expect(step.tags ?? []).not.toContain(APP_TAG);
      const entry = catalogEntries.find((item) => item.id === app);
      for (const path of entry ? templateOutputs(entry) : [])
        expect(readFileSync(join(project, path), "utf8")).not.toContain("{{");
    },
    30_000,
  );

  test("the catalog has apps to test", () => {
    expect(catalogApps.length).toBeGreaterThan(0);
  });
});

// An entry may ship a literal `files/.gitignore`, and this repo's own git reads it: a pattern in it
// would leave the entry's other fixture files out of every commit without a word.
const vcs = spawnGit(["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname });
test.skipIf(vcs.status !== 0)(
  "git ignores no file in the fixture or bundled registries [1.6a#4]",
  () => {
    const roots = [smallRegistry, realRegistry, brokenRegistry, composeRegistry, catalogRoot];
    const files = roots.flatMap((root) =>
      readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name)),
    );
    // The guard covers the whole catalog: every entry's own file is among those checked.
    expect(catalog.length).toBeGreaterThan(20);
    for (const item of catalog)
      expect(files).toContain(
        join(
          catalogRoot,
          `${item.kind}s`,
          item.id,
          item.kind === "stack" ? "STACK.md" : "FRAGMENT.md",
        ),
      );
    // --no-index: tracked files are checked against the ignore rules too. Exit 1: none ignored.
    const checked = spawnGit(["check-ignore", "--no-index", "--stdin"], {
      cwd: import.meta.dirname,
      input: files.join("\n"),
      encoding: "utf8",
    });
    expect({ status: checked.status, ignored: checked.stdout }).toEqual({ status: 1, ignored: "" });
  },
);
