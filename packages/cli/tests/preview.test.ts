import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Effect, Exit, Schema } from "effect";
import { Command } from "effect/cli";
import { TestClock } from "effect/testing";
import { afterEach, expect, test } from "vitest";
import { cli } from "../src/cli";
import * as T from "../src/core/brief/text";
import { countWords } from "../src/core/brief/words";
import { canonicalContext } from "../src/core/validate/budget";
import { NewResult } from "../src/schemas/new";
import { BriefPreview, Finding, ValidateReport } from "../src/schemas/validate";
import { VERSION } from "../src/version";
import { quiet, runCli, terminal } from "./helpers/cli";
import { bundledAt, composeExit } from "./helpers/compose";
import { spawnGit } from "./helpers/git";
import { minimal, writeEntry } from "./helpers/registry";
import { reviewSearchFixture } from "./helpers/search-fixture";
import {
  failure,
  fingerprintFor,
  bundledFragment as fragment,
  previewResult,
  settings,
  shipped,
  showReport,
  snapshot,
  bundledStack as stack,
  success,
} from "./helpers/show-preview";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());
function fixture() {
  const home = space.dir();
  const registry = space.dir();
  const entry = stack(registry);
  reviewSearchFixture(registry);
  const preview = (args: string[] = []) =>
    runCli(["validate", "--brief", "sample", ...args, "--json"], {
      home,
      env: quiet,
      host: { registry },
    });
  return { home, registry, entry, preview };
}
const decodeFindings = (value: unknown) =>
  Schema.decodeUnknownSync(Schema.Struct({ findings: Schema.Array(Finding) }))(value).findings;
const findingsKey = (value: unknown) =>
  decodeFindings(value).map(({ check, severity, kind, entry }) => ({
    check,
    severity,
    kind,
    entry,
  }));

