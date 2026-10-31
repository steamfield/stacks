import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, FileSystem, PlatformError, Schema } from "effect";
import { Command } from "effect/cli";
import { afterEach, expect, test } from "vitest";
import { cli } from "../src/cli";
import { skeleton } from "../src/core/create-text";
import { assemble } from "../src/core/submit/assemble";
import type { SubmittedEntry } from "../src/core/submit/entries";
import { ErrorEnvelope } from "../src/errors";
import { VERSION } from "../src/version";
import { runCli, tempDir } from "./helpers/cli";
import { fakeGitHub } from "./helpers/submit";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function directory() {
  const temp = tempDir();
  cleanups.push(temp.cleanup);
  return realpathSync(temp.path);
}

function source(root: string): SubmittedEntry {
  const dir = join(root, "stacks", "demo-app");
  mkdirSync(join(dir, "files"), { recursive: true });
  writeFileSync(
    join(dir, "STACK.md"),
    skeleton("stack", "demo-app", "ci").replace(
      /"stacks:fill: describe the \w+"/,
      '"The demo-app entry."',
    ),
  );
  writeFileSync(join(dir, "files", "README.md"), "<!-- stacks:fill: describe the project -->\n");
  return { kind: "stack", id: "demo-app", root, dir };
}

function validCard(entry: SubmittedEntry) {
  const card = join(entry.root, "search", "stacks", `${entry.id}.json`);
  mkdirSync(dirname(card), { recursive: true });
  const fixture = readFileSync(
    join(import.meta.dirname, "fixtures/registry/search/stacks/bun-web.json"),
    "utf8",
  );
  writeFileSync(
    card,
    fixture
      .replace('"id": "bun-web"', '"id": "demo-app"')
      .replace(
        /"source": \{[^}]+\}/,
        `"source": { "digest": "sha256:${"0".repeat(64)}", "by": "author", "reviewedAt": null }`,
      ),
  );
  return card;
}

function failure(exit: Exit.Exit<unknown, unknown>) {
  return Exit.isFailure(exit) ? exit.cause.reasons.find(Cause.isFailReason)?.error : undefined;
}

function envelope(stderr: string) {
  const lines = stderr.trim().split("\n");
  expect(lines).toHaveLength(1);
  const raw = JSON.parse(lines[0] ?? "") as unknown;
  Schema.decodeUnknownSync(ErrorEnvelope)(raw);
  return Schema.decodeUnknownSync(
    Schema.Struct({
      error: Schema.Struct({
        tag: Schema.String,
        details: Schema.optionalKey(Schema.Unknown),
      }),
    }),
  )(raw).error;
}

function assembly(registry: string, entry: SubmittedEntry) {
  return Effect.runPromiseExit(
    assemble({ registry, entries: [entry], login: "octo-author" }).pipe(
      Effect.provide(NodeServices.layer),
    ),
  );
}

function commandWithWrite(
  args: string[],
  write: (
    fs: FileSystem.FileSystem,
    path: string,
    text: string,
  ) => ReturnType<FileSystem.FileSystem["writeFileString"]>,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const gated: FileSystem.FileSystem = {
      ...fs,
      writeFileString: (path, text) => write(fs, path, text),
    };
    yield* Command.runWith(cli, { version: VERSION, renderErrors: false })(args).pipe(
      Effect.provideService(FileSystem.FileSystem, gated),
    );
  });
}

