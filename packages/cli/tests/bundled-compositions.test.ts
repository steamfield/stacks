import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterAll, beforeEach, expect, test } from "vitest";
import { ComposeConflictDetails } from "../src/errors";
import type { runCli } from "./helpers/cli";
import { compositionWorkspace, snapshot } from "./helpers/composition-workspace";
import { spawnGit } from "./helpers/git";
import { adapterRegistry } from "./helpers/native-adapters";
import { minimal, writeEntry } from "./helpers/registry";

const { home, cli, scaffold, success, withGit, gitCallsOnly, reset, cleanup } =
  compositionWorkspace(adapterRegistry, []);
afterAll(cleanup);
beforeEach(reset);

const ConflictEnvelope = Schema.Struct({
  error: Schema.Struct({
    tag: Schema.Literal("ComposeConflict"),
    message: Schema.String,
    retryable: Schema.Literal(false),
    details: ComposeConflictDetails,
  }),
});
function conflict(run: Awaited<ReturnType<typeof runCli>>, reason: string, ids: string[]) {
  expect(run.status).toBe(2);
  expect(run.stdout).toBe("");
  const error = Schema.decodeUnknownSync(ConflictEnvelope)(JSON.parse(run.stderr)).error;
  expect(error.details.reason).toBe(reason);
  expect(error.details.ids.toSorted()).toEqual(ids.toSorted());
}

test("conflicting releases fail in either selection order before creating a project [3.3a#3]", async () => {
  const registry = join(home, "conflicts");
  writeEntry({
    root: registry,
    kind: "stack",
    dir: "fixture",
    frontmatter: minimal("stack", "fixture", "tags: [fixture]"),
  });
  for (const id of ["release-one", "release-two"])
    writeEntry({
      root: registry,
      kind: "fragment",
      dir: id,
      frontmatter: minimal(
        "fragment",
        id,
        `applies_to: [fixture]\nconflicts: [${id === "release-one" ? "release-two" : "release-one"}]`,
      ).replace("category: tooling", "category: release"),
    });
  for (const ids of [
    ["release-one", "release-two"],
    ["release-two", "release-one"],
  ]) {
    const project = join(home, "refused-release");
    conflict(
      await cli(
        ["new", "fixture", project, "--with", ids.join(","), "--no-launch", "--json"],
        registry,
      ),
      "conflicts",
      ids,
    );
    expect(existsSync(project)).toBe(false);
  }
});

test("a service template renders its bytes inside a project path with spaces and Unicode [3.3c#3]", async () => {
  const registry = join(home, "service-template-registry");
  writeEntry({
    root: registry,
    kind: "stack",
    dir: "fixture",
    frontmatter: minimal("stack", "fixture"),
  });
  const service = writeEntry({
    root: registry,
    kind: "fragment",
    dir: "database",
    frontmatter: minimal("fragment", "database").replace("category: tooling", "category: service"),
  });
  mkdirSync(join(service, "files/services"), { recursive: true });
  writeFileSync(
    join(service, "files/services/database.md.tmpl"),
    "name={{project_name}}\nslug={{project_slug}}\n",
  );
  const result = await scaffold("fixture", "service workspace ü", ["--with", "database"], registry);
  expect(result.fragments).toEqual(["database"]);
  expect(result.written).toContain("services/database.md");
  const output = join(result.project, "services/database.md");
  expect(readFileSync(output, "utf8")).toBe("name=matrix\nslug=matrix\n");
  expect(realpathSync(output)).toBe(join(realpathSync(result.project), "services/database.md"));
  expect(existsSync(join(home, "services/database.md"))).toBe(false);
  gitCallsOnly();
});

test("a service file collision fails before writing a partial scaffold [3.3c#4]", async () => {
  const registry = join(home, "collision");
  const stack = writeEntry({
    root: registry,
    kind: "stack",
    dir: "fixture",
    frontmatter: minimal("stack", "fixture"),
  });
  const service = writeEntry({
    root: registry,
    kind: "fragment",
    dir: "database",
    frontmatter: minimal("fragment", "database").replace("category: tooling", "category: service"),
  });
  for (const [entry, text] of [
    [stack, "stack bytes"],
    [service, "service bytes"],
  ]) {
    if (!entry || !text) throw new Error("invalid collision fixture");
    mkdirSync(join(entry, "files"));
    writeFileSync(join(entry, "files/README.md"), text);
  }
  const project = join(home, "refused-service");
  conflict(
    await cli(["new", "fixture", project, "--with", "database", "--no-launch", "--json"], registry),
    "file_owner",
    ["database"],
  );
  expect(existsSync(project)).toBe(false);
});

test("a symlinked cwd under an agent ignores inherited repository variables [3.3b#5]", async () => {
  const foreign = join(home, "foreign");
  mkdirSync(foreign);
  expect(spawnGit(["init", "--quiet", foreign]).status).toBe(0);
  const before = snapshot(foreign);
  const actual = join(home, "actual workspace");
  const alias = join(home, "linked workspace");
  mkdirSync(actual);
  symlinkSync(actual, alias, "dir");
  const result = success(
    await withGit(() =>
      cli(
        ["new", "go-cli", "project", "--no-launch", "--json", "--author", ""],
        adapterRegistry,
        alias,
        {
          AI_AGENT: "codex",
          GIT_DIR: join(foreign, ".git"),
          GIT_WORK_TREE: foreign,
          GIT_INDEX_FILE: join(foreign, "index"),
        },
      ),
    ),
  );
  expect(result.handoff.kind).toBe("inside-agent");
  expect(realpathSync(result.project)).toBe(join(realpathSync(actual), "project"));
  expect(existsSync(join(result.project, ".git"))).toBe(true);
  expect(snapshot(foreign)).toEqual(before);
  gitCallsOnly();
});
