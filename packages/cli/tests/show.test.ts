import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { countWords } from "../src/core/brief/words";
import { BUDGET } from "../src/core/validate/compositions/budget";
import { quiet, runCli, terminal } from "./helpers/cli";
import { ledgerRecord, writeLedger } from "./helpers/ledger";
import { adapterRegistry } from "./helpers/native-adapters";
import { minimal, writeEntry } from "./helpers/registry";
import { reviewSearchFixture } from "./helpers/search-fixture";
import {
  failure,
  fingerprintFor,
  fragment,
  previewResult,
  shipped,
  showReport,
  stack,
} from "./helpers/show-preview";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

test("show labels both bundled library payloads and explains how to omit the example", async () => {
  const home = space.dir();
  const registry = adapterRegistry;
  const report = await showReport(
    await runCli(["show", "typescript-library", "--json"], {
      home,
      env: quiet,
      host: { registry },
    }),
  );
  expect(report).toHaveProperty("payloads", ["example", "none"]);
  const payloadFiles = report.files.filter((file) => file.source.startsWith("payloads/"));
  expect(payloadFiles.length).toBeGreaterThan(0);
  for (const file of payloadFiles) {
    const variant = file.source.split("/")[1];
    expect(file).toHaveProperty("payload", variant);
    expect(file.path).toBe(
      file.source
        .split("/")
        .slice(2)
        .join("/")
        .replace(/\.tmpl$/, ""),
    );
    expect(file).not.toHaveProperty("agent");
    expect(file).not.toHaveProperty("stack");
  }
  for (const file of report.files.filter((file) => !file.source.startsWith("payloads/")))
    expect(file).not.toHaveProperty("payload");
  for (const audience of [terminal, { stdoutIsTTY: false }]) {
    const result = await runCli(["show", "typescript-library"], {
      home,
      env: quiet,
      host: { registry, ...audience },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      "Payloads: example (default), none. Pass --payload none to start without the example.",
    );
    expect(result.stdout).toContain(
      "README.md (payload example) <- payloads/example/README.md.tmpl",
    );
    expect(result.stdout).toContain("README.md (payload none) <- payloads/none/README.md.tmpl");
  }
});

test("a stack without payloads omits the payloads key, row labels and payload hint", async () => {
  const { home, registry, entry, show } = fixture();
  shipped(entry, "files/README.md");
  const report = await showReport(await show(["sample"]));
  expect(report).not.toHaveProperty("payloads");
  expect(report.files).toEqual([{ source: "files/README.md", path: "README.md" }]);
  for (const audience of [terminal, { stdoutIsTTY: false }]) {
    const result = await runCli(["show", "sample"], {
      home,
      env: quiet,
      host: { registry, ...audience },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("Payloads:");
    expect(result.stdout).not.toContain("--payload");
    expect(result.stdout).not.toContain("(payload ");
  }
});

function fixture() {
  const home = space.dir();
  const registry = space.dir();
  const entry = stack(registry);
  const show = (args: string[]) =>
    runCli(["show", ...args, "--json"], { home, env: quiet, host: { registry } });
  return { home, registry, entry, show };
}

test("bundled stack metadata and its newest default-composition proof decode as ShowReport [3.1a#1]", async () => {
  const { home, registry, show } = fixture();
  stack(
    registry,
    "sample",
    'fragments:\n  required: [required]\n  default: [helper]\n  optional: [extra]\ntools: [review-tool]\ndeps:\n  app: [toolkit]\ndecisions: [Use the small API (default)]\nenv:\n  APP_PORT: "3000"\ncommands:\n  make-check: Run all checks',
  );
  for (const id of ["required", "helper", "extra"]) fragment(registry, id);
  reviewSearchFixture(registry);
  const record = await ledgerRecord(registry);
  writeLedger(registry, [
    record,
    { ...record, date: "2026-10-25", result: "fail" },
    { ...record, date: "2026-10-29", with: ["extra"], fingerprint: `sha256:${"0".repeat(64)}` },
  ]);
  const report = await showReport(await show(["sample"]));
  expect(report).toMatchObject({
    id: "sample",
    kind: "stack",
    name: "sample name",
    description: "sample description.",
    tags: ["cli", "scripts"],
    deps: { app: ["toolkit"] },
    tools: ["review-tool"],
    decisions: ["Use the small API (default)"],
    env: { APP_PORT: "3000" },
    commands: { "make-check": "Run all checks" },
    origin: "bundled",
    trusted: true,
    shadows: [],
    path: join(registry, "stacks", "sample"),
    fragments: { required: ["required"], default: ["helper"], optional: ["extra"] },
    bodyCap: BUDGET.stackBody,
    briefCap: BUDGET.composed,
    lastRun: {
      date: record.date,
      result: record.result,
      fingerprint: record.fingerprint,
      sameContent: true,
    },
  });
  const preview = previewResult(
    await runCli(["validate", "--brief", "sample", "--json"], {
      home,
      env: quiet,
      host: { registry },
    }),
  );
  expect(report.briefWords).toBe(countWords(preview.brief));
});

test("editing bundled guidance invalidates the recorded content fingerprint on a fresh invocation [3.1a#2]", async () => {
  const { registry, show } = fixture();
  const record = await ledgerRecord(registry);
  writeLedger(registry, [record]);
  expect((await showReport(await show(["sample"]))).lastRun).toMatchObject({ sameContent: true });
  stack(registry, "sample", "", "## Setup\n\nNow build a different public interface.\n");
  expect((await showReport(await show(["sample"]))).lastRun).toMatchObject({
    fingerprint: record.fingerprint,
    sameContent: false,
  });
});

test("user shadows and project entries never inherit a bundled run [3.1a#3]", async () => {
  const { home, registry, show } = fixture();
  const record = await ledgerRecord(registry);
  writeLedger(registry, [record, { ...record, stack: "local" }]);
  const user = join(home, "config", "stacks");
  const userEntry = stack(user);
  writeLedger(user, [record]);
  const projectEntry = stack(join(home, ".stacks"), "local");
  expect(await showReport(await show(["sample"]))).toMatchObject({
    origin: "user",
    trusted: true,
    shadows: ["bundled"],
    path: userEntry,
    lastRun: null,
  });
  expect(await showReport(await show(["local"]))).toMatchObject({
    origin: "project",
    trusted: false,
    path: projectEntry,
    lastRun: null,
  });
});

test("a bundled fragment names the newest containing run's stack and compares that composition [3.1a#4]", async () => {
  const { registry, show } = fixture();
  const sample = stack(registry, "sample", "fragments:\n  default: [helper]");
  shipped(sample, "adapters/claude/CLAUDE.md");
  shipped(sample, "adapters/codex/AGENTS.md");
  const other = stack(registry, "other");
  shipped(other, "adapters/claude/CLAUDE.md");
  shipped(other, "adapters/codex/AGENTS.md");
  fragment(registry, "helper");
  const old = await ledgerRecord(registry);
  const explicit = await ledgerRecord(registry, {
    stack: "other",
    with: ["helper"],
    preset: "default",
    agent: "codex",
    date: "2026-10-28",
    fingerprint: await fingerprintFor(registry, {
      stack: "other",
      with: ["helper"],
      preset: "default",
      agents: ["codex"],
      proof: true,
    }),
  });
  const newest = await ledgerRecord(registry, {
    stack: "sample",
    with: [],
    date: "2026-10-29",
    preset: "default",
    agent: "codex",
    fingerprint: await fingerprintFor(registry, {
      preset: "default",
      agents: ["codex"],
      proof: true,
    }),
    compositionFingerprint: await fingerprintFor(registry, {
      preset: "default",
      agents: ["codex"],
    }),
  });
  writeLedger(registry, [newest, { ...explicit, date: "2026-10-30", with: [] }, explicit, old]);
  const report = await showReport(await show(["helper"]));
  expect(report.lastRun).toMatchObject({
    stack: "sample",
    date: newest.date,
    fingerprint: newest.fingerprint,
    agent: "codex",
    preset: "default",
    sameContent: true,
  });
  fragment(registry, "helper", "", "# Changed fragment guidance\n");
  expect((await showReport(await show(["helper"]))).lastRun).toMatchObject({ sameContent: false });
});

test("every shipped path is reported, including literal dotfiles, templates and all agent adapters [3.1a#5]", async () => {
  const { entry, show } = fixture();
  for (const source of [
    "files/.gitignore",
    "files/README.md.tmpl",
    "files/src/a.ts",
    "files/src/b.ts",
    "adapters/claude/CLAUDE.md.tmpl",
    "adapters/codex/AGENTS.md",
  ])
    shipped(entry, source);
  const report = await showReport(await show(["sample"]));
  expect(report.files).toHaveLength(6);
  expect(report.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: "files/.gitignore", path: ".gitignore" }),
      expect.objectContaining({ source: "files/README.md.tmpl", path: "README.md" }),
      expect.objectContaining({ source: "files/src/a.ts", path: "src/a.ts" }),
      expect.objectContaining({ source: "files/src/b.ts", path: "src/b.ts" }),
      expect.objectContaining({
        source: "adapters/claude/CLAUDE.md.tmpl",
        path: "CLAUDE.md",
        agent: "claude",
      }),
      expect.objectContaining({
        source: "adapters/codex/AGENTS.md",
        path: "AGENTS.md",
        agent: "codex",
      }),
    ]),
  );
});

