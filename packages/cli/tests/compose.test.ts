import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import {
  type Composition,
  compose,
  type CompositionEntryRef as EntryRef,
  missingTools,
} from "../src/core/compose/compose";
import { Registry } from "../src/core/registry/registry";
import { BadInput, ComposeConflict, EntryInvalid, NotFound } from "../src/errors";
import { quiet, runCli, tempDir, terminal } from "./helpers/cli";
import { bundledAt, composeExit } from "./helpers/compose";
import { composeRegistry, copyEntry, minimal, writeEntry } from "./helpers/registry";

const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});
function temp() {
  const dir = tempDir();
  dirs.push(dir);
  return dir.path;
}

async function composed(...args: Parameters<typeof composeExit>): Promise<Composition> {
  const exit = await composeExit(...args);
  if (Exit.isFailure(exit)) throw new Error(`compose failed: ${JSON.stringify(exit.cause)}`);
  return exit.value;
}
const ids = (composition: Composition) => composition.fragments.map((fragment) => fragment.id);
const S = (id: string) => ({ kind: "stack" as const, id });
const F = (id: string) => ({ kind: "fragment" as const, id });
const sameRef = (a: EntryRef, b: EntryRef) => a.kind === b.kind && a.id === b.id;
const conflict = (details: ComposeConflict["details"]) =>
  Exit.fail(new ComposeConflict({ details }));

test("the default composition holds required, default and always fragments, requirements first, ties by id, the app last [1.1#1]", async () => {
  const composition = await composed({}, { config: { always: ["changelog"] } });
  expect(ids(composition)).toEqual([
    "ci",
    "docker-deploy",
    "format",
    "lint",
    "release-notes",
    "changelog",
    "todo-app",
  ]);
  expect(composition.stack.id).toBe("web-stack");
  expect(composition.app?.id).toBe("todo-app");
  expect(composition.warnings).toEqual([]);
  expect(composition.untrusted).toEqual([]);
});

test("--without a required fragment, or one it requires, is a required conflict [1.1#2]", async () => {
  expect(await composeExit({ without: ["lint"] })).toEqual(
    conflict({ reason: "required", stack: "web-stack", ids: ["lint"] }),
  );
  expect(await composeExit({ without: ["format"] })).toEqual(
    conflict({ reason: "required", ids: ["lint", "format"] }),
  );
});

test("--with a fragment that requires another pulls both in, the requirement first [1.1#3]", async () => {
  const composition = await composed({ with: ["changelog"] });
  const order = ids(composition);
  expect(order).toContain("release-notes");
  expect(order.indexOf("release-notes")).toBeLessThan(order.indexOf("changelog"));
});

test("conflicts are found whichever side declares them, with both ids [1.1#4]", async () => {
  // rival declares the conflict with lint; ci declares it with old-ci.
  expect(await composeExit({ with: ["rival"] })).toEqual(
    conflict({ reason: "conflicts", ids: ["lint", "rival"] }),
  );
  expect(await composeExit({ with: ["old-ci"] })).toEqual(
    conflict({ reason: "conflicts", ids: ["ci", "old-ci"] }),
  );
});

test("a requires cycle fails with the cycle's ids in order [1.1#5]", async () => {
  expect(await composeExit({ with: ["cycle-b"] })).toEqual(
    conflict({ reason: "cycle", ids: ["cycle-a", "cycle-b"] }),
  );
});

test("the same id in --with and --without is BadInput naming it [1.1#6]", async () => {
  expect(await composeExit({ with: ["hooks-a", "ci"], without: ["ci"] })).toEqual(
    Exit.fail(new BadInput({ details: { id: "ci", flag: "with_without" } })),
  );
});

test("fit: an always fragment that doesn't apply is skipped with a warning, --with keeps it, a default that doesn't fit fails [1.1#7]", async () => {
  const always = await composed({}, { config: { always: ["go-only", "no-such-fragment"] } });
  expect(ids(always)).not.toContain("go-only");
  expect(always.warnings).toEqual([
    { code: "always_not_applicable", id: "go-only" },
    { code: "always_unknown", id: "no-such-fragment" },
  ]);
  const named = await composed({ with: ["go-only"] });
  expect(ids(named)).toContain("go-only");
  expect(named.warnings).toEqual([{ code: "with_not_applicable", id: "go-only" }]);
  expect(await composeExit({ stack: "misfit-stack" })).toEqual(
    conflict({ reason: "applies_to", ids: ["go-only"] }),
  );
});

