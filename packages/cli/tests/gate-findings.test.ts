import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { quiet, runCli, tempDir } from "./helpers/cli";
import { gitShim } from "./helpers/git";

// Briefs as the 1.6b gate runs composed them (`new <stack> --sandbox`). Each test pins a place
// where a run's agent stopped, guessed or worked around the brief.
const bundled = join(import.meta.dirname, "..", "registry");

// The preview is read-only and deterministic, so each stack's brief is composed once per file
// rather than once per test (about thirty full validations otherwise, slow under the full gate).
const briefs = new Map<string, Promise<string>>();
function brief(stack: string): Promise<string> {
  const cached = briefs.get(stack);
  if (cached) return cached;
  const composed = runCli(["validate", "--brief", stack, "--sandbox", "--json"], {
    env: { ...quiet, PATH: process.env.PATH ?? "" },
    host: { registry: bundled },
  }).then((result) => {
    expect(result.status).toBe(0);
    return (JSON.parse(result.stdout) as { brief: string }).brief;
  });
  briefs.set(stack, composed);
  return composed;
}

test("go-cli gives a module path to fall back on instead of stopping to ask for an owner", async () => {
  const text = await brief("go-cli");
  expect(text).not.toContain("Ask if neither exists");
  expect(text).toMatch(/If neither exists, keep the bare `<project-slug>`/);
});

test("astro-blog ships the generator output without a create-astro invocation", async () => {
  const text = await brief("astro-blog");
  // `bun create astro -y`: bun takes -y itself and fails with "Invalid Argument '-y'".
  expect(text).not.toContain("`bun create astro`");
  expect(text).not.toContain("bunx create-astro");
  expect(JSON.parse(await astroFile("package.json")).name).toBe("app");
  expect(await astroFile("astro.config.mjs")).toContain("integrations:");
});

test("astro-blog says tests importing astro:content run in the node environment", async () => {
  expect(await astroFile("src/content/schema.test.ts")).toMatch(/^\/\/ @vitest-environment node/);
  expect(await astroFile("docs/DEVELOPMENT.md")).toContain("astro:content");
});

test.each(["astro-blog", "python-react"])(
  "%s keeps Prettier off .stacks/ and .claude/",
  async (stack) => {
    if (stack === "astro-blog") {
      const ignored = await astroFile(".prettierignore");
      expect(ignored).toContain(".stacks/");
      expect(ignored).toContain(".claude/");
    } else {
      expect(await brief(stack)).toMatch(/`\.prettierignore`[^\n]*`\.stacks\/`[^\n]*`\.claude\/`/);
    }
  },
);

test("the sandbox CI workflow pins a release tag when an action publishes no major tag", async () => {
  const text = await brief("python-react");
  expect(text).not.toContain("Major-tag action refs are fine;");
  expect(text).toContain("pin its latest release tag");
});

test.each(["astro-blog", "go-cli", "python-react"])(
  "%s tells the agent edits under .claude/ and to lefthook.yml need the user's approval",
  async (stack) => {
    expect(await brief(stack)).toMatch(
      /Claude Code asks the user before any edit under `\.claude\/` or to `lefthook\.yml`/,
    );
  },
);

test("agent-ops says a formatter alone doesn't count as the linter lint-on-write runs", async () => {
  expect(await brief("astro-blog")).toContain("a formatter alone doesn't count");
});

test("astro-blog lists Testing Library's dom peer and the test types tsconfig needs", async () => {
  const text = await brief("astro-blog");
  expect(text).toContain(" @testing-library/dom,");
  expect(JSON.parse(await astroFile("tsconfig.json")).compilerOptions.types).toEqual([
    "vitest/globals",
    "@testing-library/jest-dom",
  ]);
});

test("go-cli's main passes the version variables to cli.Execute itself", () => {
  // The stack ships main.go, so the call the agent once got wrong is now in the file itself.
  const main = readFileSync(join(bundled, "stacks/go-cli/files/main.go.tmpl"), "utf8");
  expect(main).toContain("cli.Execute(version, commit, date)");
});