test("an ambiguous id needs --kind, and an app reports camelCase metadata and matching stacks [3.1a#10]", async () => {
  const { registry, show } = fixture();
  stack(registry, "by-id");
  stack(registry, "by-tag");
  stack(registry, "unrelated", "");
  writeEntry({
    root: registry,
    kind: "fragment",
    dir: "sample",
    frontmatter: minimal(
      "fragment",
      "sample",
      [
        "applies_to: [by-id, cli]",
        "requires: [helper]",
        "conflicts: [extra]",
        "requires_tools: [node]",
        "needs_own_repo: true",
      ].join("\n"),
    ).replace("category: tooling", "category: app"),
  });
  fragment(registry, "helper");
  fragment(registry, "extra");
  // Only by-tag and sample match cli; unrelated intentionally has no matching tag.
  writeEntry({
    root: registry,
    kind: "stack",
    dir: "by-id",
    frontmatter: minimal("stack", "by-id", "tags: [scripts]"),
  });
  writeEntry({
    root: registry,
    kind: "stack",
    dir: "unrelated",
    frontmatter: minimal("stack", "unrelated", "tags: [scripts]"),
  });
  const ambiguous = await show(["sample"]);
  failure(ambiguous, "BadInput");
  expect(ambiguous.stderr).toContain("stack");
  expect(ambiguous.stderr).toContain("fragment");
  expect(await showReport(await show(["sample", "--kind", "stack"]))).toMatchObject({
    kind: "stack",
  });
  expect(await showReport(await show(["sample", "--kind", "fragment"]))).toMatchObject({
    kind: "fragment",
    category: "app",
    appliesTo: ["by-id", "cli"],
    requires: ["helper"],
    conflicts: ["extra"],
    requiresTools: ["node"],
    needsOwnRepo: true,
    fits: ["by-id", "by-tag", "sample"],
    briefWords: null,
    bodyCap: BUDGET.appBody,
    lastRun: null,
  });
});

