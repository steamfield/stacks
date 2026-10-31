import { join } from "node:path";
import { Exit } from "effect";
import { afterEach, expect, test } from "vitest";
import { nest } from "../src/core/brief/headings";
import { collapsePaths } from "../src/core/brief/paths";
import { type BriefContext, renderBrief } from "../src/core/brief/render";
import { countWords } from "../src/core/brief/words";
import { type Composition, missingTools } from "../src/core/compose/compose";
import { tempDir } from "./helpers/cli";
import { bundledAt, composeExit } from "./helpers/compose";
import { composeRegistry, copyEntry, minimal, realRegistry, writeEntry } from "./helpers/registry";

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
  if (Exit.isFailure(exit)) throw new Error(`compose failed: ${String(exit.cause)}`);
  return exit.value;
}
const context = (over: Partial<BriefContext> = {}): BriefContext => ({
  project: "demo",
  git: { kind: "fresh" },
  written: [],
  missing: [],
  yes: false,
  invocation: "stacks",
  ...over,
});
/** The brief's level-2 headings, in order. */
const headings = (text: string) => text.split("\n").filter((line) => line.startsWith("## "));
/** The text from `heading` up to the next level-2 heading. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n${heading}\n`);
  if (start === -1) throw new Error(`no section ${heading}`);
  const end = text.indexOf("\n## ", start + heading.length + 2);
  return text.slice(start + 1, end === -1 ? undefined : end + 1);
}
const rows = (text: string) => text.split("\n").filter((line) => line.startsWith("| `"));
// biome-ignore lint/suspicious/noTemplateCurlyInString: a verify-env placeholder, shown as written
const probe = "http://localhost:${PORT_WEB}/";

test.each(["default", "sandbox"] as const)(
  "every %s brief keeps its ignored task and notes in this checkout",
  async (preset) => {
    for (const without of [[], ["todo-app"]]) {
      const brief = renderBrief(await composed({ preset, without }), context()).text;
      expect(section(brief, "## Ground rules")).toContain(
        "- Keep `.stacks/NOTES.md` here as you work. It and the brief are git-ignored, so git worktrees lack them:",
      );
    }
  },
);

test("with an app, the definition of done is split: the base with --skip-tag app, then the application [1.1#14a]", async () => {
  const brief = renderBrief(await composed({}), context()).text;
  expect(headings(brief)).toEqual([
    "## Your job",
    "## Versions",
    "## Ground rules",
    "## Decisions",
    "## Dependencies and tools",
    "## Stack: Web stack (`web-stack`)",
    "## Fragment: CI (`ci`)",
    "## Fragment: Docker deploy (`docker-deploy`)",
    "## Fragment: Format (`format`)",
    "## Fragment: Lint (`lint`)",
    "## Definition of done: base",
    "## Then: the application",
  ]);
  const base = section(brief, "## Definition of done: base");
  expect(base).toContain("`stacks verify --skip-tag app` runs these steps, in this order:");
  expect(base).toContain(
    "- Run `stacks verify --skip-tag app` from the project root. The base is done when every step above passes and the outcome is `partial`",
  );
  // Green is the application section's closing, never the base's.
  expect(base).not.toContain("`stacks verify` runs these steps");
  expect(base).not.toContain("Done is exit 0 with outcome `green`");
  // By phase, then stack before fragments within a phase; then the commands and env rows.
  expect(rows(base).map((row) => row.split(" | ")[0])).toEqual([
    "| `install`",
    "| `test`",
    "| `deploy-dry-run`",
    "| `lint`",
    "| `web`",
    "| `install`",
    "| `test`",
    "| `dev`",
    "| `lint`",
    "| `PORT_WEB`",
  ]);
  expect(base).not.toContain("todo-e2e");
  const application = section(brief, "## Then: the application");
  expect(application).toContain("APP-BODY");
  expect(application).toContain(
    "These steps carry the `app` tag. A full verify runs them in phase order alongside the base steps:",
  );
  expect(application).not.toContain("run after the base steps");
  expect(rows(application).map((row) => row.split(" | ")[0])).toEqual([
    "| `todo-e2e`",
    "| `e2e`",
    "| `PORT_TODO`",
  ]);
  expect(application).toContain("| `PORT_TODO` | `5180` |");
  expect(application).toContain("Done is a full `stacks verify` (no `--skip-tag`)");
  expect(brief.indexOf("APP-BODY")).toBeGreaterThan(brief.indexOf("## Then: the application"));
  // Without an app, neither heading appears.
  const plain = renderBrief(await composed({ without: ["todo-app"] }), context()).text;
  expect(plain).toContain("\n## Definition of done\n");
  expect(plain).not.toContain("Definition of done: base");
  expect(plain).not.toContain("Then: the application");
  expect(plain).not.toContain("--skip-tag");
});

test("the brief holds every section in order, every step, the env defaults, every rule and the commands, with the invocation in every command [1.1#15] [1.1#23]", async () => {
  const composition = await composed({ preset: "sandbox" });
  const invocation = "npx -y stacks@1.2.3";
  const brief = renderBrief(composition, context({ invocation, yes: true })).text;
  expect(headings(brief)).toEqual([
    "## Your job",
    "## Versions",
    "## Ground rules",
    "## Decisions",
    "## Dependencies and tools",
    "## Stack: Web stack (`web-stack`)",
    "## Fragment: CI (`ci`)",
    "## Fragment: Format (`format`)",
    "## Fragment: Lint (`lint`)",
    "## Definition of done",
    "## Sandbox",
  ]);
  const done = section(brief, "## Definition of done");
  expect(rows(done)).toEqual([
    "| `install` | setup | install |  |",
    "| `test` | check | test |  |",
    "| `deploy-dry-run` | check | build | skipped (`prod`, sandbox); timeout 15m |",
    "| `lint` | check | lint |  |",
    `| \`web\` | serve | serve | \`${probe}\` within 60s |`,
    "| `install` | Install dependencies |",
    "| `test` | Run the unit tests |",
    "| `dev` | Run the dev server |",
    "| `lint` | Lint the project |",
    "| `PORT_WEB` | `5173` |",
  ]);
  expect(done).toContain(
    [
      "Each step's command, exactly as verify runs it:",
      "",
      "```sh",
      "# install",
      "bun install",
      "# test",
      "bun run test",
      "# deploy-dry-run",
      "bun run deploy:check",
      "# lint",
      "bun run lint",
      "# web",
      "bun run dev",
      "```",
    ].join("\n"),
  );
  expect(done).toContain(`\`PORT_WEB=<free port> ${invocation} verify\``);
  expect(done).toContain("Don't change the defaults in `.stacks/manifest.json`");
  for (const rule of [
    `- Run \`${invocation} verify\` from the project root.`,
    "- A command a step calls that doesn't exist yet is yours to create",
    "- Don't weaken the definition of done.",
    "- Stop any dev server you started before running verify",
    "- A serve step's command stays in the foreground",
    "- Run verify with your shell tool's longest timeout.",
    "- When verify fails, read the step name",
    "- If verify fails with `VerifyChanged`",
  ])
    expect(done).toContain(rule);
  expect(brief).not.toMatch(/stacks:(when|end)/);
  expect(brief).toContain(`\`${invocation} verify\``);
  expect(brief).toContain(`\`${invocation} verify --accept-changes\``);
  // Every verify command in the brief carries the invocation: none starts with the bare name.
  expect(brief).not.toMatch(/`(stacks )?verify\b/);
  expect(brief).not.toMatch(/=<free port> stacks verify/);
});

test("a verify table leaves out Layer and Expects when no step in that table fills them", async () => {
  /** Each verify table: its header and every row up to the blank line after it. */
  const tables = (text: string) =>
    text
      .split("\n\n")
      .filter((block) => block.startsWith("| Step "))
      .map((block) => block.split("\n"));
  const user = temp();
  const stack = (id: string, verify: string[]) =>
    writeEntry({
      root: user,
      kind: "stack",
      dir: id,
      frontmatter: minimal("stack", id, ["verify:", ...verify].join("\n")),
      body: "",
    });
  const brief = async (stackId: string, withIds: string[] = []) =>
    renderBrief(
      await composed(
        { stack: stackId, with: withIds },
        { roots: [{ origin: "user", path: user }] },
      ),
      context(),
    ).text;
  stack("bare", ['  - { name: a, run: "true" }', '  - { name: b, phase: setup, run: "true" }']);
  stack("layered", ['  - { name: a, layer: lint, run: "true" }', '  - { name: b, run: "true" }']);
  stack("timed", ['  - { name: a, timeout: 5m, run: "true" }']);
  writeEntry({
    root: user,
    kind: "fragment",
    dir: "plain-app",
    frontmatter: minimal(
      "fragment",
      "plain-app",
      'applies_to: [layered]\nverify:\n  - { name: e2e, run: "true" }',
    ).replace("category: tooling", "category: app"),
    body: "",
  });
  expect(tables(await brief("bare"))).toEqual([
    ["| Step | Phase |", "|---|---|", "| `b` | setup |", "| `a` | check |"],
  ]);
  expect(tables(await brief("layered"))).toEqual([
    ["| Step | Phase | Layer |", "|---|---|---|", "| `a` | check | lint |", "| `b` | check |  |"],
  ]);
  expect(tables(await brief("timed"))).toEqual([
    ["| Step | Phase | Expects |", "|---|---|---|", "| `a` | check | timeout 5m |"],
  ]);
  // With an app, the base table and the application's table each decide for themselves.
  expect(tables(await brief("layered", ["plain-app"]))).toEqual([
    ["| Step | Phase | Layer |", "|---|---|---|", "| `a` | check | lint |", "| `b` | check |  |"],
    ["| Step | Phase |", "|---|---|", "| `e2e` | check |"],
  ]);
});