test("python-react's error envelope follows the wire casing", async () => {
  expect(await brief("python-react")).toMatch(/"requestId"\}\}`[^\n]*`request_id`/);
});

test("python-react runs dump_openapi.py as a module so it can import app", async () => {
  expect(await brief("python-react")).toContain("`uv run python -m scripts.dump_openapi`");
});

test("git-hooks keeps a staged-file linter quiet about files its config ignores", async () => {
  expect(await brief("python-react")).toContain("`--no-warn-ignored`");
});

/** `new <stack> app --sandbox` from the bundled registry, with a git shim on PATH. */
async function scaffold(stack: string) {
  const home = tempDir();
  dirs.push(home);
  const bin = gitShim(
    home.path,
    [
      '  rev-parse) echo "fatal: not a git repository" >&2; exit 128 ;;',
      "  init) /bin/mkdir .git ;;",
      "  config) exit 0 ;;",
    ].join("\n"),
  );
  const result = await runCli(["new", stack, "app", "--sandbox", "--no-launch", "--json"], {
    home: home.path,
    env: { ...quiet, PATH: bin },
    host: { registry: bundled, cwd: home.path },
  });
  expect(result.status).toBe(0);
  return join(home.path, "app");
}
const dirs: ReturnType<typeof tempDir>[] = [];
let astroProject: Promise<string> | undefined;
async function astroFile(path: string) {
  astroProject ??= scaffold("astro-blog");
  return readFileSync(join(await astroProject, path), "utf8");
}
afterAll(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});

test.each([
  ["astro-blog", ["lint", "check", "test", "coverage", "build", "format"]],
  [
    "go-cli",
    [
      "vet",
      "lint",
      "fmt",
      "fmt-check",
      "test",
      "test-integration",
      "coverage",
      "build",
      "smoke",
      "ci",
    ],
  ],
])(
  "%s ships allow rules for its make targets, so the agent needn't edit .claude/settings.json",
  async (stack, targets) => {
    const settings = JSON.parse(
      readFileSync(join(await scaffold(stack), ".claude", "settings.json"), "utf8"),
    ) as { permissions: { allow: string[] } };
    for (const target of targets)
      expect(settings.permissions.allow).toContain(`Bash(make ${target})`);
  },
);

test.each(["astro-blog", "go-cli", "python-react"])(
  "%s's brief says its make targets are already allowed",
  async (stack) => {
    expect(await brief(stack)).toContain(
      "merges in allow rules for its non-destructive root scripts",
    );
  },
);

test("python-react's Makefile runs dump_openapi as the module the brief names", async () => {
  const makefile = readFileSync(join(await scaffold("python-react"), "Makefile"), "utf8");
  expect(makefile).not.toContain("python scripts/dump_openapi.py");
  expect(makefile).toContain("uv run python -m scripts.dump_openapi");
});

test("astro-blog keeps astro:content out of the post logic the unit tests cover", async () => {
  expect(await astroFile("src/lib/posts.ts")).not.toContain("astro:content");
  expect(await astroFile("src/lib/collection.ts")).toContain('from "astro:content"');
});

test("astro-blog builds canonical URLs without file-style output's .html", async () => {
  const layout = await astroFile("src/layouts/BaseLayout.astro");
  expect(layout).toContain("new URL(path, site.url)");
  expect(layout).not.toContain("Astro.url.pathname");
  expect(await astroFile("src/layouts/PostLayout.astro")).toContain("slugFor(post)");
});

test("astro-blog's vitest.config.ts references vitest's config types", async () => {
  expect(await astroFile("vitest.config.ts")).toContain('/// <reference types="vitest/config" />');
});

test("CI triggers on the branch the new repo is actually on, not an assumed main", async () => {
  expect(await brief("astro-blog")).toContain(
    "`push` to the repo's current branch (`git branch --show-current`; `new` keeps git's default name)",
  );
});

test("astro-blog names the pure post functions in posts.ts and the getters in collection.ts", async () => {
  expect(await astroFile("src/lib/posts.ts")).toMatch(/export function publishedPosts/);
  expect(await astroFile("src/lib/posts.ts")).toMatch(/export function routablePosts/);
  expect(await astroFile("src/lib/collection.ts")).toMatch(
    /export async function getPublishedPosts\(\)/,
  );
  expect(await astroFile("src/lib/collection.ts")).toMatch(
    /export async function getRoutablePosts\(\)/,
  );
});

test("astro-blog allows make new-article, so the agent needn't edit .claude/settings.json", async () => {
  const settings = JSON.parse(
    readFileSync(join(await scaffold("astro-blog"), ".claude", "settings.json"), "utf8"),
  ) as { permissions: { allow: string[] } };
  expect(settings.permissions.allow).toContain("Bash(make new-article *)");
});

test("astro-blog's analytics keeps one pre-init buffer, in the module islands import", async () => {
  const text = await brief("astro-blog");
  expect(text).not.toContain("window.posthog");
  expect(text).toContain("Islands import `track()` from the module");
});

test("python-react's Makefile type-checks the backend scripts too", async () => {
  const makefile = readFileSync(join(await scaffold("python-react"), "Makefile"), "utf8");
  expect(makefile).toContain("uv run mypy app tests scripts");
});
