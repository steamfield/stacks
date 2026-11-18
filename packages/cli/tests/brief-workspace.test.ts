import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Manifest } from "@steamfield/stacks-format";
import { Effect, Exit, Schema } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import { nest } from "../src/core/brief/headings";
import { renderBrief } from "../src/core/brief/render";
import { renderAddBrief } from "../src/core/brief/render-add";
import type { BriefContext } from "../src/core/brief/types";
import { countWords } from "../src/core/brief/words";
import { compose } from "../src/core/compose/compose";
import type { ComposeOptions, Composition } from "../src/core/compose/types";
import { MANIFEST_PATH } from "../src/core/project/manifest";
import type { Entry } from "../src/core/registry/entry";
import { Registry } from "../src/core/registry/registry";
import { BriefPreview } from "../src/schemas/validate";
import { quiet, runCli } from "./helpers/cli";
import { bundledAt, composeExit } from "./helpers/compose";
import { writeEntry } from "./helpers/registry";
import { newWorkspace, workspaceRegistry, workspaceVariant } from "./helpers/workspace";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function variant(edit: (root: string) => void): string {
  const { root, cleanup } = workspaceVariant(edit);
  cleanups.push(cleanup);
  return root;
}

async function pair(
  options: Partial<Omit<ComposeOptions, "always" | "agents">> = {},
  root = workspaceRegistry,
): Promise<Composition> {
  const exit = await composeExit({ stack: "pair", ...options }, { roots: bundledAt(root) });
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
const brief = async (options: Parameters<typeof pair>[0] = {}, root?: string) =>
  renderBrief(await pair(options, root), context());

/** The brief's level-2 headings, in order. */
const headings = (text: string) => text.split("\n").filter((line) => line.startsWith("## "));
/** The text from `heading` up to the next level-2 heading. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n${heading}\n`);
  if (start === -1) throw new Error(`no section ${heading}`);
  const end = text.indexOf("\n## ", start + heading.length + 2);
  return text.slice(start + 1, end === -1 ? undefined : end + 1);
}
/** A section's first non-blank line after its heading. */
const firstLine = (text: string, heading: string) =>
  section(text, heading)
    .split("\n")
    .slice(1)
    .find((line) => line.trim() !== "");
/** The facts block: the lines starting with `- ` right after `## Facts`. */
const factLines = (text: string) =>
  section(text, "## Facts")
    .split("\n")
    .filter((line) => line.startsWith("- "));
/** The guidance region: from the stack's section up to the definition of done. */
function guidance(text: string): string {
  const start = text.indexOf("\n## Stack: ");
  const end = text.indexOf("\n## Definition of done");
  if (start === -1 || end === -1) throw new Error("no guidance region");
  return text.slice(start + 1, end + 1);
}

const STACK = "## Stack: Pair (`pair`)";
const BACKEND = "## Part: API part (`api-part`) in `backend/`";
const FRONTEND = "## Part: Web part (`web-part`) in `frontend/`";
const LINK = "## Link: Client link (`client-link`)";
const DB = "## Fragment: Database (`db`)";
const HARNESS = "## Fragment: Harness (`harness`)";
const ROOT_CI = "## Fragment: Root CI (`root-ci`)";

const partLine = (dir: string) =>
  `This part lives in \`${dir}/\`. Paths and commands in this section are relative to \`${dir}/\` and run there. The workspace's Setup sets the order of setup and replaces this section's own setup and verify lines. \`README.md\`, \`.env.example\`, \`AGENTS.md\` and \`CLAUDE.md\` named here are this part's copies in \`${dir}/\`, not the root's.`;
const LINK_LINE =
  "In this section the API part is `backend/` and the client part is `frontend/`. Paths and commands are relative to `frontend/` and run there.";
const placedLine = (dir: string) =>
  `This fragment is placed on the part in \`${dir}/\`. Paths and commands in this section are relative to \`${dir}/\` and run there.`;
const INSTALL_PARTS =
  "1. Install the packages under Dependencies and tools at their latest versions with each part's own package manager, in that part's directory: a role named `<part>-<role>` belongs to the part in `<part>/`.";
const WORKSPACE_ROOT =
  "- Project root: the directory containing `.stacks/`. Run root commands there; a Part, Link or placed Fragment section says where its own commands run.";

describe("section order", () => {
  test("workspace, each part in parts order, the link, then the other fragments", async () => {
    const { text } = await brief();
    const from = headings(text).indexOf(STACK);
    expect(headings(text).slice(from, from + 6)).toEqual([
      STACK,
      BACKEND,
      FRONTEND,
      LINK,
      HARNESS,
      ROOT_CI,
    ]);
    expect(headings(text)[from + 6]).toBe("## Definition of done");
  });

  test("a part-scoped fragment taken with --with comes after the link", async () => {
    const { text } = await brief({ with: ["db"] });
    const from = headings(text).indexOf(STACK);
    expect(headings(text).slice(from, from + 7)).toEqual([
      STACK,
      BACKEND,
      FRONTEND,
      LINK,
      DB,
      HARNESS,
      ROOT_CI,
    ]);
  });
});

describe("the fixed opening lines", () => {
  test("each part opens with its part line, the link with the link line, a placed fragment with the placed line", async () => {
    const { text } = await brief({ with: ["db"] });
    expect(firstLine(text, BACKEND)).toBe(partLine("backend"));
    expect(firstLine(text, FRONTEND)).toBe(partLine("frontend"));
    expect(firstLine(text, LINK)).toBe(LINK_LINE);
    expect(firstLine(text, DB)).toBe(placedLine("backend"));
    // Root fragments open with their own body.
    expect(firstLine(text, HARNESS)).toBe("Keep the guard hook in place.");
    expect(firstLine(text, ROOT_CI)).toBe("CI runs from the project root.");
    // The workspace's own section has no fixed line either.
    expect(firstLine(text, STACK)).toBe("### How the parts connect");
  });

  test("a part section holds its line, then the part's own body as mounted", async () => {
    const { text } = await brief();
    expect(section(text, BACKEND)).toBe(
      [
        BACKEND,
        "",
        partLine("backend"),
        "",
        "### Setup",
        "",
        "Install dependencies, then run `bun run dev`.",
        "",
        // `with=root-ci` drops: root-ci is at the root, so the part's context doesn't list it.
        "Bun runs the scripts.",
        "",
        "",
      ].join("\n"),
    );
  });
});

describe("facts", () => {
  test("lists each part with role and stack right after the stack, and uses the workspace root line", async () => {
    const { text } = await brief();
    expect(factLines(text)).toEqual([
      "- Stack: Pair (`pair`)",
      "- Part `backend/`: role `api`, stack `api-part`",
      "- Part `frontend/`: role `web`, stack `web-part`",
      "- Project slug: `demo`; env prefix: `DEMO`",
      "- Fragments: `client-link`, `harness`, `root-ci`",
      "- Preset: default",
      "- Target agents: claude",
      WORKSPACE_ROOT,
    ]);
    expect(text).not.toContain("Run every command from there.");
  });
});

describe("Start here", () => {
  test("step 3 names the Part and Link sections in a workspace", async () => {
    const { text } = await brief();
    expect(section(text, "## Start here")).toContain(
      "\n3. Do what the Stack, Part, Link and Fragment sections ask, taking the Decisions, and replace every `stacks:fill` marker.\n",
    );
  });

  test("step 1 points at the dependency list, never an install command, even for a workspace tagged as a Bun scripts stack", async () => {
    // Each part has its own package manager, so one `bun add` at the root would be wrong.
    const root = variant((at) => {
      const path = join(at, "stacks/pair/STACK.md");
      writeFileSync(
        path,
        readFileSync(path, "utf8").replace("tags: [make]", "tags: [bun, scripts, make]"),
      );
    });
    const { text } = await brief({}, root);
    const start = section(text, "## Start here");
    expect(start).toContain(`\n${INSTALL_PARTS}\n`);
    expect(start).not.toContain("```sh");
    expect(start).not.toContain("bun add");
    expect(section(text, "## Dependencies and tools")).toContain(
      "Packages, by role. Install the current stable version of each; these are names, not versions:",
    );
  });
});

test("an application fragment in a workspace still comes after the definition of done", async () => {
  const root = variant((at) =>
    writeEntry({
      root: at,
      kind: "fragment",
      dir: "pair-app",
      frontmatter: [
        "schema_version: 1",
        "id: pair-app",
        "kind: fragment",
        "category: app",
        "name: Pair app",
        "description: An application built on the pair workspace.",
        "applies_to: [pair]",
        "verify:",
        '  - { name: app-ok, layer: check, run: "true" }',
      ].join("\n"),
      body: "# Pair app\n\nBuild the notes app across both parts.\n",
    }),
  );
  const { text } = await brief({ with: ["pair-app"] }, root);
  const all = headings(text);
  expect(all.indexOf("## Definition of done: base")).toBeGreaterThan(all.indexOf(ROOT_CI));
  expect(all.indexOf("## Then: the application")).toBeGreaterThan(
    all.indexOf("## Definition of done: base"),
  );
  expect(all).not.toContain("## Fragment: Pair app (`pair-app`)");
  expect(section(text, "## Then: the application")).toContain(
    "Build the notes app across both parts.",
  );
  expect(section(text, "## Start here")).toContain(
    "\n3. Do what the Stack, Part, Link and Fragment sections ask, taking the Decisions, then the application, and replace every `stacks:fill` marker.\n",
  );
});

describe("word counts", () => {
  /** The composition rendered as if it had no parts: no part sections, no mounts. */
  const unmounted = (composition: Composition): Composition => {
    const { parts: _parts, ...rest } = composition;
    return {
      ...rest,
      fragments: composition.fragments.map(({ mount: _mount, ...entry }) => entry),
    };
  };
  /** The words the brief takes from entries and the composition rather than CLI text. */
  const dataWords = (counts: { briefWords: number; fixedWords: number }) =>
    counts.briefWords - counts.fixedWords;
  const bodyWords = (entries: ReadonlyArray<Entry>) =>
    entries.reduce((sum, entry) => sum + countWords(nest(entry.body)), 0);

  test("fixedWords grows by exactly the new fixed lines, and part bodies count as data", async () => {
    const composition = await pair({ with: ["db"] });
    const workspace = renderBrief(composition, context());
    const plain = renderBrief(unmounted(composition), context());
    const added = [
      BACKEND,
      partLine("backend"),
      FRONTEND,
      partLine("frontend"),
      LINK,
      LINK_LINE,
      placedLine("backend"),
      "- Part `backend/`: role `api`, stack `api-part`",
      "- Part `frontend/`: role `web`, stack `web-part`",
      WORKSPACE_ROOT,
      INSTALL_PARTS,
      "3. Do what the Stack, Part, Link and Fragment sections ask, taking the Decisions, and replace every `stacks:fill` marker.",
    ];
    const replaced = [
      "1. Install the packages under Dependencies and tools at their latest versions with the stack's package manager.",
      "## Fragment: Client link (`client-link`)",
      "- Project root: the directory containing `.stacks/`. Run every command from there.",
      "3. Do what the Stack and Fragment sections ask, taking the Decisions, and replace every `stacks:fill` marker.",
    ];
    const words = (lines: ReadonlyArray<string>) => countWords(lines.join("\n"));
    expect(workspace.fixedWords - plain.fixedWords).toBe(words(added) - words(replaced));
    const parts = (composition.parts ?? []).flatMap((part) => (part.entry ? [part.entry] : []));
    expect(dataWords(workspace) - dataWords(plain)).toBe(bodyWords(parts));
  });

  test("briefWords minus fixedWords is the bodies' words plus the composition's own data", async () => {
    const emptied = variant((at) => {
      for (const file of [
        "stacks/pair/STACK.md",
        "stacks/api-part/STACK.md",
        "stacks/web-part/STACK.md",
        "fragments/client-link/FRAGMENT.md",
        "fragments/harness/FRAGMENT.md",
        "fragments/root-ci/FRAGMENT.md",
        "fragments/db/FRAGMENT.md",
      ]) {
        const path = join(at, file);
        const text = readFileSync(path, "utf8");
        writeFileSync(path, text.slice(0, text.indexOf("\n---\n", 4) + 5));
      }
    });
    const composition = await pair({ with: ["db"] });
    const full = renderBrief(composition, context());
    const bare = renderBrief(await pair({ with: ["db"] }, emptied), context());
    expect(full.fixedWords).toBe(bare.fixedWords);
    const entries: Entry[] = [
      composition.stack,
      ...(composition.parts ?? []).flatMap((part) => (part.entry ? [part.entry] : [])),
      ...composition.fragments,
    ];
    expect(dataWords(full) - dataWords(bare)).toBe(bodyWords(entries));
    // With every body empty the guidance region is CLI text only.
    expect(countWords(guidance(bare.text))).toBeGreaterThan(0);
    for (const heading of [BACKEND, FRONTEND, LINK, DB])
      expect(section(bare.text, heading).trim().split("\n").length).toBe(3);
  });
});

describe("the add brief", () => {
  const mounts = [
    { name: "backend", role: "api", stack: "api-part" },
    { name: "frontend", role: "web", stack: "web-part" },
  ];
  test("add db on a workspace project opens db's section with the placed line", async () => {
    const made = await newWorkspace();
    cleanups.push(() => rmSync(dirname(made.target), { recursive: true, force: true }));
    expect(made.result.status).toBe(0);
    const manifest = Schema.decodeUnknownSync(Manifest)(
      JSON.parse(readFileSync(join(made.target, MANIFEST_PATH), "utf8")),
    );
    const composition = await Effect.runPromise(
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
      }).pipe(
        Effect.provide(Registry.layer(bundledAt(workspaceRegistry))),
        Effect.provide(NodeServices.layer),
      ),
    );
    const { text } = renderAddBrief(composition, context(), {
      applied: ["client-link", "harness", "root-ci"],
      stack: "pair",
      mergeNeeded: [],
      missingRequired: [],
      digestRecorded: true,
      manifest,
    });
    // An add brief keeps the fragment's own title under its heading.
    expect(section(text, DB).split("\n").slice(0, 7)).toEqual([
      DB,
      "",
      placedLine("backend"),
      "",
      "### Database",
      "",
      "Run `db-up`, then migrate.",
    ]);
    expect(text).toContain(`\n${WORKSPACE_ROOT}\n`);
    expect(text).not.toContain("Run every command from there.");
  });
});

describe("validate --brief and new agree", () => {
  test("the preview and the brief new writes have the same sections and the same guidance", async () => {
    const preview = await runCli(["validate", "--brief", "pair", "--json"], {
      env: { ...quiet },
      host: { registry: workspaceRegistry },
    });
    // The preview is printed whether or not the registry's own checks pass (a keeps-result tag);
    // which workspace checks pass is validate's to assert, not the brief's.
    const decoded = Schema.decodeUnknownSync(BriefPreview)(JSON.parse(preview.stdout));
    const made = await newWorkspace();
    cleanups.push(() => rmSync(dirname(made.target), { recursive: true, force: true }));
    expect(made.result.status).toBe(0);
    const written = readFileSync(join(made.target, ".stacks/BRIEF.md"), "utf8");
    expect(headings(decoded.brief)).toEqual(headings(written));
    expect(guidance(decoded.brief)).toBe(guidance(written));
    for (const heading of [BACKEND, FRONTEND, LINK])
      expect(firstLine(written, heading)).toBe(firstLine(decoded.brief, heading));
    expect(factLines(written).slice(0, 3)).toEqual(factLines(decoded.brief).slice(0, 3));
  });
});