test("the rules about servers appear only when a step serves", async () => {
  const user = temp();
  writeEntry({
    root: user,
    kind: "stack",
    dir: "quiet-stack",
    frontmatter: minimal("stack", "quiet-stack", "verify:\n  - { name: test, run: bun run test }"),
  });
  const composition = await composed(
    { stack: "quiet-stack" },
    { roots: [{ origin: "user", path: user }] },
  );
  const brief = renderBrief(composition, context()).text;
  expect(brief).not.toContain("Stop any dev server");
  expect(brief).not.toContain("stays in the foreground");
});

test("decisions: asked once without --yes, defaults taken with it [1.1#16]", async () => {
  const composition = await composed({});
  const ask = section(renderBrief(composition, context()).text, "## Decisions");
  expect(ask).toContain("Ask the user about these once, in one message");
  expect(ask).toContain("- Package manager (default: bun).\n- format: Line width (default: 100).");
  const yes = section(renderBrief(composition, context({ yes: true })).text, "## Decisions");
  expect(yes).toContain("Use each default below without asking");
  expect(yes).not.toContain("Ask the user");
});

test("an untrusted entry gets a stop section directly after the title, before any entry text, even under --yes [1.1#17]", async () => {
  const project = join(temp(), ".stacks");
  copyEntry(composeRegistry, project, "fragments", "hooks-a");
  const roots = [{ origin: "project", path: project } as const, ...bundledAt(composeRegistry)];
  const composition = await composed({ with: ["hooks-a"] }, { roots });
  const brief = renderBrief(composition, context({ yes: true })).text;
  expect(headings(brief)[0]).toBe("## Untrusted entries");
  const untrusted = section(brief, "## Untrusted entries");
  expect(untrusted).toContain("Stop. Do nothing else until the user answers.");
  expect(untrusted).toContain(
    `- fragment \`hooks-a\` (project): \`${join(project, "fragments", "hooks-a")}\``,
  );
  expect(untrusted).toContain("the project's `.stacks/` directory");
  expect(untrusted).toContain("This holds under `--yes` and `--sandbox` too.");
  // Nothing but the title comes before it: the facts carry the entries' own names.
  expect(brief.slice(0, brief.indexOf("## Untrusted entries"))).toBe("# Build demo: Web stack\n\n");
  expect(brief.indexOf("- Stack: Web stack")).toBeGreaterThan(brief.indexOf("Then start."));
  expect(renderBrief(await composed({ with: ["hooks-a"] }), context()).text).not.toContain(
    "Untrusted",
  );
});