test.skipIf(process.getuid?.() === 0)(
  "an unwritable TMPDIR reports a write denial before gh or git runs",
  async () => {
    const github = fakeGitHub();
    cleanups.push(github.cleanup);
    const home = directory();
    source(join(home, "config", "stacks"));
    const blocked = join(home, "blocked-tmp");
    mkdirSync(blocked);
    const previous = process.env.TMPDIR;
    let run: Awaited<ReturnType<typeof runCli>>;
    chmodSync(blocked, 0o555);
    try {
      process.env.TMPDIR = blocked;
      run = await runCli(["submit", "demo-app", "--json"], {
        home,
        env: { ...github.env, TMPDIR: blocked },
      });
    } finally {
      if (previous === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previous;
      chmodSync(blocked, 0o755);
    }
    expect(github.calls()).toEqual([]);
    expect(run.status).toBe(6);
    expect(run.stdout).toBe("");
    const error = envelope(run.stderr);
    expect(error.tag).toBe("PermissionDenied");
    expect(error.details).toMatchObject({ reason: "write" });
    const path = Schema.decodeUnknownSync(
      Schema.Struct({ reason: Schema.String, path: Schema.String }),
    )(error.details).path;
    expect(path === blocked || path.startsWith(`${blocked}/stacks-submit-`)).toBe(true);
  },
);

test.skipIf(process.getuid?.() === 0)(
  "an unwritable authors file reports its destination path as a write denial",
  async () => {
    const root = directory();
    const registry = join(root, "assembly");
    mkdirSync(registry);
    const authors = join(registry, "authors.json");
    writeFileSync(authors, "{}\n");
    chmodSync(authors, 0o444);
    let exit: Awaited<ReturnType<typeof assembly>>;
    try {
      exit = await assembly(registry, source(join(root, "source")));
    } finally {
      chmodSync(authors, 0o644);
    }
    expect(Exit.isFailure(exit)).toBe(true);
    expect(failure(exit)).toMatchObject({
      _tag: "PermissionDenied",
      details: { reason: "write", path: authors },
    });
  },
);

test.skipIf(process.getuid?.() === 0)(
  "an unwritable entry parent reports the directory it could not create",
  async () => {
    const root = directory();
    const registry = join(root, "assembly");
    mkdirSync(registry);
    const entry = source(join(root, "source"));
    chmodSync(registry, 0o555);
    let exit: Awaited<ReturnType<typeof assembly>>;
    try {
      exit = await assembly(registry, entry);
    } finally {
      chmodSync(registry, 0o755);
    }
    expect(Exit.isFailure(exit)).toBe(true);
    expect(failure(exit)).toMatchObject({
      _tag: "PermissionDenied",
      details: { reason: "write", path: join(registry, "stacks") },
    });
  },
);

test.skipIf(process.getuid?.() === 0)(
  "an unwritable card reports its destination path as a write denial",
  async () => {
    const root = directory();
    const registry = join(root, "assembly");
    const entry = source(join(root, "source"));
    const relative = "search/stacks/demo-app.json";
    const ownCard = join(entry.root, relative);
    mkdirSync(dirname(ownCard), { recursive: true });
    writeFileSync(ownCard, "invalid card\n");
    const target = join(registry, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "existing card\n");
    chmodSync(target, 0o444);
    let exit: Awaited<ReturnType<typeof assembly>>;
    try {
      exit = await assembly(registry, entry);
    } finally {
      chmodSync(target, 0o644);
    }
    expect(Exit.isFailure(exit)).toBe(true);
    expect(failure(exit)).toMatchObject({
      _tag: "PermissionDenied",
      details: { reason: "write", path: target },
    });
  },
);

test.skipIf(process.getuid?.() === 0)(
  "an unwritable valid card reports its destination path as a write denial",
  async () => {
    const root = directory();
    const registry = join(root, "assembly");
    const entry = source(join(root, "source"));
    validCard(entry);
    const target = join(registry, "search", "stacks", "demo-app.json");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "existing card\n");
    chmodSync(target, 0o444);
    let exit: Awaited<ReturnType<typeof assembly>>;
    try {
      exit = await assembly(registry, entry);
    } finally {
      chmodSync(target, 0o644);
    }
    expect(Exit.isFailure(exit)).toBe(true);
    expect(failure(exit)).toMatchObject({
      _tag: "PermissionDenied",
      details: { reason: "write", path: target },
    });
  },
);

