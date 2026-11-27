import { chmodSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Exit } from "effect";
import { afterEach, expect, test } from "vitest";
import { isRejected } from "../src/core/registry/entry";
import { Registry } from "../src/core/registry/registry";
import type { RegistryRoots } from "../src/core/registry/roots";
import { EntryInvalid, NotFound, PermissionDenied } from "../src/errors";
import { tempDir } from "./helpers/cli";
import { minimal, smallRegistry, writeEntry } from "./helpers/registry";

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

test.each([
  ["project", false, false],
  ["user", false, true],
  ["bundled", false, true],
  ["bundled", true, false],
] as const)(
  "%s root (overridden=%s) assigns trust %s to its entries",
  async (origin, overridden, trusted) => {
    const exit = await run(
      [{ origin, path: smallRegistry, overridden }],
      Registry.pipe(
        Effect.flatMap((registry) => registry.get("stack", "go-api")),
        Effect.map((entry) => entry.trusted),
      ),
    );
    expect(exit).toEqual(Exit.succeed(trusted));
  },
);

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