test("countWords counts fenced text and skips conditional markers [1.1#18]", () => {
  const text = [
    "# Title here",
    "<!-- stacks:when tag=go -->",
    "Two words",
    "<!-- stacks:end -->",
    "```sh",
    "# a comment",
    "go test ./...",
    "```",
    "<!-- stacks:fill one -->",
  ].join("\n");
  // 3 + 2 + 1 + 3 + 3 + 1 + 4 (the fill marker is prose the agent replaces, so it counts).
  expect(countWords(text)).toBe(17);
  expect(countWords("")).toBe(0);
});

test("briefWords counts the whole brief; fixedWords is all of it when entries bring no text [1.1#18] [1.1#21]", async () => {
  const full = renderBrief(await composed({}), context({ written: [".gitignore"] }));
  expect(full.briefWords).toBe(countWords(full.text));
  expect(full.fixedWords).toBeLessThan(full.briefWords);
  const user = temp();
  writeEntry({
    root: user,
    kind: "stack",
    dir: "empty-stack",
    frontmatter: minimal("stack", "empty-stack"),
    body: "",
  });
  const empty = await composed(
    { stack: "empty-stack" },
    { roots: [{ origin: "user", path: user }] },
  );
  const brief = renderBrief(empty, context());
  expect(brief.fixedWords).toBe(brief.briefWords);
  expect(brief.fixedWords).toBe(countWords(brief.text));
  // No deps and no tools: no Dependencies and tools section.
  expect(brief.text).not.toContain("## Dependencies and tools");
});