test("a valid author card fixture reaches the restamped card write", async () => {
  const root = directory();
  const registry = join(root, "assembly");
  mkdirSync(registry);
  const entry = source(join(root, "source"));
  validCard(entry);
  const exit = await assembly(registry, entry);
  expect(Exit.isSuccess(exit)).toBe(true);
  const card = JSON.parse(
    readFileSync(join(registry, "search/stacks/demo-app.json"), "utf8"),
  ) as unknown;
  expect(card).toMatchObject({
    id: "demo-app",
    source: {
      by: "author",
      reviewedAt: null,
      digest: expect.stringMatching(/^sha256:(?!0{64}$)[0-9a-f]{64}$/),
    },
  });
});

test.skipIf(process.getuid?.() === 0)(
  "an unwritable card parent reports the directory it could not create",
  async () => {
    const root = directory();
    const registry = join(root, "assembly");
    const entry = source(join(root, "source"));
    validCard(entry);
    const search = join(registry, "search");
    mkdirSync(search, { recursive: true });
    chmodSync(search, 0o555);
    let exit: Awaited<ReturnType<typeof assembly>>;
    try {
      exit = await assembly(registry, entry);
    } finally {
      chmodSync(search, 0o755);
    }
    expect(Exit.isFailure(exit)).toBe(true);
    expect(failure(exit)).toMatchObject({
      _tag: "PermissionDenied",
      details: { reason: "write", path: join(search, "stacks") },
    });
  },
);

test.skipIf(process.getuid?.() === 0)(
  "a destination copy failure reports the destination rather than the source",
  async () => {
    const root = directory();
    const registry = join(root, "assembly");
    const targetParent = join(registry, "stacks");
    mkdirSync(targetParent, { recursive: true });
    const entry = source(join(root, "source"));
    chmodSync(targetParent, 0o555);
    let exit: Awaited<ReturnType<typeof assembly>>;
    try {
      exit = await assembly(registry, entry);
    } finally {
      chmodSync(targetParent, 0o755);
    }
    expect(Exit.isFailure(exit)).toBe(true);
    expect(failure(exit)).toMatchObject({
      _tag: "PermissionDenied",
      details: { reason: "write", path: join(targetParent, entry.id) },
    });
  },
);

test.skipIf(process.getuid?.() === 0)(
  "an existing entry that cannot be removed reports its destination path",
  async () => {
    const root = directory();
    const registry = join(root, "assembly");
    const target = join(registry, "stacks", "demo-app");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "old.txt"), "old\n");
    writeFileSync(join(registry, "authors.json"), '{ "stack/demo-app": "octo-author" }\n');
    const entry = source(join(root, "source"));
    chmodSync(dirname(target), 0o555);
    let exit: Awaited<ReturnType<typeof assembly>>;
    try {
      exit = await assembly(registry, entry);
    } finally {
      chmodSync(dirname(target), 0o755);
    }
    expect(Exit.isFailure(exit)).toBe(true);
    expect(failure(exit)).toMatchObject({
      _tag: "PermissionDenied",
      details: { reason: "write", path: target },
    });
  },
);

test("still: a missing source entry directory reports a read denial", async () => {
  const root = directory();
  const registry = join(root, "assembly");
  mkdirSync(registry);
  const entry: SubmittedEntry = {
    kind: "stack",
    id: "demo-app",
    root: join(root, "source"),
    dir: join(root, "source", "stacks", "demo-app"),
  };
  const exit = await assembly(registry, entry);
  expect(Exit.isFailure(exit)).toBe(true);
  expect(failure(exit)).toMatchObject({
    _tag: "PermissionDenied",
    details: { reason: "read", path: entry.dir },
  });
});

test.skipIf(process.getuid?.() === 0)(
  "still: an unreadable source entry directory reports a read denial",
  async () => {
    const root = directory();
    const registry = join(root, "assembly");
    mkdirSync(registry);
    const entry = source(join(root, "source"));
    chmodSync(entry.dir, 0o000);
    let exit: Awaited<ReturnType<typeof assembly>>;
    try {
      exit = await assembly(registry, entry);
    } finally {
      chmodSync(entry.dir, 0o755);
    }
    expect(Exit.isFailure(exit)).toBe(true);
    expect(failure(exit)).toMatchObject({
      _tag: "PermissionDenied",
      details: { reason: "read", path: entry.dir },
    });
  },
);

