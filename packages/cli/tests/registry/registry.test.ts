import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { APP_TAG, Manifest } from "@steamfield/stacks-format";
import { Effect, Schema } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import { MANIFEST_PATH } from "../../src/core/project/manifest";
import { type Entry, isRejected } from "../../src/core/registry/entry";
import { Registry } from "../../src/core/registry/registry";
import { BUDGET } from "../../src/core/validate/compositions/budget";
import { NewResult } from "../../src/schemas/new";
import { quiet, runCli } from "../helpers/cli";
import { gitShim, spawnGit } from "../helpers/git";
import { brokenRegistry, composeRegistry, realRegistry, smallRegistry } from "../helpers/registry";
import { workspace } from "../helpers/verify";
import { bundled as catalogRoot } from "./helpers/bundled";

const space = workspace();
afterEach(() => space.release());
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
  const home = space.dir();
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
      expect(result.briefWords).toBeLessThanOrEqual(
        result.parts ? BUDGET.composedWorkspace : BUDGET.composed,
      );
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