test("deps merge by role into one line; a missing tool gets its install hint and the --without that drops it [1.1#21]", async () => {
  const composition = await composed({});
  const missing = missingTools(composition, (tool) => tool === "bun-never");
  const brief = renderBrief(composition, context({ missing })).text;
  const deps = section(brief, "## Dependencies and tools");
  expect(deps).toContain("- test: vitest, playwright\n");
  expect(deps).toContain("- `bun`: not found. Install it from https://bun.sh/docs/installation.\n");
  expect(deps).toContain(
    "- `actionlint`: not found. Install it with the system package manager. `--without ci` would have left it out.",
  );
  expect(deps).toContain(
    "- `docker`: not found. Install it from https://docs.docker.com/get-started/get-docker/. `--without docker-deploy` would have left it out.",
  );
  // A hint can mix flags: one fragment the user added, one the stack chose.
  const hints = renderBrief(
    composition,
    context({
      missing: [
        {
          tool: "actionlint",
          owners: [],
          drop: [
            { id: "changelog", flag: "with" },
            { id: "ci", flag: "without" },
          ],
        },
      ],
    }),
  ).text;
  expect(hints).toContain(
    "- `actionlint`: not found. Install it with the system package manager. Dropping `--with changelog` and `--without ci` would have left it out.",
  );
  expect(section(brief, "## Ground rules")).toContain("Some tools weren't on PATH");
  const found = renderBrief(composition, context()).text;
  expect(found).toContain("- `bun`: found on PATH");
  expect(found).not.toContain("weren't on PATH");
});

test("entry headings nest under their section, fenced lines untouched, depth clamped [1.1#22]", () => {
  expect(nest("# Go CLI\n\nIntro.\n\n## Layout\n\n### Tests\n\n```sh\n# comment\n```")).toBe(
    "Intro.\n\n### Layout\n\n#### Tests\n\n```sh\n# comment\n```",
  );
  expect(nest("#### Deep\n\n##### Deeper")).toBe("### Deep\n\n#### Deeper");
  expect(nest("## A\n\n###### F")).toBe("### A\n\n###### F");
  expect(nest("No headings.")).toBe("No headings.");
});

test("a stack body renders under its section without its title, its headings nested [1.1#22]", async () => {
  const brief = renderBrief(await composed({}), context()).text;
  const stack = section(brief, "## Stack: Web stack (`web-stack`)");
  expect(stack).not.toContain("# Web stack\n");
  expect(stack).toContain("\n### Layout\n");
  expect(stack).toContain("\n#### Tests\n");
  expect(stack).toContain("```sh\n# install first\n");
});

test("after green: docs, then a commit message by git state, then the summary [1.1#23]", async () => {
  const composition = await composed({});
  const brief = (git: BriefContext["git"]) => renderBrief(composition, context({ git })).text;
  const fresh = brief({ kind: "fresh" });
  expect(fresh).toContain("### After green");
  expect(fresh).toContain("1. Check that `AGENTS.md` and `README.md`");
  expect(fresh).toContain(
    "2. Commit everything with the message `chore: scaffold demo from the web-stack stack`.",
  );
  expect(fresh).toContain("3. End with a short summary");
  expect(brief({ kind: "parent", toplevel: "/work/mono" })).toContain("2. Don't commit");
  expect(brief({ kind: "parent", toplevel: "/work/mono" })).toContain("`/work/mono`");
  expect(brief({ kind: "none" })).toContain("2. Skip commits (git isn't installed)");
});