// canonicalContext fixes environment facts, but carries no year. Use a fixed TestClock year
// for new's templates and timestamps while exercising the real parser and git process.
test("sandbox preview equals the scaffolded canonical brief and its content fingerprint [3.1a#6]", async () => {
  const { home, registry, entry } = fixture();
  shipped(entry, "files/README.md.tmpl", "# {{ project_name }} ({{ year }})\n");
  shipped(entry, "adapters/claude/CLAUDE-ADAPTER.md", "Follow the brief.\n");
  const composed = await composeExit(
    { stack: "sample", preset: "sandbox" },
    { roots: bundledAt(registry) },
  );
  if (Exit.isFailure(composed)) throw new Error("Fixture did not compose");
  const context = canonicalContext(composed.value);
  const args = ["new", "sample", context.project, "--sandbox", "--no-launch", "--json"];
  const newRun = await runCli(args, {
    home,
    env: {
      ...quiet,
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      XDG_STATE_HOME: join(home, "state"),
    },
    host: { registry, invocation: context.invocation },
    program: Effect.gen(function* () {
      yield* TestClock.setTime(Date.UTC(2000, 0, 1));
      yield* Command.runWith(cli, { version: VERSION, renderErrors: false })(args);
    }).pipe(Effect.provide(TestClock.layer())),
  });
  success(newRun);
  const created = Schema.decodeUnknownSync(NewResult)(JSON.parse(newRun.stdout));
  expect(created.git).toBe("fresh");
  expect(created.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(existsSync(join(home, context.project, ".git"))).toBe(true);
  const previewRun = await runCli(["validate", "--brief", "sample", "--sandbox", "--json"], {
    home,
    env: quiet,
    host: { registry },
  });
  const preview = previewResult(previewRun);
  expect(preview.brief).toBe(readFileSync(join(home, context.project, created.brief), "utf8"));
  expect(preview.briefWords).toBe(countWords(preview.brief));
  expect(preview).toMatchObject({ fingerprint: created.fingerprint, findings: [] });
});

test("preview ignores always and selects only Settings.agents[0] for adapters [3.1a#7]", async () => {
  const { home, registry, entry, preview } = fixture();
  fragment(registry, "ci-github", "", "# PERSONAL CI BODY MUST STAY OUT\n");
  shipped(entry, "adapters/claude/CLAUDE-ADAPTER.md");
  shipped(entry, "adapters/codex/CODEX-ADAPTER.md");
  settings(home, { always: ["ci-github"], agents: ["codex", "claude"] });
  const report = previewResult(await preview());
  expect(report.fragments).toEqual([]);
  expect(report.brief).not.toContain("PERSONAL CI BODY MUST STAY OUT");
  expect(report.brief).toContain("CODEX-ADAPTER.md");
  expect(report.brief).not.toContain("CLAUDE-ADAPTER.md");
  expect(report).toMatchObject({
    fingerprint: await fingerprintFor(registry, { preset: "default", agents: ["codex"] }),
    findings: [],
  });
});

test("over-cap previews keep the full JSON result and end stderr with ValidationFailed [3.1a#8]", async () => {
  const { registry, preview } = fixture();
  stack(registry, "sample", "", `## Setup\n\n${"word ".repeat(6100)}\n`);
  const result = await preview(["--sandbox"]);
  expect(result.status).toBe(2);
  const report = Schema.decodeUnknownSync(BriefPreview)(JSON.parse(result.stdout));
  expect(report.brief).toContain("word ".repeat(6100));
  expect(report.briefWords).toBe(countWords(report.brief));
  expect(report.briefWords).toBeGreaterThan(report.limit);
  expect(findingsKey(report)).toEqual([
    { check: "budget-body", severity: "error", kind: "stack", entry: "sample" },
    { check: "budget-composed", severity: "error", kind: "stack", entry: "sample" },
  ]);
  expect(result.stderr.trim().split("\n")).toHaveLength(1);
  const envelope: unknown = JSON.parse(result.stderr.trim().split("\n").at(-1) ?? "");
  expect(envelope).toMatchObject({
    error: { tag: "ValidationFailed", retryable: false, details: { errors: 2, warnings: 0 } },
  });
});

test("explicit --with or --without previews retain over-limit sizes without a composed budget error", async () => {
  const { registry, preview } = fixture();
  const defaults = ["one", "two", "three", "four", "five", "six", "seven"];
  stack(
    registry,
    "sample",
    `fragments:\n  default: [${defaults.join(", ")}]\n  optional: [extra]`,
    `## Setup\n\n${"word ".repeat(1000)}\n`,
  );
  for (const id of defaults) fragment(registry, id, "", "word ".repeat(850));
  fragment(registry, "extra");
  const baseline = await preview();
  expect(baseline.status).toBe(2);
  const defaultBrief = Schema.decodeUnknownSync(BriefPreview)(JSON.parse(baseline.stdout));
  expect(findingsKey(defaultBrief)).toEqual([
    { check: "budget-composed", severity: "error", kind: "stack", entry: "sample" },
  ]);
  expect(JSON.parse(baseline.stderr)).toMatchObject({
    error: { tag: "ValidationFailed", details: { errors: 1, warnings: 0 } },
  });
  for (const args of [
    ["--with", "extra"],
    ["--without", "one"],
  ]) {
    const report = previewResult(await preview(args));
    expect(report.briefWords).toBe(countWords(report.brief));
    expect(report.briefWords).toBeGreaterThan(report.limit);
    expect(report.findings).toEqual([]);
  }
});

test.each(["show", "preview"])(
  "%s never executes git, tools, agents or entry commands [3.1a#9]",
  async (command) => {
    const { home, registry } = fixture();
    const bin = join(home, "bin");
    const marker = join(home, "process-started");
    mkdirSync(bin);
    for (const name of ["git", "review-tool", "claude", "codex", "entry-command"]) {
      const path = join(bin, name);
      // tempDir paths contain no shell metacharacters; entry text never enters this script.
      writeFileSync(path, `#!/bin/sh\nprintf started >> '${marker}'\nexit 0\n`);
      chmodSync(path, 0o755);
    }
    fragment(
      registry,
      "helper",
      'verify:\n  - { name: entry-check, layer: check, run: "entry-command" }',
    );
    const entry = stack(
      registry,
      "sample",
      "tools: [review-tool]\ncommands:\n  entry-command: entry-command\nfragments:\n  default: [helper]",
    );
    const markdown = join(entry, "STACK.md");
    writeFileSync(
      markdown,
      readFileSync(markdown, "utf8").replaceAll('run: "true"', 'run: "entry-command"'),
    );
    reviewSearchFixture(registry);
    const args =
      command === "show"
        ? ["show", "sample", "--json"]
        : ["validate", "--brief", "sample", "--json"];
    const result = await runCli(args, {
      home,
      env: { ...quiet, PATH: bin },
      host: { registry, ...terminal, stdinIsTTY: true },
    });
    expect(existsSync(marker)).toBe(false);
    if (command === "show") await showReport(result);
    else expect(previewResult(result)).toMatchObject({ findings: [] });
  },
);

test("a fragment cannot be previewed as a stack; unknown preview ids still get suggestions [3.1a#10] [3.1a#11]", async () => {
  const { home, registry } = fixture();
  fragment(registry, "helper");
  for (const [id, tag, details] of [
    ["helper", "BadInput", { id: "helper" }],
    ["sampl", "NotFound", { id: "sampl", suggestions: ["sample"] }],
  ] as const) {
    failure(
      await runCli(["validate", "--brief", id, "--json"], { home, env: quiet, host: { registry } }),
      tag,
      details,
    );
  }
});

test("preview finds a relative registry with spaces through a symlink from another cwd [3.1a#15]", async () => {
  const { home, registry } = fixture();
  const cwd = join(home, "café work");
  mkdirSync(cwd);
  symlinkSync(registry, join(cwd, "linked registry"));
  const bundled = space.dir();
  reviewSearchFixture(bundled);
  const result = await runCli(["validate", "linked registry", "--brief", "sample", "--json"], {
    home,
    env: quiet,
    host: { cwd, registry: bundled },
  });
  expect(previewResult(result)).toMatchObject({
    stack: "sample",
    findings: [
      {
        check: "vocabulary-ignored",
        severity: "note",
        file: "search/vocabulary.json",
        message: "Only the bundled search vocabulary is used; this file is ignored.",
      },
    ],
    fingerprint: await fingerprintFor(registry, { preset: "default" }),
  });
});

test("preview is canonical under agent markers, git variables, a parent repo and --without [3.1a#16]", async () => {
  const { home, registry, entry, preview } = fixture();
  stack(registry, "sample", "tools: [missing-on-this-machine]\nfragments:\n  default: [helper]");
  fragment(registry, "helper", "", "# EXCLUDED HELPER BODY\n");
  shipped(entry, "adapters/claude/CLAUDE-ADAPTER.md");
  shipped(entry, "adapters/codex/CODEX-ADAPTER.md");
  const baseline = previewResult(await preview(["--without", "helper"]));
  const parent = space.dir();
  const init = spawnGit(["init", "-q", parent]);
  expect(init.error).toBeUndefined();
  expect(init.status).toBe(0);
  const cwd = join(parent, "nested cwd");
  mkdirSync(cwd);
  const changed = previewResult(
    await runCli(["validate", "--brief", "sample", "--without", "helper", "--json"], {
      home,
      env: {
        ...quiet,
        PATH: process.env.PATH,
        CODEX_THREAD_ID: "fixture-agent",
        GIT_DIR: join(parent, ".git"),
        GIT_WORK_TREE: parent,
        XDG_STATE_HOME: "relative-state",
      },
      host: { registry, cwd, invocation: "stacks-custom" },
    }),
  );
  expect(changed).toEqual(baseline);
  expect(changed.brief).not.toContain("EXCLUDED HELPER BODY");
  expect(changed.brief).toContain("CLAUDE-ADAPTER.md");
  expect(changed.brief).not.toContain("CODEX-ADAPTER.md");
  expect(changed).toMatchObject({
    findings: [],
    fingerprint: await fingerprintFor(registry, { preset: "default", without: ["helper"] }),
  });
});

test("preview reports the selected entries' exact findings and keeps warning-only results successful [3.1a#17]", async () => {
  const { registry, entry, preview } = fixture();
  // A selected warning and an unrelated invalid decision distinguish filtering from validating
  // the entire registry. The default helper is explicitly excluded.
  fragment(registry, "helper", "decisions: [Undecided]");
  stack(registry, "sample", "fragments:\n  default: [helper]");
  shipped(entry, "files/README.md", "Read me.\n");
  fragment(registry, "warning", 'verify:\n  - { name: extra-check, run: "true" }');
  stack(registry, "unrelated", "decisions: [Undecided]");
  const report = previewResult(await preview(["--without", "helper", "--with", "warning"]));
  expect(report.fragments).toEqual(["warning"]);
  expect(findingsKey(report)).toEqual([
    { check: "step-layer", severity: "warning", kind: "fragment", entry: "warning" },
  ]);
  expect(report).toHaveProperty(
    "fingerprint",
    await fingerprintFor(registry, { preset: "default", with: ["warning"], without: ["helper"] }),
  );
});

test("preview keeps the user's --with and --without warnings as warnings, as new does", async () => {
  const { registry, preview } = fixture();
  stack(registry, "other-stack");
  fragment(registry, "elsewhere", "applies_to: [other-stack]");
  fragment(registry, "unlisted");
  const report = previewResult(await preview(["--with", "elsewhere", "--without", "unlisted"]));
  expect(report.fragments).toEqual(["elsewhere"]);
  expect(report.warnings).toEqual([
    { code: "with_not_applicable", id: "elsewhere" },
    { code: "without_not_selected", id: "unlisted" },
  ]);
  expect(report.findings).toEqual([]);
});

test("an explicitly added app gets a split brief, the 9000-word cap and a fingerprint [3.1a#17]", async () => {
  const { registry, preview } = fixture();
  writeEntry({
    root: registry,
    kind: "fragment",
    dir: "application",
    frontmatter: minimal(
      "fragment",
      "application",
      'applies_to: [sample]\nverify:\n  - { name: application-check, layer: test, run: "entry-command --application" }',
    ).replace("category: tooling", "category: app"),
    body: "# APPLICATION BODY\n",
  });
  reviewSearchFixture(registry);
  const report = previewResult(await preview(["--with", "application", "--sandbox"]));
  expect(report).toMatchObject({
    app: "application",
    fragments: ["application"],
    limit: 9000,
    findings: [],
    fingerprint: await fingerprintFor(registry, { with: ["application"] }),
  });
  expect(report.brief).toContain("APPLICATION BODY");
  const baseStart = report.brief.indexOf(T.done.base);
  const applicationStart = report.brief.indexOf(T.application.heading);
  expect(baseStart).toBeGreaterThan(-1);
  expect(applicationStart).toBeGreaterThan(baseStart);
  const base = report.brief.slice(baseStart, applicationStart);
  const application = report.brief.slice(applicationStart);
  expect(base).toContain("--skip-tag app");
  expect(base).not.toContain("application-check");
  expect(base).not.toContain("entry-command --application");
  expect(application).toContain("application-check");
  expect(application).toContain("entry-command --application");
  expect(application).toContain(T.application.done(`npx -y @steamfield/stacks@${VERSION}`));
  expect(report.brief.indexOf("Build the small public interface.")).toBeLessThan(
    report.brief.indexOf("APPLICATION BODY"),
  );
  expect(report.briefWords).toBe(countWords(report.brief));
});

test("a selected decision error retains the preview and fails validation even below the word cap [3.1a#17]", async () => {
  const { registry, preview } = fixture();
  fragment(
    registry,
    "bad-decision",
    "decisions: [Undecided]",
    "# Selected invalid decision guidance\n",
  );
  const result = await preview(["--with", "bad-decision"]);
  expect(result.status).toBe(2);
  const report = Schema.decodeUnknownSync(BriefPreview)(JSON.parse(result.stdout));
  expect(report.brief).toContain("Selected invalid decision guidance");
  expect(report.briefWords).toBeLessThan(report.limit);
  expect(findingsKey(report)).toEqual([
    { check: "decision-default", severity: "error", kind: "fragment", entry: "bad-decision" },
  ]);
  expect(report).toHaveProperty(
    "fingerprint",
    await fingerprintFor(registry, { preset: "default", with: ["bad-decision"] }),
  );
  expect(result.stderr.trim().split("\n")).toHaveLength(1);
  const envelope: unknown = JSON.parse(result.stderr);
  expect(envelope).toMatchObject({
    error: { tag: "ValidationFailed", retryable: false, details: { errors: 1, warnings: 0 } },
  });
});

test("text previews keep stdout equal to the brief and put the size report on stderr [3.1a#18]", async () => {
  const { home, registry, preview } = fixture();
  const expected = previewResult(await preview());
  for (const audience of [terminal, { stdoutIsTTY: false }]) {
    const result = await runCli(["validate", "--brief", "sample"], {
      home,
      env: quiet,
      host: { registry, ...audience },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(expected.brief);
    if (audience.stdoutIsTTY) {
      expect(result.stderr).toContain(expected.briefWords.toLocaleString("en-US"));
      expect(result.stderr).toContain(expected.limit.toLocaleString("en-US"));
    } else expect(result.stderr).toBe("");
  }
});

test.each([
  ["show", "sample"],
  ["validate", "--brief", "sample"],
  ["show", "unknown"],
  ["validate", "--brief", "unknown"],
])("%s %s preserves existing files and state [3.1a#19]", async (...args) => {
  const { home, registry, entry } = fixture();
  mkdirSync(join(home, ".stacks", "state"), { recursive: true });
  writeFileSync(join(home, ".stacks", "state", "runs.jsonl"), "partial prior run\n");
  mkdirSync(join(home, ".git"));
  writeFileSync(join(home, ".git", "HEAD"), "broken git state\n");
  shipped(entry, "files/README.md.tmpl", "# {{ project_name }}\n");
  const before = { home: snapshot(home), registry: snapshot(registry) };
  const result = await runCli([...args, "--json"], { home, env: quiet, host: { registry } });
  expect({ home: snapshot(home), registry: snapshot(registry) }).toEqual(before);
  if (args.includes("unknown")) failure(result, "NotFound");
  else if (args[0] === "show") await showReport(result);
  else expect(previewResult(result)).toMatchObject({ findings: [] });
});

test("conflicting preview fragments fail with ComposeConflict and no result or writes [3.1a#20]", async () => {
  const { home, registry } = fixture();
  fragment(registry, "first", "conflicts: [second]");
  fragment(registry, "second");
  const before = snapshot(home);
  const result = await runCli(
    ["validate", "--brief", "sample", "--with", "first,second", "--json"],
    { home, env: quiet, host: { registry } },
  );
  failure(result, "ComposeConflict", { reason: "conflicts", ids: ["first", "second"] });
  expect(snapshot(home)).toEqual(before);
});

// This assertion runs before missing functionality can hide fixture problems: a clean fixture
// must pass the shipped registry validator with the exact empty finding set.
test("the preview fixture starts with no validation findings", async () => {
  const { home, registry } = fixture();
  const result = await runCli(["validate", "--json"], { home, env: quiet, host: { registry } });
  success(result);
  const report = Schema.decodeUnknownSync(ValidateReport)(JSON.parse(result.stdout));
  expect(report.findings).toEqual([]);
});
