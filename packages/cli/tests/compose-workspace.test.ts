import { appendFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import { compose } from "../src/core/compose/compose";
import { resolveConditionals } from "../src/core/compose/conditionals";
import type { ComposeOptions, Composition } from "../src/core/compose/types";
import { isStack } from "../src/core/registry/entry";
import { Registry } from "../src/core/registry/registry";
import type { RegistryRoots } from "../src/core/registry/roots";
import { BadInput, ComposeConflict, EntryInvalid } from "../src/errors";
import { bundledAt, composeExit } from "./helpers/compose";
import { minimal, writeEntry } from "./helpers/registry";
import { workspaceRegistry, workspaceVariant } from "./helpers/workspace";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A temp copy of the fixture after `edit`, removed after the test. */
function variant(edit: (root: string) => void): string {
  const { root, cleanup } = workspaceVariant(edit);
  cleanups.push(cleanup);
  return root;
}
/** Replaces `from` with `to` in a fixture file, failing loudly when `from` isn't there. */
function replaceIn(root: string, file: string, from: string, to: string) {
  const path = join(root, file);
  const text = readFileSync(path, "utf8");
  if (!text.includes(from)) throw new Error(`${file} has no ${JSON.stringify(from)}`);
  writeFileSync(path, text.replace(from, to));
}
const API = "stacks/api-part/STACK.md";
const PAIR = "stacks/pair/STACK.md";
/** Adds a verify step to `api-part`, first in its list. */
const apiStep = (root: string, step: string) =>
  replaceIn(root, API, "verify:\n", `verify:\n  - ${step}\n`);

type Options = Partial<Omit<ComposeOptions, "always" | "agents">> & {
  agents?: ComposeOptions["agents"][number][];
};
const pairExit = (
  options: Options = {},
  setup: { root?: string; roots?: RegistryRoots; config?: unknown } = {},
) =>
  composeExit(
    { stack: "pair", ...options },
    {
      roots: setup.roots ?? bundledAt(setup.root ?? workspaceRegistry),
      ...(setup.config === undefined ? {} : { config: setup.config }),
    },
  );
async function pair(...args: Parameters<typeof pairExit>): Promise<Composition> {
  const exit = await pairExit(...args);
  if (Exit.isFailure(exit)) throw new Error(`compose failed: ${JSON.stringify(exit.cause)}`);
  return exit.value;
}
const S = (id: string) => ({ kind: "stack" as const, id });
const F = (id: string) => ({ kind: "fragment" as const, id });
const paths = (composition: Composition) => composition.files.map((file) => file.path);
const file = (composition: Composition, path: string) =>
  composition.files.find((planned) => planned.path === path);
const step = (composition: Composition, name: string) =>
  composition.verify.find((candidate) => candidate.name === name);
const part = (composition: Composition, name: string) =>
  composition.parts?.find((candidate) => candidate.mount.name === name);
const conflict = (details: ComposeConflict["details"]) => new ComposeConflict({ details });
const invalid = (details: EntryInvalid["details"]) => new EntryInvalid({ details });
/** The expected failure a composition ended with, without the cause's trace annotations. */
async function failure(exit: Promise<Exit.Exit<unknown, unknown>>): Promise<unknown> {
  const done = await exit;
  if (Exit.isSuccess(done)) throw new Error("compose succeeded");
  return Cause.findErrorOption(done.cause).pipe(Option.getOrUndefined);
}

describe("mounting the parts", () => {
  test("the workspace's files are at the root, each part's under its directory, adapters on the session-root list hoisted", async () => {
    const composition = await pair();
    expect(paths(composition)).toEqual([
      ".claude/hooks/harness-guard.sh",
      ".claude/hooks/shared-guard.sh",
      ".claude/settings.json",
      ".env.example",
      ".github/workflows/ci.yml",
      "AGENTS.md",
      "Makefile",
      "README.md",
      "backend/.claude/rules/api.md",
      "backend/AGENTS.md",
      "backend/README.md",
      "backend/config/app.json",
      "backend/package.json",
      "backend/src/index.ts",
      "backend/src/notes.ts",
      "frontend/AGENTS.md",
      "frontend/README.md",
      "frontend/orval.config.ts",
      "frontend/src/main.ts",
      "frontend/src/notes-page.ts",
    ]);
    expect(file(composition, "backend/package.json")).toMatchObject({
      kind: "template",
      owner: S("api-part"),
      source: { entry: S("api-part"), file: "files/package.json.tmpl" },
    });
    expect(composition.parts?.map(({ mount, entry }) => [mount, entry?.id])).toEqual([
      [{ name: "backend", role: "api", stack: "api-part" }, "api-part"],
      [{ name: "frontend", role: "web", stack: "web-part" }, "web-part"],
    ]);
    expect(composition.stack.id).toBe("pair");
    expect(composition.warnings).toEqual([]);
    expect(composition.untrusted).toEqual([]);
  });

  test("steps are prefixed with the part name and run in the part directory; the workspace's are unchanged", async () => {
    const composition = await pair();
    expect(composition.verify.map(({ name, cwd, owner }) => ({ name, cwd, owner }))).toEqual([
      { name: "both", cwd: undefined, owner: S("pair") },
      { name: "readme-filled", cwd: undefined, owner: S("pair") },
      { name: "backend-install", cwd: "backend", owner: S("api-part") },
      { name: "backend-lint", cwd: "backend", owner: S("api-part") },
      { name: "backend-test", cwd: "backend", owner: S("api-part") },
      { name: "backend-openapi-drift", cwd: "backend", owner: S("api-part") },
      { name: "backend-api", cwd: "backend", owner: S("api-part") },
      { name: "frontend-install", cwd: "frontend", owner: S("web-part") },
      { name: "frontend-lint", cwd: "frontend", owner: S("web-part") },
      { name: "frontend-test", cwd: "frontend", owner: S("web-part") },
      { name: "frontend-web", cwd: "frontend", owner: S("web-part") },
      { name: "frontend-client-drift", cwd: "frontend", owner: F("client-link") },
      { name: "harness-ok", cwd: undefined, owner: F("harness") },
      { name: "ci-config", cwd: undefined, owner: F("root-ci") },
    ]);
    expect(step(composition, "both")).not.toHaveProperty("cwd");
  });

  test("a part step's own cwd is joined to the part directory, and `.` is the directory itself", async () => {
    const root = variant((at) => apiStep(at, '{ name: sub, layer: check, run: "true", cwd: sub }'));
    expect(step(await pair({}, { root }), "backend-sub")?.cwd).toBe("backend/sub");
    expect(step(await pair({ with: ["db"] }), "backend-migrate")?.cwd).toBe("backend");
  });

  test("commands and dependency roles are namespaced by part; env merges without a conflict", async () => {
    const composition = await pair();
    expect(composition.commands).toEqual({
      check: "Run both parts' checks",
      "backend-lint": "Check the source",
      "backend-test": "Run the tests",
      "backend-dev": "Serve the API",
      "backend-openapi": "Write the OpenAPI document",
      "frontend-lint": "Check the source",
      "frontend-test": "Run the tests",
      "frontend-dev": "Serve the app",
    });
    expect(composition.deps).toEqual([
      { role: "backend-dev", names: ["tsx"], owners: [S("api-part")] },
      { role: "backend-runtime", names: ["hono"], owners: [S("api-part")] },
      { role: "frontend-dev", names: ["vitest"], owners: [S("web-part")] },
    ]);
    expect(composition.env).toEqual({ PORT_API: "3100", PORT_WEB: "4173" });
    expect(composition.decisions).toEqual([
      { owner: S("api-part"), text: "api-part: Database (default: none)." },
    ]);
  });

  test("(a) a placed fragment's role equal to the part name is prefixed like any other", async () => {
    const composition = await pair({ with: ["db"] });
    expect(composition.deps.find((dep) => dep.role.endsWith("backend"))).toEqual({
      role: "backend-backend",
      names: ["pg"],
      owners: [F("db")],
    });
    expect(composition.commands["backend-db-up"]).toBe("Start the local database");
    expect(composition.env.DATABASE_URL).toBe("postgres://localhost/example");
    expect(step(composition, "backend-up")).toMatchObject({ cwd: "backend", phase: "setup" });
  });

  test("(b) a workspace command equal to a namespaced part command wins, and a shared role merges", async () => {
    const root = variant((at) =>
      replaceIn(
        at,
        PAIR,
        "commands:\n  check: Run both parts' checks\n",
        "commands:\n  check: Run both parts' checks\n  backend-test: The workspace's own test\ndeps:\n  backend-dev: [biome]\n",
      ),
    );
    const composition = await pair({}, { root });
    expect(composition.commands["backend-test"]).toBe("The workspace's own test");
    expect(composition.deps[0]).toEqual({
      role: "backend-dev",
      names: ["biome", "tsx"],
      owners: [S("pair"), S("api-part")],
    });
  });

  test.each([
    ["..", "a parent"],
    ["../x", "a sibling"],
    ["/tmp", "an absolute path"],
    ["sub/../..", "a path that climbs out after descending"],
  ])("(c) a part step with cwd %s (%s) is EntryInvalid part_cwd", async (cwd) => {
    const root = variant((at) =>
      apiStep(at, `{ name: escape, layer: check, run: "true", cwd: "${cwd}" }`),
    );
    expect(await failure(pairExit({}, { root }))).toEqual(
      invalid({
        id: "pair",
        origin: "bundled",
        reason: "part_cwd",
        part: "backend",
        step: "backend-escape",
      }),
    );
  });

  test.each(["..", "../x", "/tmp"])(
    "(c) a placed fragment's step with cwd %s is EntryInvalid part_cwd",
    async (cwd) => {
      const root = variant((at) =>
        replaceIn(at, "fragments/db/FRAGMENT.md", "cwd: . }", `cwd: "${cwd}" }`),
      );
      expect(await failure(pairExit({ with: ["db"] }, { root }))).toEqual(
        invalid({
          id: "pair",
          origin: "bundled",
          reason: "part_cwd",
          part: "backend",
          step: "backend-migrate",
        }),
      );
    },
  );
});

describe("placement", () => {
  test("a link lands in its part, a multi-part fragment once at the root, a part-scoped one in its part from its own overlay", async () => {
    const composition = await pair({ with: ["db"] });
    expect(file(composition, "frontend/orval.config.ts")?.owner).toEqual(F("client-link"));
    expect(step(composition, "frontend-client-drift")?.owner).toEqual(F("client-link"));
    expect(file(composition, ".claude/hooks/harness-guard.sh")?.owner).toEqual(F("harness"));
    expect(
      composition.verify.filter((s) => s.name.endsWith("harness-ok")).map((s) => s.name),
    ).toEqual(["harness-ok"]);
    expect(file(composition, "backend/src/db.ts")?.source).toEqual({
      entry: F("db"),
      file: "stacks/api-part/src/db.ts",
    });
    expect(paths(composition).filter((path) => path.includes("db-client"))).toEqual([]);
    expect(file(composition, ".github/workflows/ci.yml")?.owner).toEqual(F("root-ci"));
    expect(composition.fragments.map(({ id, mount }) => [id, mount?.name])).toEqual([
      ["client-link", "frontend"],
      ["db", "backend"],
      ["harness", undefined],
      ["root-ci", undefined],
    ]);
  });

  test("a fragment that fits only by tag lands at the root; one naming the workspace uses the workspace's overlay", async () => {
    const root = variant((at) => {
      const tagged = writeEntry({
        root: at,
        kind: "fragment",
        dir: "tagged",
        frontmatter: minimal(
          "fragment",
          "tagged",
          'applies_to: [bun]\nverify:\n  - { name: tagged-ok, layer: check, run: "true" }',
        ),
      });
      mkdirSync(join(tagged, "files"));
      writeFileSync(join(tagged, "files", "tagged.txt"), "tagged\n");
      const named = writeEntry({
        root: at,
        kind: "fragment",
        dir: "named",
        frontmatter: minimal("fragment", "named", "applies_to: [pair, api-part]"),
      });
      for (const overlay of ["pair", "api-part"]) {
        mkdirSync(join(named, "stacks", overlay), { recursive: true });
        writeFileSync(join(named, "stacks", overlay, `${overlay}.txt`), `${overlay}\n`);
      }
    });
    const tagged = await pair({ with: ["tagged"] }, { root });
    expect(step(tagged, "tagged-ok")?.cwd).toBeUndefined();
    expect(file(tagged, "tagged.txt")?.owner).toEqual(F("tagged"));
    expect(tagged.warnings).toEqual([]);
    expect(tagged.fragments.find((fragment) => fragment.id === "tagged")?.mount).toBeUndefined();
    const named = await pair({ with: ["named"] }, { root });
    expect(paths(named).filter((path) => path.endsWith(".txt"))).toEqual(["pair.txt"]);
  });
});

describe("the session-root list", () => {
  test("both parts' settings and harness's deep-merge into one root file with each hook once", async () => {
    const composition = await pair();
    const settings = file(composition, ".claude/settings.json");
    expect(settings).toMatchObject({
      kind: "merge",
      owner: S("pair"),
      owners: [S("pair"), S("api-part"), S("web-part"), F("harness")],
    });
    expect(JSON.parse(settings?.content ?? "")).toEqual({
      permissions: { allow: ["Bash(make check)"] },
      hooks: {
        PreToolUse: [
          { hooks: [{ type: "command", command: "api-hook" }] },
          { hooks: [{ type: "command", command: "web-hook" }] },
        ],
        PostToolUse: [{ hooks: [{ type: "command", command: "harness-hook" }] }],
      },
    });
  });

  test("an identical hook from both parts is one root file owned by both, its executable bit kept", async () => {
    const guard = file(await pair(), ".claude/hooks/shared-guard.sh");
    expect(guard).toMatchObject({
      kind: "copy",
      owner: S("api-part"),
      owners: [S("api-part"), S("web-part")],
      source: { entry: S("api-part"), file: "adapters/claude/.claude/hooks/shared-guard.sh" },
    });
    expect((guard?.mode ?? 0) & 0o111).not.toBe(0);
  });

  test("a Codex skill is hoisted; nested rules and AGENTS.md stay in the part", async () => {
    const composition = await pair({ agents: ["claude", "codex"] });
    expect(file(composition, ".agents/skills/api-skill/SKILL.md")?.owner).toEqual(S("api-part"));
    expect(file(composition, "backend/.claude/rules/api.md")?.owner).toEqual(S("api-part"));
    expect(paths(composition).filter((path) => path.endsWith("AGENTS.md"))).toEqual([
      "AGENTS.md",
      "backend/AGENTS.md",
      "frontend/AGENTS.md",
    ]);
  });

  test("(g) a one-byte difference in one part's hoisted hook is a file_owner conflict naming both parts", async () => {
    const root = variant((at) =>
      appendFileSync(
        join(at, "stacks/web-part/adapters/claude/.claude/hooks/shared-guard.sh"),
        "#",
      ),
    );
    expect(await failure(pairExit({}, { root }))).toEqual(
      conflict({
        reason: "file_owner",
        stack: "api-part",
        ids: [],
        path: ".claude/hooks/shared-guard.sh",
        parts: ["backend", "frontend"],
      }),
    );
  });

  test("a mounted merge path merges in the part; without the mounted merge list it is file_owner", async () => {
    const merged = file(await pair({ with: ["db"] }), "backend/config/app.json");
    expect(merged).toMatchObject({ kind: "merge", owners: [S("api-part"), F("db")] });
    expect(JSON.parse(merged?.content ?? "")).toEqual({ name: "api", database: "postgres" });
    const root = variant((at) =>
      replaceIn(
        at,
        API,
        "merge: [.claude/settings.json, config/app.json]",
        "merge: [.claude/settings.json]",
      ),
    );
    expect(await failure(pairExit({ with: ["db"] }, { root }))).toEqual(
      conflict({
        reason: "file_owner",
        stack: "api-part",
        ids: ["db"],
        path: "backend/config/app.json",
        parts: ["backend"],
      }),
    );
  });
});

describe("collisions", () => {
  test.each([
    ["a file named for the part", "files/backend", "backend/.claude/rules/api.md"],
    ["a file inside the part directory", "files/backend/README.md", "backend/README.md"],
  ])(
    "the workspace shipping %s is file_owner naming the workspace and the part",
    async (_, shipped, path) => {
      const root = variant((at) => {
        const target = join(at, "stacks/pair", shipped);
        mkdirSync(dirname(target), { recursive: true });
        cpSync(join(at, "stacks/pair/files/README.md"), target);
      });
      expect(await failure(pairExit({}, { root }))).toEqual(
        conflict({ reason: "file_owner", stack: "pair", ids: [], path, parts: ["backend"] }),
      );
    },
  );

  test("a root fragment's step equal to a prefixed part step is step_name naming both", async () => {
    const root = variant((at) =>
      writeEntry({
        root: at,
        kind: "fragment",
        dir: "clash",
        frontmatter: minimal(
          "fragment",
          "clash",
          'applies_to: [bun]\nverify:\n  - { name: backend-lint, layer: lint, run: "true" }',
        ),
      }),
    );
    expect(await failure(pairExit({ with: ["clash"] }, { root }))).toEqual(
      conflict({
        reason: "step_name",
        stack: "api-part",
        ids: ["clash"],
        step: "backend-lint",
        parts: ["backend"],
      }),
    );
  });
});

describe("the condition context", () => {
  test("a part sees its own stack, tags and placed fragments; the root sees the workspace and every fragment", async () => {
    const plain = await pair();
    const api = part(plain, "backend")?.entry?.body ?? "";
    expect(api).toContain("Bun runs the scripts.");
    expect(api).not.toContain("CI runs this part's lint and tests.");
    expect(api).not.toContain("The database URL");
    expect(plain.fragments.find((f) => f.id === "root-ci")?.body).not.toContain("CI sets up Bun.");
    expect(plain.stack.body).toContain("The client link keeps the generated client in step");
    const withDb = await pair({ with: ["db"] });
    expect(part(withDb, "backend")?.entry?.body).toContain("The database URL is in `DATABASE_URL`");
    expect(withDb.fragments.find((f) => f.id === "db")?.body).toContain(
      "The database is part of this composition.",
    );
  });

  test("part=<role> holds for every entry of a workspace with that role and never in a single stack", async () => {
    const block = (role: string) =>
      `\n<!-- stacks:when part=${role} -->\nA ${role} part is here.\n<!-- stacks:end -->\n`;
    const root = variant((at) => {
      appendFileSync(join(at, "fragments/db/FRAGMENT.md"), `${block("web")}${block("mobile")}`);
      appendFileSync(join(at, PAIR), block("api"));
    });
    const workspace = await pair({ with: ["db"] }, { root });
    const db = workspace.fragments.find((f) => f.id === "db")?.body ?? "";
    expect(db).toContain("A web part is here.");
    expect(db).not.toContain("A mobile part is here.");
    expect(workspace.stack.body).toContain("A api part is here.");
    const single = await pair({ stack: "api-part", with: ["db"] }, { root });
    expect(single.parts).toBeUndefined();
    expect(single.fragments.find((f) => f.id === "db")?.body).not.toContain("A web part is here.");
  });

  test("part= is a known key with an open value, and malformed spellings are still refused", () => {
    const context = {
      stack: "s",
      tags: [],
      mode: "new" as const,
      preset: "default" as const,
      with: [],
    };
    const body = "<!-- stacks:when part=web,api -->\nkept\n<!-- stacks:end -->";
    expect(resolveConditionals(body, { ...context, partRoles: ["api"] })).toEqual({ text: "kept" });
    expect(resolveConditionals(body, context)).toEqual({ text: "" });
    expect(resolveConditionals("<!-- stacks:when part= -->\n<!-- stacks:end -->", context)).toEqual(
      { line: 1, problem: "bad_value" },
    );
    expect(
      resolveConditionals("<!-- stacks:when part!=web -->\n<!-- stacks:end -->", context),
    ).toEqual({ line: 1, problem: "unknown_key" });
  });
});

describe("payloads", () => {
  test("--payload none applies to each part that ships it and the example to one that doesn't", async () => {
    const composition = await pair({ payload: "none" });
    expect(paths(composition)).toContain("backend/src/empty.ts");
    expect(paths(composition)).not.toContain("backend/src/notes.ts");
    expect(paths(composition)).toContain("frontend/src/notes-page.ts");
    expect(composition.payload).toBe("none");
  });

  test("a payload neither the workspace nor any part ships is BadInput", async () => {
    const root = variant((at) =>
      rmSync(join(at, "stacks/api-part/payloads/none"), { recursive: true }),
    );
    expect(await failure(pairExit({ payload: "none" }, { root }))).toEqual(
      new BadInput({ details: { id: "none", flag: "payload" } }),
    );
  });
});

describe("selection", () => {
  const ids = (composition: Composition) => composition.fragments.map((fragment) => fragment.id);

  test("--preset lean and --without drop only the workspace's defaults", async () => {
    expect(ids(await pair({ lean: true }))).toEqual(["client-link", "harness"]);
    expect(ids(await pair({ without: ["root-ci"] }))).toEqual(["client-link", "harness"]);
  });

  test("fit counts every part: --with db and an always fragment fitting one part are selected without a warning", async () => {
    const withDb = await pair({ with: ["db"] });
    expect(withDb.warnings).toEqual([]);
    const always = await pair({}, { config: { always: ["db"] } });
    expect(always.selection).toContainEqual({ id: "db", via: "always" });
    expect(always.warnings).toEqual([]);
  });

  test("--with a fragment that fits neither part nor the workspace warns with_not_applicable", async () => {
    const root = variant((at) =>
      writeEntry({
        root: at,
        kind: "fragment",
        dir: "go-only",
        frontmatter: minimal("fragment", "go-only", "applies_to: [go]"),
      }),
    );
    expect((await pair({ with: ["go-only"] }, { root })).warnings).toEqual([
      { code: "with_not_applicable", id: "go-only" },
    ]);
  });

  test("a part's own required and default tiers are not selected", async () => {
    const root = variant((at) => {
      writeEntry({
        root: at,
        kind: "fragment",
        dir: "part-only",
        frontmatter: minimal("fragment", "part-only"),
      });
      replaceIn(at, API, "default: [root-ci]", "default: [root-ci, part-only]");
      replaceIn(
        at,
        "stacks/web-part/STACK.md",
        "required: [harness]",
        "required: [harness, part-only]",
      );
    });
    expect(ids(await pair({}, { root }))).toEqual(["client-link", "harness", "root-ci"]);
  });
});

describe("part problems", () => {
  const refusal = (reason: string, part?: string) =>
    invalid({
      id: "pair",
      origin: "bundled",
      reason: reason as "part_stack",
      ...(part ? { part } : {}),
    });

  test.each([
    ["part_stack", "stack: web-part }", "stack: no-such-stack }", "frontend"],
    ["part_role", "role: web, stack: web-part", "role: mobile, stack: web-part", "frontend"],
    ["part_name_duplicate", "name: frontend,", "name: backend,", "backend"],
    ["part_nested", "stack: web-part }", "stack: pair }", "frontend"],
    ["part_roles", "role: web, stack: web-part", "role: api, stack: web-part", undefined],
    ["part_roles", "role: api, stack: api-part", "role: web, stack: api-part", undefined],
  ])("%s: %s becomes %s", async (reason, from, to, named) => {
    const root = variant((at) => replaceIn(at, PAIR, from, to));
    expect(await failure(pairExit({}, { root }))).toEqual(refusal(reason, named));
  });
});

describe("trust and pins", () => {
  test("a project-root shadow of a part is listed as untrusted", async () => {
    const project = variant((at) => {
      rmSync(join(at, "fragments"), { recursive: true });
      rmSync(join(at, "stacks/pair"), { recursive: true });
      rmSync(join(at, "stacks/api-part"), { recursive: true });
    });
    const composition = await pair(
      {},
      {
        roots: [
          { origin: "project", path: project },
          { origin: "bundled", path: workspaceRegistry },
        ],
      },
    );
    expect(composition.untrusted).toEqual([
      {
        id: "web-part",
        kind: "stack",
        origin: "project",
        dir: join(project, "stacks", "web-part"),
      },
    ]);
  });

  /** `compose` over the fixture with `pair` carrying `partEntries.frontend` read from `pinRoot`. */
  const pinned = (pinRoot: string, roots: RegistryRoots) =>
    Effect.gen(function* () {
      const pin = yield* Effect.provide(
        Effect.gen(function* () {
          return yield* (yield* Registry).get("stack", "web-part");
        }),
        Registry.layer(bundledAt(pinRoot)),
      );
      const withPin = Layer.effect(
        Registry,
        Effect.gen(function* () {
          const live = yield* Registry;
          return Registry.of({
            ...live,
            get: (kind, id) =>
              Effect.map(live.get(kind, id), (entry) =>
                isStack(entry) && entry.id === "pair"
                  ? { ...entry, partEntries: { frontend: pin } }
                  : entry,
              ),
          });
        }),
      ).pipe(Layer.provide(Registry.layer(roots)));
      return yield* compose({
        stack: "pair",
        with: [],
        without: [],
        preset: "default",
        mode: "new",
        always: [],
        agents: ["claude"],
      }).pipe(Effect.provide(withPin));
    }).pipe(Effect.provide(NodeServices.layer), Effect.runPromise);

  test("a workspace's pinned part entries are composed; a user-root part overrides the pin", async () => {
    const pinRoot = variant((at) =>
      appendFileSync(join(at, "stacks/web-part/STACK.md"), "\nPINNED COPY\n"),
    );
    const composition = await pinned(pinRoot, bundledAt(workspaceRegistry));
    expect(part(composition, "frontend")?.entry?.body).toContain("PINNED COPY");
    const user = variant((at) =>
      appendFileSync(join(at, "stacks/web-part/STACK.md"), "\nUSER COPY\n"),
    );
    const overridden = await pinned(pinRoot, [
      { origin: "user", path: user },
      { origin: "bundled", path: workspaceRegistry },
    ]);
    expect(part(overridden, "frontend")?.entry).toMatchObject({ origin: "user" });
    expect(part(overridden, "frontend")?.entry?.body).toContain("USER COPY");
  });
});

describe("add mode", () => {
  const mounts = [
    { name: "backend", role: "api", stack: "api-part" },
    { name: "frontend", role: "web", stack: "web-part" },
  ];
  const add = (options: Partial<ComposeOptions<"add">>, root = workspaceRegistry) =>
    Effect.runPromise(
      compose({
        stack: "pair",
        with: ["db"],
        without: [],
        preset: "default",
        mode: "add",
        always: [],
        agents: ["claude"],
        existing: ["client-link", "harness", "root-ci"],
        parts: mounts,
        ...options,
      }).pipe(Effect.provide(Registry.layer(bundledAt(root))), Effect.provide(NodeServices.layer)),
    );

  test("an added fragment is placed on its part, and the part's with= block is a recipe note", async () => {
    const composition = await add({});
    expect(composition.fragments.map(({ id, mount }) => [id, mount?.name])).toEqual([
      ["db", "backend"],
    ]);
    expect(composition.files.map((planned) => planned.path)).toEqual([
      "backend/config/app.json",
      "backend/src/db.ts",
    ]);
    expect(composition.verify.map(({ name, cwd }) => [name, cwd])).toEqual([
      ["backend-up", "backend"],
      ["backend-migrate", "backend"],
    ]);
    expect(
      composition.addNotes?.map((note) => [note.fragment, note.entry.id, note.entry.body.trim()]),
    ).toEqual([
      ["db", "api-part", "The database URL is in `DATABASE_URL`; start it with `db-up`."],
    ]);
  });

  test("a part stack the registry lost still places by stack id and fits by id", async () => {
    const root = variant((at) => rmSync(join(at, "stacks/api-part"), { recursive: true }));
    const composition = await add({}, root);
    expect(composition.parts?.map((p) => [p.mount.name, p.entry?.id ?? null])).toEqual([
      ["backend", null],
      ["frontend", "web-part"],
    ]);
    expect(composition.fragments.map(({ id, mount }) => [id, mount?.name])).toEqual([
      ["db", "backend"],
    ]);
  });

  test("the manifest's parts are used, never the registry entry's", async () => {
    const composition = await add({
      parts: [
        { name: "server", role: "api", stack: "api-part" },
        { name: "frontend", role: "web", stack: "web-part" },
      ],
    });
    expect(composition.files.map((planned) => planned.path)).toEqual([
      "server/config/app.json",
      "server/src/db.ts",
    ]);
    // Without the manifest's parts, db fits nothing the project has: `pair`'s own parts don't count.
    await expect(add({ parts: [] })).rejects.toEqual(
      new ComposeConflict({ details: { reason: "applies_to", ids: ["db"] } }),
    );
  });
});