test("the command-name line appears only for another invocation; written paths collapse [1.1#24]", async () => {
  const composition = await composed({});
  const npx = renderBrief(composition, context({ invocation: "npx -y stacks@1.2.3" })).text;
  expect(npx).toContain(
    "- Wherever this brief says `stacks <command>`, run `npx -y stacks@1.2.3 <command>`.",
  );
  expect(renderBrief(composition, context()).text).not.toContain("Wherever this brief says");
  const written = [1, 2, 3, 4, 5]
    .map((n) => `.claude/hooks/h${n}.ts`)
    .concat("src/a.ts", "src/b.ts");
  expect(collapsePaths(written)).toEqual([".claude/hooks/ (5 files)", "src/a.ts", "src/b.ts"]);
  // A collapsed directory counts as one line of its parent, so `.claude/` stays open here...
  expect(collapsePaths([...written, ".claude/settings.json"])).toEqual([
    ".claude/hooks/ (5 files)",
    ".claude/settings.json",
    "src/a.ts",
    "src/b.ts",
  ]);
  // ...and a large tree still costs one line.
  const tree = [
    ...Array.from({ length: 30 }, (_, n) => `.claude/hooks/h${n}.ts`),
    ...Array.from({ length: 3 }, (_, n) => `.claude/rules/r${n}.md`),
    ...Array.from({ length: 3 }, (_, n) => `.claude/agents/a${n}.md`),
    ".claude/settings.json",
  ];
  expect(collapsePaths(tree)).toEqual([".claude/ (37 files)"]);
  expect(renderBrief(composition, context({ written })).text).toContain(
    "  - `.claude/hooks/` (5 files)\n  - `src/a.ts`\n  - `src/b.ts`\n",
  );
});

test("the realistic typescript-cli stack renders with and without its app, its conditional blocks resolved", async () => {
  const roots = bundledAt(realRegistry);
  const base = await composed({ stack: "typescript-cli" }, { roots });
  const brief = renderBrief(base, context({ project: "chatter" })).text;
  expect(headings(brief)).toEqual([
    "## Your job",
    "## Versions",
    "## Ground rules",
    "## Decisions",
    "## Dependencies and tools",
    "## Stack: TypeScript CLI with Effect (`typescript-cli`)",
    "## Fragment: Effect Schema (`effect-schema`)",
    "## Fragment: Effect testing and development (`effect`)",
    "## Fragment: Git hooks (lefthook) (`git-hooks`)",
    "## Definition of done",
  ]);
  expect(brief).not.toMatch(/stacks:(when|end)/);
  // with=git-hooks kept; tag=cli kept; tag=web and mode=add dropped.
  expect(brief).toContain("already runs `lefthook install`");
  expect(brief).toContain("Use src/schemas for arguments");
  expect(brief).not.toContain("Loaders/actions decode params");
  expect(brief).toContain("| `binary` | check | build | timeout 15m |");
  // A command with a pipe is shown exactly as verify runs it, never escaped for a table.
  expect(brief).toContain(
    "\n# git-hooks-configured\ngrep -Eq '^(pre-commit|commit-msg|pre-push):' lefthook.yml\n",
  );
  expect(brief).not.toContain("\\|");
  const without = renderBrief(
    await composed({ stack: "typescript-cli", without: ["git-hooks"] }, { roots }),
    context(),
  ).text;
  expect(without).not.toContain("already runs `lefthook install`");

  const withApp = await composed(
    { stack: "typescript-cli", with: ["openrouter-chat-cli"] },
    { roots },
  );
  const app = renderBrief(withApp, context({ project: "chatter" })).text;
  expect(headings(app).slice(-2)).toEqual([
    "## Definition of done: base",
    "## Then: the application",
  ]);
  const baseDone = section(app, "## Definition of done: base");
  expect(baseDone).toContain("--skip-tag app");
  expect(baseDone).not.toContain("app-stub");
  const application = section(app, "## Then: the application");
  expect(application).toContain("### Application steps");
  expect(rows(application).map((row) => row.split(" | ")[0])).toContain("| `app-stub`");
  expect(app).not.toMatch(/stacks:(when|end)/);
});