test("two entries with different defaults for one env key conflict; the same value composes [1.1#8]", async () => {
  expect(await composeExit({ with: ["port-clash"] })).toEqual(
    conflict({ reason: "env", stack: "web-stack", ids: ["port-clash"], key: "PORT_WEB" }),
  );
  const same = await composed({ with: ["port-same"] });
  expect(same.env).toEqual({ PORT_WEB: "5173", PORT_TODO: "5180" });
});

test("--sandbox drops default deploy and app fragments, keeps them when named, keeps a required release fragment, and skips prod steps [1.1#9]", async () => {
  const sandbox = await composed({ preset: "sandbox" }, { config: { always: ["changelog"] } });
  expect(ids(sandbox)).toEqual(["ci", "format", "lint", "release-notes", "changelog"]);
  expect(sandbox.app).toBeNull();
  expect(sandbox.verify.find((step) => step.name === "deploy-dry-run")).toMatchObject({
    tags: ["prod"],
    skipByDefault: true,
  });
  const named = await composed({ preset: "sandbox", with: ["docker-deploy", "todo-app"] });
  expect(ids(named)).toEqual(["ci", "docker-deploy", "format", "lint", "todo-app"]);
  const plain = await composed({});
  expect(plain.verify.every((step) => !step.skipByDefault)).toBe(true);
});

test("two writers that both list a JSON file in merge produce one merged file, arrays deduplicated [1.1#10]", async () => {
  const composition = await composed({ with: ["hooks-a"] });
  const settings = composition.files.filter((file) => file.path === ".claude/settings.json");
  expect(settings).toHaveLength(1);
  expect(settings[0]).toMatchObject({ kind: "merge", owner: S("web-stack") });
  expect(JSON.parse(settings[0]?.content ?? "")).toEqual({
    hooks: {
      PreToolUse: [
        { matcher: "Bash", command: "guard" },
        { matcher: "Write", command: "format" },
      ],
      Stop: [{ command: "check" }],
    },
    permissions: { allow: ["Bash(bun test)", "Bash(bun run lint)"] },
  });
});

test("a second writer without merge is a file_owner conflict; a template on a merge path is merge_template [1.1#11]", async () => {
  expect(await composeExit({ with: ["hooks-plain"] })).toEqual(
    conflict({
      reason: "file_owner",
      stack: "web-stack",
      ids: ["hooks-plain"],
      path: ".claude/settings.json",
    }),
  );
  expect(await composeExit({ with: ["hooks-tmpl"] })).toEqual(
    Exit.fail(
      new EntryInvalid({
        details: {
          id: "hooks-tmpl",
          origin: "bundled",
          reason: "merge_template",
          path: "adapters/claude/.claude/settings.json.tmpl",
        },
      }),
    ),
  );
});

test("a merged file that isn't JSON is EntryInvalid merge_json naming the file", async () => {
  const user = temp();
  const dir = writeEntry({
    root: user,
    kind: "fragment",
    dir: "bad-json",
    frontmatter: minimal("fragment", "bad-json", "merge: [.claude/settings.json]"),
  });
  mkdirSync(join(dir, "adapters", "claude", ".claude"), { recursive: true });
  writeFileSync(join(dir, "adapters", "claude", ".claude", "settings.json"), "{ not json");
  const roots = [{ origin: "user", path: user } as const, ...bundledAt(composeRegistry)];
  expect(await composeExit({ with: ["bad-json"] }, { roots })).toEqual(
    Exit.fail(
      new EntryInvalid({
        details: {
          id: "bad-json",
          origin: "user",
          reason: "merge_json",
          path: "adapters/claude/.claude/settings.json",
        },
      }),
    ),
  );
});