test.skipIf(process.getuid?.() === 0)(
  "an unwritable pull request body reports its path and publishes nothing",
  async () => {
    const github = fakeGitHub();
    cleanups.push(github.cleanup);
    const home = directory();
    source(join(home, "config", "stacks"));
    const args = ["submit", "demo-app", "--json"];
    let reachedBody = false;
    const run = await runCli(args, {
      home,
      env: github.env,
      program: commandWithWrite(args, (fs, path, text) => {
        if (!path.endsWith("/body.md")) return fs.writeFileString(path, text);
        reachedBody = true;
        const parent = dirname(path);
        return Effect.sync(() => chmodSync(parent, 0o555)).pipe(
          Effect.andThen(fs.writeFileString(path, text)),
          Effect.ensuring(Effect.sync(() => chmodSync(parent, 0o755))),
        );
      }),
    });
    expect(reachedBody).toBe(true);
    expect(run.status).toBe(6);
    expect(run.stdout).toBe("");
    expect(envelope(run.stderr)).toMatchObject({
      tag: "PermissionDenied",
      details: { reason: "write", path: expect.stringMatching(/\/stacks-submit-[^/]+\/body\.md$/) },
    });
    expect(
      github.calls().some((call) => call[0] === "gh" && call[1] === "repo" && call[2] === "fork"),
    ).toBe(false);
    expect(github.calls().some((call) => call[0] === "gh" && call[1] === "pr")).toBe(false);
    expect(github.calls().some((call) => call.includes("push"))).toBe(false);
  },
);

test("a FileSystem TypeError during a write remains a defect with exit 1", async () => {
  const github = fakeGitHub();
  cleanups.push(github.cleanup);
  const home = directory();
  source(join(home, "config", "stacks"));
  const args = ["submit", "demo-app", "--json"];
  let injected = false;
  const run = await runCli(args, {
    home,
    env: github.env,
    program: commandWithWrite(args, (fs, path, text) => {
      if (!path.endsWith("/authors.json")) return fs.writeFileString(path, text);
      injected = true;
      return Effect.die(new TypeError("private write defect"));
    }),
  });
  expect(injected).toBe(true);
  expect(run.status).toBe(1);
  expect(run.stdout).toBe("");
  expect(envelope(run.stderr).tag).toBe("Defect");
  expect(run.stderr).not.toContain("private write defect");
  expect(github.calls().some((call) => call[0] === "gh" && call[1] === "pr")).toBe(false);
  expect(github.calls().some((call) => call.includes("push"))).toBe(false);
});

test("an ENOSPC PlatformError during a write remains a defect with exit 1", async () => {
  const github = fakeGitHub();
  cleanups.push(github.cleanup);
  const home = directory();
  source(join(home, "config", "stacks"));
  const args = ["submit", "demo-app", "--json"];
  let injected = false;
  const run = await runCli(args, {
    home,
    env: github.env,
    program: commandWithWrite(args, (fs, path, text) => {
      if (!path.endsWith("/authors.json")) return fs.writeFileString(path, text);
      injected = true;
      return Effect.fail(
        PlatformError.systemError({
          _tag: "Unknown",
          module: "FileSystem",
          method: "writeFileString",
          pathOrDescriptor: path,
          cause: Object.assign(new Error("disk full"), { code: "ENOSPC" }),
        }),
      );
    }),
  });
  expect(injected).toBe(true);
  expect(run.status).toBe(1);
  expect(run.stdout).toBe("");
  expect(envelope(run.stderr).tag).toBe("Defect");
  expect(run.stderr).not.toContain("disk full");
  expect(github.calls().some((call) => call[0] === "gh" && call[1] === "pr")).toBe(false);
  expect(github.calls().some((call) => call.includes("push"))).toBe(false);
});