test("unknown show ids suggest nearby entries [3.1a#11]", async () => {
  const { show } = fixture();
  failure(await show(["sampl"]), "NotFound", { id: "sampl", suggestions: ["sample"] });
});

test("wrong-case YAML metadata is EntryInvalid instead of falling back to a hidden copy [3.1a#12]", async () => {
  const { home, show } = fixture();
  writeEntry({
    root: join(home, "config", "stacks"),
    kind: "stack",
    dir: "sample",
    frontmatter: minimal("stack", "sample", "Tools: [node]"),
  });
  const result = await show(["sample"]);
  failure(result, "EntryInvalid", {
    id: "sample",
    origin: "user",
    reason: "decode",
    path: "STACK.md",
  });
});

test("a symlink within shipped files is rejected without reading its target [3.1a#13]", async () => {
  const { entry, show } = fixture();
  const outside = space.dir();
  writeFileSync(join(outside, "private.txt"), "outside-content-must-not-appear");
  mkdirSync(join(entry, "files"));
  symlinkSync(join(outside, "private.txt"), join(entry, "files", "linked.txt"));
  const result = await show(["sample"]);
  failure(result, "EntryInvalid", { reason: "symlink", path: "files/linked.txt" });
  expect(result.stderr).not.toContain("outside-content-must-not-appear");
});