test("literal dotfiles keep their name and .tmpl files are planned as templates without the suffix [1.1#12]", async () => {
  const composition = await composed({});
  expect(composition.files.find((file) => file.path === ".gitignore")).toMatchObject({
    kind: "copy",
    owner: S("web-stack"),
    source: { entry: S("web-stack"), file: "files/.gitignore" },
  });
  expect(composition.files.find((file) => file.path === "README.md")).toMatchObject({
    kind: "template",
    source: { entry: S("web-stack"), file: "files/README.md.tmpl" },
  });
  expect(composition.files.map((file) => file.path)).not.toContain("README.md.tmpl");
});

test("apps: one is composed last with every step tagged app; two, a required one, or a required-by-fragment one fail [1.1#12a]", async () => {
  const composition = await composed({});
  expect(composition.app?.id).toBe("todo-app");
  expect(ids(composition).at(-1)).toBe("todo-app");
  const appSteps = composition.verify.filter((step) => sameRef(step.owner, F("todo-app")));
  expect(appSteps.map((step) => step.name)).toEqual(["todo-e2e"]);
  expect(appSteps.every((step) => step.tags.includes("app"))).toBe(true);
  expect(composition.verify.filter((step) => step.tags.includes("app"))).toEqual(appSteps);
  expect(await composeExit({ with: ["notes-app"] })).toEqual(
    conflict({ reason: "app_count", ids: ["notes-app", "todo-app"] }),
  );
  expect(await composeExit({ stack: "app-stack" })).toEqual(
    conflict({ reason: "app_required", stack: "app-stack", ids: ["todo-app"] }),
  );
  expect(await composeExit({ with: ["needs-app"] })).toEqual(
    conflict({ reason: "app_required", ids: ["needs-app", "todo-app"] }),
  );
  expect(await composeExit({ with: ["changelog"], without: ["release-notes"] })).toEqual(
    conflict({ reason: "requires", ids: ["changelog", "release-notes"] }),
  );
});

test("requiring an app fails even when the app was already selected before its requirer", async () => {
  // zz-needs-app sorts after todo-app, so the default app is composed before the edge is seen.
  const user = temp();
  writeEntry({
    root: user,
    kind: "fragment",
    dir: "zz-needs-app",
    frontmatter: minimal("fragment", "zz-needs-app", "requires: [todo-app]"),
  });
  const roots = [{ origin: "user", path: user } as const, ...bundledAt(composeRegistry)];
  expect(await composeExit({ with: ["zz-needs-app"] }, { roots })).toEqual(
    conflict({ reason: "app_required", ids: ["zz-needs-app", "todo-app"] }),
  );
});

test("verify step names are unique across the composition", async () => {
  expect(await composeExit({ with: ["step-clash"] })).toEqual(
    conflict({ reason: "step_name", stack: "web-stack", ids: ["step-clash"], step: "test" }),
  );
});

test("decisions keep the stack's as written, then each fragment's prefixed with its id [1.1#12b]", async () => {
  const composition = await composed({});
  expect(composition.decisions).toEqual([
    { owner: S("web-stack"), text: "Package manager (default: bun)." },
    { owner: F("format"), text: "format: Line width (default: 100)." },
    { owner: F("todo-app"), text: "todo-app: Storage (default: SQLite)." },
  ]);
});

test("commands merge in composition order and deps merge by role without duplicates", async () => {
  const composition = await composed({});
  expect(composition.commands).toEqual({
    install: "Install dependencies",
    test: "Run the unit tests",
    dev: "Run the dev server",
    lint: "Lint the project",
    e2e: "Run the browser tests",
  });
  expect(composition.deps).toEqual([
    { role: "test", names: ["vitest", "playwright"], owners: [S("web-stack"), F("lint")] },
  ]);
  expect(composition.tools).toEqual([
    { tool: "bun", owners: [S("web-stack")] },
    { tool: "actionlint", owners: [F("ci")] },
    { tool: "docker", owners: [F("docker-deploy")] },
  ]);
});

test("a missing tool names the --without that drops its fragment, but none for one the stack needs [1.1#21]", async () => {
  const composition = await composed({});
  expect(missingTools(composition, (tool) => tool === "docker")).toEqual([
    { tool: "bun", owners: [S("web-stack")], drop: [] },
    { tool: "actionlint", owners: [F("ci")], drop: [{ id: "ci", flag: "without" }] },
  ]);
});

/** A user registry: `tool-stack` with default `needs`, which requires `dep`, which needs `deptool`. */
function toolRegistry(extraDefaults: string[] = [], required: string[] = []) {
  const user = temp();
  const defaults = ["needs", ...extraDefaults].join(", ");
  writeEntry({
    root: user,
    kind: "stack",
    dir: "tool-stack",
    frontmatter: minimal(
      "stack",
      "tool-stack",
      `fragments:\n  required: [${required.join(", ")}]\n  default: [${defaults}]\n  optional: [tool-app]`,
    ),
  });
  writeEntry({
    root: user,
    kind: "fragment",
    dir: "needs",
    frontmatter: minimal("fragment", "needs", "requires: [dep]"),
  });
  writeEntry({
    root: user,
    kind: "fragment",
    dir: "dep",
    frontmatter: minimal("fragment", "dep", "requires_tools: [deptool]"),
  });
  writeEntry({
    root: user,
    kind: "fragment",
    dir: "pinned",
    frontmatter: minimal("fragment", "pinned", "requires: [dep]"),
  });
  writeEntry({
    root: user,
    kind: "fragment",
    dir: "tool-app",
    frontmatter: [
      "schema_version: 1",
      "id: tool-app",
      "kind: fragment",
      "category: app",
      "name: Tool app",
      "description: An app that needs apptool.",
      "applies_to: [tool-stack]",
      "requires_tools: [apptool]",
    ].join("\n"),
  });
  return [{ origin: "user", path: user } as const];
}
const missingHints = async (
  options: Parameters<typeof composeExit>[0],
  roots: ReturnType<typeof toolRegistry>,
) =>
  missingTools(await composed({ stack: "tool-stack", ...options }, { roots }), () => false).map(
    ({ tool, drop }) => ({ tool, drop }),
  );

test("a missing tool's hint names only flags that would actually drop it", async () => {
  // dep arrives only through needs, so --without dep would fail: the hint is needs.
  expect(await missingHints({}, toolRegistry())).toEqual([
    { tool: "deptool", drop: [{ id: "needs", flag: "without" }] },
  ]);
  // dep is also a default: both have to go.
  expect(await missingHints({}, toolRegistry(["dep"]))).toEqual([
    {
      tool: "deptool",
      drop: [
        { id: "dep", flag: "without" },
        { id: "needs", flag: "without" },
      ],
    },
  ]);
  // A required fragment needs dep too: nothing drops it.
  expect(await missingHints({}, toolRegistry([], ["pinned"]))).toEqual([
    { tool: "deptool", drop: [] },
  ]);
  // An app added with --with is dropped by leaving out --with, not by --without.
  expect(await missingHints({ with: ["tool-app"] }, toolRegistry())).toEqual([
    { tool: "deptool", drop: [{ id: "needs", flag: "without" }] },
    { tool: "apptool", drop: [{ id: "tool-app", flag: "with" }] },
  ]);
});

test("a stack and a fragment sharing an id stay distinct: steps, files, decisions and tools", async () => {
  const composition = await composed({ stack: "twin", with: ["twin"] });
  expect(composition.app?.id).toBe("twin");
  expect(composition.verify.map(({ name, tags, owner }) => ({ name, tags, owner }))).toEqual([
    { name: "twin-build", tags: [], owner: S("twin") },
    { name: "twin-e2e", tags: ["app"], owner: F("twin") },
  ]);
  expect(composition.files.map(({ path, owner }) => ({ path, owner }))).toEqual([
    { path: "app.txt", owner: F("twin") },
    { path: "stack.txt", owner: S("twin") },
  ]);
  expect(composition.decisions).toEqual([
    { owner: F("twin"), text: "twin: Twin storage (default: files)." },
  ]);
  expect(missingTools(composition, () => false)).toEqual([
    { tool: "bun", owners: [S("twin")], drop: [] },
    { tool: "twinctl", owners: [F("twin")], drop: [{ id: "twin", flag: "with" }] },
  ]);
});