test.each(["malformed", "directory"])(
  "a %s ledger warns once but preserves the entry report [3.1a#14]",
  async (state) => {
    const { home, registry } = fixture();
    if (state === "directory") mkdirSync(join(registry, "runs.json"));
    else writeFileSync(join(registry, "runs.json"), "{ half-written");
    const result = await runCli(["show", "sample", "--json"], {
      home,
      env: quiet,
      host: { registry },
    });
    expect(result.status).toBe(0);
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr).toMatch(/ledger|runs\.json/i);
    expect(await showReport({ ...result, stderr: "" })).toMatchObject({
      id: "sample",
      lastRun: null,
    });
  },
);

test("JSON keeps entry text and unusual file names losslessly [3.1a#15]", async () => {
  const { registry, show } = fixture();
  const body = '## Setup\n\nQuotes: \\"hello\\", café.\n\u001b[31mliteral body text\u001b[0m\n';
  const entry = writeEntry({
    root: registry,
    kind: "stack",
    dir: "sample",
    frontmatter: minimal("stack", "sample").replace(
      "name: sample name",
      'name: "A name\\nwith a second line"',
    ),
    body,
  });
  shipped(entry, "files/-café notes.txt");
  const report = await showReport(await show(["sample"]));
  expect(report).toMatchObject({
    name: "A name\nwith a second line",
    body,
    bodyWords: countWords(body),
  });
  expect(report.files).toEqual([
    expect.objectContaining({ source: "files/-café notes.txt", path: "-café notes.txt" }),
  ]);
});

test("text audiences expose all guidance branches, commands, verify runs and shipped files for review [3.1a#18]", async () => {
  const { home, registry } = fixture();
  const body =
    "## Setup\n\n<!-- stacks:when preset=default -->\nDefault-only guidance.\n<!-- stacks:end -->\n<!-- stacks:when preset=sandbox -->\nSandbox-only guidance.\n<!-- stacks:end -->\n";
  const entry = writeEntry({
    root: registry,
    kind: "stack",
    dir: "sample",
    frontmatter: minimal(
      "stack",
      "sample",
      [
        "commands:",
        '  make-check: "Run every check"',
        "verify:",
        '  - { name: serve, phase: serve, run: "node server.js --review", cwd: app, layer: serve, tags: [smoke], timeout: 30s, expect: { http: "http://localhost:3000/ready", within: 2s } }',
      ].join("\n"),
    ),
    body,
  });
  for (const source of [
    "files/.gitignore",
    "files/README.md.tmpl",
    "adapters/claude/CLAUDE-REVIEW.md",
    "adapters/codex/CODEX-REVIEW.md",
  ])
    shipped(entry, source);
  const json = await showReport(
    await runCli(["show", "sample", "--json"], { home, env: quiet, host: { registry } }),
  );
  expect(json).toMatchObject({
    body,
    bodyWords: countWords(body),
    commands: { "make-check": "Run every check" },
    verify: [
      {
        name: "serve",
        phase: "serve",
        run: "node server.js --review",
        cwd: "app",
        layer: "serve",
        tags: ["smoke"],
        timeout: "30s",
        expect: { http: "http://localhost:3000/ready", within: "2s" },
      },
    ],
  });
  for (const audience of [terminal, { stdoutIsTTY: false }]) {
    const result = await runCli(["show", "sample"], {
      home,
      env: quiet,
      host: { registry, ...audience },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    for (const text of [body.trim(), "make-check", "Run every check", "node server.js --review"])
      expect(result.stdout).toContain(text);
    for (const text of [
      ".gitignore",
      "README.md",
      "CLAUDE-REVIEW.md",
      "CODEX-REVIEW.md",
      "claude",
      "codex",
    ])
      expect(result.stdout).toContain(text);
    expect(result.stdout).toMatch(/README\.md(?!\.tmpl)/);
  }
});