test("a file named only .tmpl is a plain copy, never a template with an empty path", async () => {
  const user = temp();
  const dir = writeEntry({
    root: user,
    kind: "fragment",
    dir: "dot-tmpl",
    frontmatter: minimal("fragment", "dot-tmpl"),
  });
  mkdirSync(join(dir, "files", "sub"), { recursive: true });
  writeFileSync(join(dir, "files", ".tmpl"), "root\n");
  writeFileSync(join(dir, "files", "sub", ".tmpl"), "sub\n");
  writeFileSync(join(dir, "files", "x.tmpl"), "x\n");
  const roots = [{ origin: "user", path: user } as const, ...bundledAt(composeRegistry)];
  const composition = await composed({ with: ["dot-tmpl"] }, { roots });
  const planned = composition.files.filter((file) => file.owner.id === "dot-tmpl");
  expect(planned.map(({ path, kind }) => ({ path, kind }))).toEqual([
    { path: ".tmpl", kind: "copy" },
    { path: "sub/.tmpl", kind: "copy" },
    { path: "x", kind: "template" },
  ]);
});

test("suggestions: unknown stack and fragment ids fail NotFound with close known ids only [1.1#19]", async () => {
  expect(await composeExit({ stack: "web-stak" })).toEqual(
    Exit.fail(
      new NotFound({ details: { suggestions: ["web-stack"], id: "web-stak", kind: "stack" } }),
    ),
  );
  for (const flag of ["with", "without"] as const)
    expect(await composeExit({ [flag]: ["lnt"] })).toEqual(
      Exit.fail(new NotFound({ details: { suggestions: ["lint"], id: "lnt", kind: "fragment" } })),
    );
  // A stack id is not a fragment id.
  expect(await composeExit({ with: ["misfit-stack"] })).toEqual(
    Exit.fail(new NotFound({ details: { suggestions: [], id: "misfit-stack", kind: "fragment" } })),
  );
  expect(await composeExit({ with: ["zzzzzzzz"] })).toEqual(
    Exit.fail(new NotFound({ details: { suggestions: [], id: "zzzzzzzz", kind: "fragment" } })),
  );
});

test("--without a known fragment that isn't selected composes with a warning [1.1#19]", async () => {
  const composition = await composed({ without: ["hooks-a"] });
  expect(composition.warnings).toEqual([{ code: "without_not_selected", id: "hooks-a" }]);
});

test("the NotFound envelope carries its suggestions and the id and kind it didn't find [1.1#19]", async () => {
  const program = compose({
    stack: "fixtrue-stack",
    with: [],
    without: [],
    preset: "default",
    agents: ["claude"],
    always: [],
    mode: "new",
  }).pipe(Effect.asVoid, Effect.provide(Registry.layer(bundledAt(composeRegistry))));
  const json = await runCli(["--json"], { program, env: quiet });
  expect(json.status).toBe(2);
  expect(json.stdout).toBe("");
  expect(JSON.parse(json.stderr)).toEqual({
    error: {
      tag: "NotFound",
      message: "Not found.",
      retryable: false,
      next: "run stacks list to see every stack and fragment id.",
      details: { suggestions: [], id: "fixtrue-stack", kind: "stack" },
    },
  });
  const close = compose({
    stack: "web-stakc",
    with: [],
    without: [],
    preset: "default",
    agents: ["claude"],
    always: [],
    mode: "new",
  }).pipe(Effect.asVoid, Effect.provide(Registry.layer(bundledAt(composeRegistry))));
  const human = await runCli([], { program: close, env: quiet, host: terminal });
  expect(human.status).toBe(2);
  expect(human.stderr).toBe(
    "Not found.\n  Stack: web-stakc\n  Did you mean: web-stack?\n  Next: run stacks list to see every stack and fragment id.\n",
  );
});

test("target agents: Claude Code by default, the setting next, the flag over both; only their adapters are planned [1.1#20]", async () => {
  const paths = (composition: Composition) => composition.files.map((file) => file.path);
  const fallback = await composed({});
  expect(fallback.agents).toEqual(["claude"]);
  expect(paths(fallback)).toContain(".claude/settings.json");
  expect(paths(fallback)).not.toContain(".codex/config.toml");
  const setting = await composed({}, { config: { agents: ["codex"] } });
  expect(setting.agents).toEqual(["codex"]);
  expect(paths(setting)).toContain(".codex/config.toml");
  expect(paths(setting)).not.toContain(".claude/settings.json");
  const flag = await composed({ agents: ["claude", "codex"] }, { config: { agents: ["codex"] } });
  expect(flag.agents).toEqual(["claude", "codex"]);
  expect(paths(flag)).toEqual(
    expect.arrayContaining([".claude/settings.json", ".codex/config.toml"]),
  );
});

test("a project-directory entry in the composition is listed as untrusted", async () => {
  const home = temp();
  const project = join(home, ".stacks");
  copyEntry(composeRegistry, project, "fragments", "hooks-a");
  const roots = [{ origin: "project", path: project } as const, ...bundledAt(composeRegistry)];
  const composition = await composed({ with: ["hooks-a"] }, { roots });
  expect(composition.untrusted).toEqual([
    {
      id: "hooks-a",
      kind: "fragment",
      origin: "project",
      dir: join(project, "fragments", "hooks-a"),
    },
  ]);
});

const optional = ["changelog", "hooks-a", "port-same", "go-only", "notes-app", "cycle-a", "rival"];
it.effect.prop(
  "compose is deterministic, and the order of --with ids changes neither the set nor the order [1.1#14]",
  [Schema.Array(Schema.Literals(optional)), Schema.Array(Schema.Number)],
  ([picked, keys]) =>
    Effect.promise(async () => {
      const shuffled = [...picked]
        .map((id, i) => ({ id, key: keys[i % Math.max(keys.length, 1)] ?? i }))
        .sort((a, b) => a.key - b.key)
        .map(({ id }) => id);
      const first = await composeExit({ with: [...picked] });
      const again = await composeExit({ with: [...picked] });
      const reordered = await composeExit({ with: shuffled });
      expect(again).toEqual(first);
      expect(reordered).toEqual(first);
    }),
  { timeout: 60_000, arbitrary: { runs: 25 } },
);

test("fragment stack overlays plan only for the host stack, and show and fingerprints carry them", async () => {
  const root = temp();
  for (const id of ["host", "other"])
    writeEntry({ root, kind: "stack", dir: id, frontmatter: minimal("stack", id) });
  const fragment = writeEntry({
    root,
    kind: "fragment",
    dir: "overlay",
    frontmatter: minimal("fragment", "overlay"),
  });
  for (const id of ["host", "other"]) {
    mkdirSync(join(fragment, "stacks", id), { recursive: true });
    writeFileSync(join(fragment, "stacks", id, `${id}.txt`), `${id} bytes`);
  }
  const host = await composed({ stack: "host", with: ["overlay"] }, { roots: bundledAt(root) });
  const other = await composed({ stack: "other", with: ["overlay"] }, { roots: bundledAt(root) });
  expect(host.files.map((file) => file.path)).toEqual(["host.txt"]);
  expect(other.files.map((file) => file.path)).toEqual(["other.txt"]);
  const options = { home: temp(), env: quiet, host: { registry: root } };
  const shown = await runCli(["show", "overlay", "--json"], options);
  expect(shown.status).toBe(0);
  expect(JSON.parse(shown.stdout).files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: "stacks/host/host.txt", path: "host.txt" }),
      expect.objectContaining({ source: "stacks/other/other.txt", path: "other.txt" }),
    ]),
  );
  const preview = async () => {
    const run = await runCli(
      ["validate", "--brief", "host", "--with", "overlay", "--json"],
      options,
    );
    return JSON.parse(run.stdout).fingerprint;
  };
  const before = await preview();
  writeFileSync(join(fragment, "stacks/host/host.txt"), "changed bytes");
  expect(await preview()).not.toBe(before);
});
