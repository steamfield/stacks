import { chmodSync, cpSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { countWords } from "../src/core/brief/words";
import { BUDGET } from "../src/core/validate/budget";
import { BriefPreview, type Finding, ValidateReport } from "../src/schemas/validate";
import { quiet, runCli, tempDir, terminal, writeError } from "./helpers/cli";
import { spawnGit } from "./helpers/git";
import { emptyRegistry, minimal, realRegistry, writeEntry } from "./helpers/registry";
import { reviewSearchFixture } from "./helpers/search-fixture";

const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});
function temp() {
  const dir = tempDir();
  dirs.push(dir);
  return dir.path;
}

/** `n` distinct words. */
const words = (n: number, prefix = "w") =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");
/** The four D7 layers, so a stack that uses them is clean. */
const STEPS = [
  "verify:",
  '  - { name: install, phase: setup, layer: install, run: "true # install" }',
  '  - { name: lint, layer: lint, run: "true # lint" }',
  '  - { name: typecheck, layer: typecheck, run: "true # typecheck" }',
  '  - { name: test, layer: test, run: "true # test" }',
].join("\n");
const SETUP = "## Setup\n\nCreate the project.\n";
type StackContent = { body?: string; tags?: string };
/** A stack with no findings: one task-runner tag, the D7 layers and a Setup section. */
function stack(
  root: string,
  id: string,
  extra = "",
  { body = SETUP, tags = "[cli, scripts]" }: StackContent = {},
) {
  return writeEntry({
    root,
    kind: "stack",
    dir: id,
    frontmatter: minimal("stack", id, `tags: ${tags}\n${STEPS}\n${extra}`),
    body,
  });
}
function fragment(root: string, id: string, extra = "", body = "# Guidance\n") {
  const checked = extra.includes("verify:")
    ? extra
    : `${extra}\nverify:\n  - { name: fixture-${id}, layer: check, run: "true # ${id}" }`;
  return writeEntry({
    root,
    kind: "fragment",
    dir: id,
    frontmatter: minimal("fragment", id, checked),
    body,
  });
}
/** An app: a `category: app` fragment applying to `on`. */
function app(root: string, id: string, on: string, body = "# Guidance\n") {
  const frontmatter = minimal("fragment", id, `applies_to: [${on}]`).replace(
    "category: tooling",
    "category: app",
  );
  return writeEntry({ root, kind: "fragment", dir: id, frontmatter, body });
}

type Options = { registry?: string; home?: string; env?: Record<string, string>; host?: object };
/** `validate` through the real command tree; the bundled root is `registry` (an empty dir by default). */
async function run(args: string[], options: Options = {}) {
  const home = options.home ?? temp();
  return runCli(["validate", ...args], {
    home,
    env: { ...quiet, ...options.env },
    host: { registry: options.registry ?? emptyRegistry, ...options.host },
  });
}
/** The decoded `--json` report and the exit status. */
async function report(args: string[], options: Options = {}) {
  const result = await run([...args, "--json"], options);
  return {
    ...result,
    report: Schema.decodeUnknownSync(ValidateReport)(JSON.parse(result.stdout)),
  };
}
const checks = (findings: ReadonlyArray<Finding>) =>
  findings.map((finding) => `${finding.severity} ${finding.check} ${finding.entry ?? ""}`);
const only = (findings: ReadonlyArray<Finding>, check: string) =>
  findings.filter((finding) => finding.check === check);

test("a clean registry validates with no findings, exit 0, and a size row per composition [1.5#1] [1.5#11]", async () => {
  const root = temp();
  stack(root, "clean", "fragments:\n  default: [helper]\n  optional: [extra]");
  fragment(root, "helper");
  fragment(root, "extra");
  const { status, stderr, report: got } = await report([root]);
  expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
  expect(got.findings).toEqual([
    {
      check: "search-missing",
      entry: "clean",
      file: "search/stacks/clean.json",
      kind: "stack",
      message: "No search card; add a reviewed sidecar for search discovery.",
      severity: "note",
    },
    {
      check: "search-missing",
      entry: "extra",
      file: "search/fragments/extra.json",
      kind: "fragment",
      message: "No search card; add a reviewed sidecar for search discovery.",
      severity: "note",
    },
    {
      check: "search-missing",
      entry: "helper",
      file: "search/fragments/helper.json",
      kind: "fragment",
      message: "No search card; add a reviewed sidecar for search discovery.",
      severity: "note",
    },
  ]);
  expect(got.entries).toEqual({ stacks: 1, fragments: 2 });
  expect(got.bundled).toBe(false);
  expect(
    got.sizes.filter((row) => row.kind === "composed").map((row) => [row.preset, row.with]),
  ).toEqual([
    ["default", undefined],
    ["default", "extra"],
    ["sandbox", undefined],
    ["sandbox", "extra"],
  ]);
});

test("human mode groups findings by entry, prints sizes and a total, and suggests --brief", async () => {
  const root = temp();
  stack(root, "clean");
  const result = await run([root], { host: terminal });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`Validated ${root}\n`);
  expect(result.stdout).toMatch(/Sizes \(words\)\n {2}clean body +\d+ \/ 2,000\n/);
  expect(result.stdout).toMatch(/clean \(sandbox\) +[\d,]+ \/ 6,000 {3}fixed [\d,]+\n/);
  expect(result.stdout).toContain("1 stack, 0 fragments: 0 errors, 0 warnings, 1 note");
  expect(result.stdout).toContain(`Next: stacks validate ${root} --brief clean --sandbox`);
});

test("errors keep the report on stdout, end stderr with the ValidationFailed envelope, and exit 2 [1.5#1] [1.5#11]", async () => {
  const root = temp();
  stack(root, "broken", "decisions: [Pick a database]");
  stack(root, "fine");
  const json = await run([root, "--json"]);
  expect(json.status).toBe(2);
  const decoded = Schema.decodeUnknownSync(ValidateReport)(JSON.parse(json.stdout));
  expect(checks(decoded.findings)).toEqual([
    "error decision-default broken",
    "note search-missing broken",
    "note search-missing fine",
  ]);
  expect(JSON.parse(json.stderr.trim().split("\n").at(-1) ?? "")).toEqual({
    error: {
      tag: "ValidationFailed",
      message: "Validation failed.",
      retryable: false,
      next: "fix the error findings in the report on stdout, then run stacks validate again.",
      details: { errors: 1, warnings: 0 },
    },
  });
  const human = await run([root], { host: terminal });
  expect(human.status).toBe(2);
  expect(human.stdout).toContain(
    "stack broken\n  error    decision-default  stacks/broken/STACK.md: decisions[0] names no",
  );
  expect(human.stdout).toContain(`Next: fix the errors above, then run stacks validate ${root}`);
  // The report's last lines already give the counts; the envelope's details keep them for --json.
  expect(human.stderr).toBe("Validation failed.\n");
});

test("entries that don't load are findings, and the rest of the registry still reports [1.5#1] [1.5#9]", async () => {
  const root = temp();
  stack(root, "fine");
  writeEntry({
    root,
    kind: "stack",
    dir: "unknown-key",
    frontmatter: minimal("stack", "unknown-key", "colour: red"),
  });
  writeEntry({ root, kind: "stack", dir: "renamed", frontmatter: minimal("stack", "other-id") });
  writeEntry({
    root,
    kind: "fragment",
    dir: "wrong-kind",
    frontmatter: minimal("stack", "wrong-kind"),
  });
  writeEntry({
    root,
    kind: "fragment",
    dir: "newer",
    frontmatter: minimal("fragment", "newer").replace(/^schema_version: 1/, "schema_version: 2"),
  });
  const linked = fragment(root, "linked");
  symlinkSync("/", join(linked, "files"));
  mkdirSync(join(root, "stacks", "no-file"));
  writeEntry({ root, kind: "stack", dir: "bad-yaml", frontmatter: "id: [unclosed" });
  const { status, report: got } = await report([root]);
  expect(status).toBe(2);
  expect(got.findings.map((finding) => [finding.check, finding.entry, finding.file])).toEqual([
    ["schema", "bad-yaml", "stacks/bad-yaml/STACK.md"],
    ["search-missing", "fine", "search/stacks/fine.json"],
    ["schema", "no-file", "stacks/no-file/STACK.md"],
    ["id-matches-dir", "renamed", "stacks/renamed/STACK.md"],
    ["schema", "unknown-key", "stacks/unknown-key/STACK.md"],
    ["symlink", "linked", "fragments/linked/files"],
    ["schema", "newer", "fragments/newer/FRAGMENT.md"],
    ["kind-matches-file", "wrong-kind", "fragments/wrong-kind/FRAGMENT.md"],
  ]);
  expect(got.findings.find((finding) => finding.entry === "unknown-key")?.message).toBe(
    "colour: unknown key",
  );
  // The loadable stack is still composed and measured.
  expect(got.sizes.some((row) => row.entry === "fine" && row.kind === "composed")).toBe(true);
});

test("one entry directory validates only that entry, with references resolved through its registry", async () => {
  const root = temp();
  stack(root, "solo", "fragments:\n  default: [helper]");
  fragment(root, "helper", "decisions: [no default here]");
  stack(root, "other", "decisions: [no default here either]");
  const { status, report: got } = await report([join(root, "stacks", "solo")]);
  expect(status).toBe(0);
  expect(got.entries).toEqual({ stacks: 1, fragments: 0 });
  expect(got.findings).toEqual([
    {
      check: "search-missing",
      entry: "solo",
      file: "search/stacks/solo.json",
      kind: "stack",
      message: "No search card; add a reviewed sidecar for search discovery.",
      severity: "note",
    },
  ]);
  expect(got.sizes.map((row) => row.entry)).toEqual(["solo", "solo", "solo"]);
});

test("a path that is no registry root, no entry and no bundled registry is NotFound naming it [1.5#12]", async () => {
  const home = temp();
  const empty = join(home, "empty");
  mkdirSync(empty);
  for (const path of [empty, join(home, "missing")]) {
    const result = await run([path, "--json"], { home });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        tag: "NotFound",
        message: "Not found.",
        retryable: false,
        next: "pass a registry root (a directory holding stacks/ or fragments/) or an entry directory inside one.",
        details: { suggestions: [], looked: path },
      },
    });
  }
  // An entry outside a stacks/ or fragments/ directory belongs to no registry.
  const loose = join(home, "loose");
  mkdirSync(loose);
  writeFileSync(join(loose, "STACK.md"), `---\n${minimal("stack", "loose")}\n---\n`);
  expect((await run([loose], { home })).status).toBe(2);
});

test("an empty bundled registry with its vocabulary validates clean; with no directory at all it is NotFound [1.5#12]", async () => {
  const home = temp();
  const bundled = join(home, "bundled");
  mkdirSync(bundled);
  writeFileSync(join(bundled, "README.md"), "# Bundled\n");
  reviewSearchFixture(bundled);
  for (const args of [[], [bundled]]) {
    const { status, report: got } = await report(args, { home, registry: bundled });
    expect(status).toBe(0);
    expect(got).toEqual({
      root: bundled,
      bundled: true,
      entries: { stacks: 0, fragments: 0 },
      findings: [],
      sizes: [],
    });
  }
  const missing = await run(["--json"], { home, registry: join(home, "nothing") });
  expect(missing.status).toBe(2);
  expect(JSON.parse(missing.stderr).error.details.looked).toBe(join(home, "nothing"));
});

test.skipIf(process.getuid?.() === 0)(
  "a root whose stacks/ can't be read is PermissionDenied, exit 6 [1.5#12]",
  async () => {
    const root = temp();
    stack(root, "fine");
    chmodSync(join(root, "stacks"), 0o000);
    try {
      const result = await run([root, "--json"]);
      expect(result.status).toBe(6);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).error.details).toEqual({
        reason: "read",
        path: join(root, "stacks"),
      });
    } finally {
      chmodSync(join(root, "stacks"), 0o755);
    }
  },
);

test("budget-body: limits are inclusive, per kind: stack 2,000, fragment 1,000, app 3,000 [1.5#1] [1.5#2]", async () => {
  const root = temp();
  stack(root, "at-limit", "", {
    body: `${SETUP}\n${words(BUDGET.stackBody - countWords(SETUP))}\n`,
  });
  stack(root, "over-limit", "", {
    body: `${SETUP}\n${words(BUDGET.stackBody + 1 - countWords(SETUP))}\n`,
  });
  fragment(root, "frag-at", "", words(BUDGET.fragmentBody));
  fragment(root, "frag-over", "", words(BUDGET.fragmentBody + 1));
  app(root, "app-at", "cli", words(BUDGET.appBody));
  app(root, "app-over", "cli", words(BUDGET.appBody + 1));
  const { report: got } = await report([root]);
  const body = only(got.findings, "budget-body");
  expect(body.map((finding) => [finding.entry, finding.message])).toEqual([
    ["over-limit", "body is 2,001 words, limit 2,000"],
    ["app-over", "body is 3,001 words, limit 3,000"],
    ["frag-over", "body is 1,001 words, limit 1,000"],
  ]);
  const rows = got.sizes.filter((row) => row.kind === "body");
  expect(rows.find((row) => row.entry === "app-at")).toMatchObject({ words: 3000, limit: 3000 });
});

test("budget-body counts every conditional branch, but no marker line", async () => {
  const root = temp();
  const body = `${SETUP}<!-- stacks:when preset=sandbox -->\none two\n<!-- stacks:end -->\n<!-- stacks:when preset=default -->\nthree\n<!-- stacks:end -->\n`;
  stack(root, "branches", "", { body });
  const { report: got } = await report([root]);
  expect(got.sizes.find((row) => row.kind === "body")?.words).toBe(countWords(SETUP) + 3);
});

/**
 * A stack with four default fragments of `fragmentWords` each and a body padded by `pad` words;
 * returns its composed rows by preset.
 */
async function composedSizes(root: string, pad: number, sandboxOnly = 0) {
  for (const id of ["f1", "f2", "f3", "f4"]) fragment(root, id, "", words(990, id));
  const sandboxBlock = sandboxOnly
    ? `<!-- stacks:when preset=sandbox -->\n${words(sandboxOnly, "s")}\n<!-- stacks:end -->\n`
    : "";
  stack(root, "big", "fragments:\n  default: [f1, f2, f3, f4]", {
    body: `${SETUP}\n${words(pad, "b")}\n${sandboxBlock}`,
  });
  const { report: got } = await report([root]);
  const row = (preset: string) =>
    got.sizes.find((size) => size.kind === "composed" && size.preset === preset)?.words ?? 0;
  return {
    default: row("default"),
    sandbox: row("sandbox"),
    over: only(got.findings, "budget-composed").map((finding) => finding.message),
  };
}

test("budget-composed: a brief of exactly 6,000 words passes and 6,001 fails, in each preset separately [1.5#2]", async () => {
  const probe = await composedSizes(temp(), 0);
  // Body words add one for one to the brief, so the pad that lands each preset on the limit is known.
  const toDefault = BUDGET.composed - probe.default;
  const exact = await composedSizes(temp(), toDefault);
  expect(exact.default).toBe(6000);
  expect(exact.over.filter((message) => message.includes("(default)"))).toEqual([]);
  const over = await composedSizes(temp(), toDefault + 1);
  expect(over.over).toContain("big (default): 6,001 words, limit 6,000");

  const toSandbox = BUDGET.composed - probe.sandbox;
  const sandboxExact = await composedSizes(temp(), toSandbox);
  expect(sandboxExact.sandbox).toBe(6000);
  expect(sandboxExact.over).toEqual([]);
  // One word only the sandbox brief keeps pushes only the sandbox brief over.
  const sandboxOver = await composedSizes(temp(), toSandbox - 1, 2);
  expect(sandboxOver.sandbox).toBe(6001);
  expect(sandboxOver.over).toEqual(["big (sandbox): 6,001 words, limit 6,000"]);
}, 30_000);

test("a composition with an app is budgeted at 9,000, and default apps leave when another app is added [1.5#2]", async () => {
  const root = temp();
  stack(root, "host", "fragments:\n  default: [first-app]");
  app(root, "first-app", "host", words(2500));
  app(root, "second-app", "cli", words(2500));
  const { status, report: got } = await report([root]);
  expect(status).toBe(0);
  const composed = got.sizes.filter((row) => row.kind === "composed");
  expect(composed.map((row) => [row.preset, row.with, row.limit])).toEqual([
    ["default", undefined, 9000],
    ["default", "second-app", 9000],
    // The sandbox preset drops the default app, so its base brief is held to 6,000.
    ["sandbox", undefined, 6000],
    ["sandbox", "second-app", 9000],
  ]);
});

test("two optional fragments that fit alone report one composed budget error per preset together", async () => {
  const root = temp();
  stack(root, "pair", "fragments:\n  default: [d1, d2, d3, d4]\n  optional: [alpha, beta]");
  for (const id of ["d1", "d2", "d3", "d4"]) fragment(root, id, "", words(900, id));
  fragment(root, "alpha", "", words(850, "a"));
  fragment(root, "beta", "", words(850, "b"));

  const { status, stderr, report: got } = await report([root]);
  expect(status).toBe(2);
  expect(JSON.parse(stderr).error).toMatchObject({
    tag: "ValidationFailed",
    details: { errors: 2, warnings: 0 },
  });
  const rows = got.sizes.filter((row) => row.kind === "composed");
  expect(rows.map((row) => [row.preset, row.with])).toEqual([
    ["default", undefined],
    ["default", "alpha"],
    ["default", "beta"],
    ["default", "alpha + beta"],
    ["sandbox", undefined],
    ["sandbox", "alpha"],
    ["sandbox", "beta"],
    ["sandbox", "alpha + beta"],
  ]);
  expect(
    rows
      .filter((row) => row.with === "alpha" || row.with === "beta")
      .every((row) => row.words <= BUDGET.composed),
  ).toBe(true);
  expect(only(got.findings, "budget-composed").map((finding) => finding.message)).toEqual([
    `pair (default) + alpha + beta: ${rows[3]?.words.toLocaleString("en-US")} words, limit 6,000; preview: stacks validate ${root} --brief pair --with alpha --with beta`,
    `pair (sandbox) + alpha + beta: ${rows[7]?.words.toLocaleString("en-US")} words, limit 6,000; preview: stacks validate ${root} --brief pair --sandbox --with alpha --with beta`,
  ]);
});

test("two apps or two mutually conflicting optional fragments are not paired", async () => {
  const root = temp();
  stack(root, "host", "fragments:\n  optional: [left, right]");
  fragment(root, "left", "conflicts: [right]");
  fragment(root, "right", "conflicts: [left]");
  app(root, "first-app", "host");
  app(root, "second-app", "host");

  const { status, report: got } = await report([root]);
  expect(status).toBe(0);
  expect(only(got.findings, "compose")).toEqual([]);
  const withIds = got.sizes
    .filter((row) => row.kind === "composed" && row.preset === "default")
    .map((row) => row.with);
  expect(withIds).toContain("first-app + left");
  expect(withIds).toContain("right + second-app");
  expect(withIds).not.toContain("first-app + second-app");
  expect(withIds).not.toContain("left + right");
});

test("a file collision introduced only by an optional pair is reported", async () => {
  const root = temp();
  stack(root, "pair-files", "fragments:\n  optional: [alpha, beta]");
  for (const { id, content } of [
    { id: "alpha", content: "first" },
    { id: "beta", content: "second" },
  ]) {
    const entry = fragment(root, id);
    mkdirSync(join(entry, "files"));
    writeFileSync(join(entry, "files", "config.txt"), content);
  }

  const { status, report: got } = await report([root]);
  expect(status).toBe(2);
  expect(only(got.findings, "compose").map((finding) => finding.message)).toEqual([
    expect.stringContaining("pair-files (default, sandbox) + alpha + beta"),
  ]);
});

test("a pair drops each optional fragment's conflicting default", async () => {
  const root = temp();
  stack(
    root,
    "swap-pair",
    "fragments:\n  default: [first-default, second-default]\n  optional: [alpha, beta]",
  );
  fragment(root, "first-default");
  fragment(root, "second-default");
  fragment(root, "alpha", "conflicts: [first-default]");
  fragment(root, "beta", "conflicts: [second-default]");

  const { status, report: got } = await report([root]);
  expect(status).toBe(0);
  expect(only(got.findings, "compose")).toEqual([]);
  expect(
    got.sizes.filter((row) => row.kind === "composed" && row.with === "alpha + beta"),
  ).toHaveLength(2);
  for (const preset of ["default", "sandbox"]) {
    const preview = await run([
      root,
      "--brief",
      "swap-pair",
      "--with",
      "alpha",
      "--with",
      "beta",
      "--without",
      "first-default",
      "--without",
      "second-default",
      ...(preset === "sandbox" ? ["--sandbox"] : []),
      "--json",
    ]);
    expect(preview.status).toBe(0);
    const brief = Schema.decodeUnknownSync(BriefPreview)(JSON.parse(preview.stdout));
    expect(brief.fragments).toEqual(["alpha", "beta"]);
    expect(
      got.sizes.find(
        (row) => row.kind === "composed" && row.preset === preset && row.with === "alpha + beta",
      )?.words,
    ).toBe(brief.briefWords);
  }
});

test("an over-budget pair that replaces defaults gives a runnable preview command", async () => {
  const root = temp();
  stack(
    root,
    "replace-pair",
    "fragments:\n  default: [core-a, core-b, core-c, old-a, old-b]\n  optional: [alpha, beta]",
    {
      body: `${SETUP}\n${words(1350, "s")}`,
    },
  );
  for (const id of ["core-a", "core-b", "core-c"]) fragment(root, id, "", words(900, id));
  fragment(root, "old-a");
  fragment(root, "old-b");
  fragment(root, "alpha", "conflicts: [old-a]", words(850, "a"));
  fragment(root, "beta", "conflicts: [old-b]", words(850, "b"));

  const { status, report: got } = await report([root]);
  expect(status).toBe(2);
  expect(only(got.findings, "budget-composed").map((finding) => finding.message)).toEqual([
    expect.stringContaining(
      `preview: stacks validate ${root} --brief replace-pair --with alpha --with beta --without old-a --without old-b`,
    ),
    expect.stringContaining(
      `preview: stacks validate ${root} --brief replace-pair --sandbox --with alpha --with beta --without old-a --without old-b`,
    ),
  ]);
});

test("sizes are rendered with the canonical context: tools, git, invocation and user settings change nothing [1.5#3]", async () => {
  const root = temp();
  stack(root, "steady", "tools: [surely-not-installed-tool]\nfragments:\n  default: [helper]");
  fragment(root, "helper", "tools: [git]", words(40));
  fragment(root, "always-on", "", words(30));
  const baseline = (await report([root])).report.sizes;
  const home = temp();
  mkdirSync(join(home, "config", "stacks"), { recursive: true });
  writeFileSync(
    join(home, "config", "stacks", "config.json"),
    JSON.stringify({ always: ["always-on"], agents: ["codex", "claude"] }),
  );
  const parent = temp();
  spawnGit(["init", "-q", parent]);
  const nested = join(parent, "registry");
  stack(nested, "steady", "tools: [surely-not-installed-tool]\nfragments:\n  default: [helper]");
  fragment(nested, "helper", "tools: [git]", words(40));
  fragment(nested, "always-on", "", words(30));
  const variants = [
    await report([root], { home, env: { PATH: process.env.PATH ?? "" } }),
    await report([root], { host: { invocation: "npx -y stacks@9.9.9" } }),
    await report([nested], { env: { PATH: process.env.PATH ?? "" } }),
  ];
  for (const variant of variants) expect(variant.report.sizes).toEqual(baseline);
});

test("fixedWords is the CLI's own text: growing a body changes words only, and an empty stack is all fixed text [1.5#4]", async () => {
  const small = temp();
  stack(small, "grow", "", { body: `${SETUP}\n${words(10)}\n` });
  const grown = temp();
  stack(grown, "grow", "", { body: `${SETUP}\n${words(60)}\n` });
  const row = async (root: string, preset: string) =>
    (await report([root])).report.sizes.find(
      (size) => size.kind === "composed" && size.preset === preset,
    );
  for (const preset of ["default", "sandbox"]) {
    const before = await row(small, preset);
    const after = await row(grown, preset);
    expect((after?.words ?? 0) - (before?.words ?? 0)).toBe(50);
    expect(after?.fixedWords).toBe(before?.fixedWords);
  }
  const empty = temp();
  writeEntry({
    root: empty,
    kind: "stack",
    dir: "bare",
    frontmatter: minimal("stack", "bare", "tags: [cli, scripts]"),
    body: "",
  });
  const bare = (await report([empty])).report.sizes.filter((size) => size.kind === "composed");
  expect(bare.length).toBe(2);
  for (const size of bare) expect(size.words).toBe(size.fixedWords);
});

it.prop(
  "countWords ignores conditional marker lines and counts each added word once [1.5#5]",
  [Schema.Array(Schema.String), Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 }))],
  ([lines, at]) => {
    const body = lines.join("\n");
    const marked = [
      ...lines.slice(0, at),
      "<!-- stacks:when preset=sandbox -->",
      ...lines.slice(at),
      "<!-- stacks:end -->",
    ].join("\n");
    expect(countWords(marked)).toBe(countWords(body));
    expect(countWords(`${body}\nextra`)).toBe(countWords(body) + 1);
  },
);

test("a reference found only in another origin is a note naming it, and the fragment's text is budgeted [1.5#1] [1.5#6]", async () => {
  const home = temp();
  const bundled = join(home, "bundled");
  fragment(bundled, "shared", "", words(300, "shared"));
  reviewSearchFixture(bundled);
  const user = join(home, "authoring");
  stack(user, "mine", "fragments:\n  default: [shared]");
  const { status, report: got } = await report([user], { home, registry: bundled });
  expect(status).toBe(0);
  expect(got.findings).toEqual([
    {
      check: "search-missing",
      entry: "mine",
      file: "search/stacks/mine.json",
      kind: "stack",
      message: "No search card; add a reviewed sidecar for search discovery.",
      severity: "note",
    },
    {
      check: "resolved-outside-root",
      severity: "note",
      kind: "stack",
      entry: "mine",
      file: "stacks/mine/STACK.md",
      message: "fragments.default names shared, found in the bundled registry",
    },
  ]);
  const withShared = got.sizes.find((row) => row.kind === "composed")?.words ?? 0;
  const alone = temp();
  stack(alone, "mine");
  const without = (await report([alone])).report.sizes.find((row) => row.kind === "composed");
  expect(withShared - (without?.words ?? 0)).toBeGreaterThanOrEqual(300);

  // The same reference from inside the bundled registry has nothing else to resolve through.
  stack(bundled, "mine", "fragments:\n  default: [elsewhere]");
  reviewSearchFixture(bundled);
  fragment(user, "elsewhere");
  const inside = await report([], { home, registry: bundled });
  expect(inside.status).toBe(2);
  expect(checks(only(inside.report.findings, "unknown-reference"))).toEqual([
    "error unknown-reference mine",
  ]);
});

test("unknown-reference covers fragments.*, requires, conflicts and applies_to, with suggestions [1.5#1]", async () => {
  const root = temp();
  stack(root, "refs", "fragments:\n  optional: [helpr]");
  fragment(
    root,
    "helper",
    "requires: [nothing-here]\nconflicts: [gone]\napplies_to: [refs, cli, nowhere]",
  );
  const { report: got } = await report([root]);
  expect(only(got.findings, "unknown-reference").map((f) => [f.entry, f.message])).toEqual([
    ["refs", "fragments.optional names helpr, which is no fragment; did you mean helper?"],
    ["helper", "applies_to names nowhere, which is no stack id and no tag any stack declares"],
    ["helper", "conflicts names gone, which is no fragment"],
    ["helper", "requires names nothing-here, which is no fragment"],
  ]);
});

test("an optional fragment that conflicts with a default replaces it, in either direction", async () => {
  const root = temp();
  stack(root, "swap", "fragments:\n  default: [a, d, kept]\n  optional: [b]");
  fragment(root, "a");
  fragment(root, "b", "conflicts: [a]");
  fragment(root, "d", "conflicts: [b]");
  fragment(root, "kept");
  const { status, report: got } = await report([root]);
  expect(status).toBe(0);
  expect(got.findings).toEqual([
    {
      check: "search-missing",
      entry: "swap",
      file: "search/stacks/swap.json",
      kind: "stack",
      message: "No search card; add a reviewed sidecar for search discovery.",
      severity: "note",
    },
    {
      check: "search-missing",
      entry: "a",
      file: "search/fragments/a.json",
      kind: "fragment",
      message: "No search card; add a reviewed sidecar for search discovery.",
      severity: "note",
    },
    {
      check: "search-missing",
      entry: "b",
      file: "search/fragments/b.json",
      kind: "fragment",
      message: "No search card; add a reviewed sidecar for search discovery.",
      severity: "note",
    },
    {
      check: "search-missing",
      entry: "d",
      file: "search/fragments/d.json",
      kind: "fragment",
      message: "No search card; add a reviewed sidecar for search discovery.",
      severity: "note",
    },
    {
      check: "search-missing",
      entry: "kept",
      file: "search/fragments/kept.json",
      kind: "fragment",
      message: "No search card; add a reviewed sidecar for search discovery.",
      severity: "note",
    },
  ]);
  expect(got.sizes.filter((row) => row.kind === "composed").map((row) => row.with)).toEqual([
    undefined,
    "b",
    undefined,
    "b",
  ]);
});

test("a compose failure that remains is one finding per composition, naming the presets it fails in", async () => {
  const root = temp();
  stack(root, "torn", "fragments:\n  required: [r]\n  default: [a]\n  optional: [b]");
  fragment(root, "r");
  fragment(root, "a");
  // A required fragment can't be dropped, so this conflict stays.
  fragment(root, "b", "conflicts: [r]");
  const { status, report: got } = await report([root]);
  expect(status).toBe(2);
  expect(got.findings.map((finding) => [finding.check, finding.entry, finding.message])).toEqual([
    ["compose", "torn", "torn (default, sandbox) + b: can't compose (conflicts): b, r"],
    ["search-missing", "torn", "No search card; add a reviewed sidecar for search discovery."],
    ["search-missing", "a", "No search card; add a reviewed sidecar for search discovery."],
    ["compose-add", "b", "b with torn (default, add): can't compose (conflicts): b, r"],
    ["compose-add", "b", "b with torn (sandbox, add): can't compose (conflicts): b, r"],
    ["search-missing", "b", "No search card; add a reviewed sidecar for search discovery."],
    ["search-missing", "r", "No search card; add a reviewed sidecar for search discovery."],
  ]);
  expect(got.sizes.filter((row) => row.kind === "composed").map((row) => row.with)).toEqual([
    undefined,
    undefined,
  ]);
});

test("an optional fragment that doesn't apply to its stack is an error on the stack [1.5#1]", async () => {
  const root = temp();
  stack(root, "terminal", "fragments:\n  optional: [web-only]");
  fragment(root, "web-only", "applies_to: [web]");
  stack(root, "site", "", { body: SETUP, tags: "[web, scripts]" });
  const { status, report: got } = await report([root]);
  expect(status).toBe(2);
  expect(
    got.findings.map((finding) => [
      finding.severity,
      finding.check,
      finding.entry,
      finding.message,
    ]),
  ).toEqual([
    [
      "error",
      "verify-layers",
      "site",
      "no serve step with expect, which a stack tagged web or api needs (default, sandbox)",
    ],
    [
      "note",
      "search-missing",
      "site",
      "No search card; add a reviewed sidecar for search discovery.",
    ],
    [
      "error",
      "optional-fits",
      "terminal",
      "fragments.optional names web-only, whose applies_to matches neither this stack nor its tags",
    ],
    [
      "note",
      "search-missing",
      "terminal",
      "No search card; add a reviewed sidecar for search discovery.",
    ],
    [
      "note",
      "search-missing",
      "web-only",
      "No search card; add a reviewed sidecar for search discovery.",
    ],
  ]);
});

test("an unknown or rejected id a stack names is reported once, by its own check", async () => {
  const root = temp();
  stack(root, "ghostly", "fragments:\n  default: [ghost]");
  stack(root, "phantom", "fragments:\n  optional: [phantm]");
  stack(root, "uses-bad", "fragments:\n  default: [bad]");
  writeEntry({
    root,
    kind: "fragment",
    dir: "bad",
    frontmatter: minimal("fragment", "bad", "colour: red"),
  });
  const { status, report: got } = await report([root]);
  expect(status).toBe(2);
  expect(checks(got.findings)).toEqual([
    "error unknown-reference ghostly",
    "note search-missing ghostly",
    "error unknown-reference phantom",
    "note search-missing phantom",
    "note search-missing uses-bad",
    "error schema bad",
  ]);
  // Validating the stack alone doesn't report the rejected fragment, so compose still does.
  const alone = await report([join(root, "stacks", "uses-bad")]);
  expect(alone.report.findings.map((finding) => [finding.check, finding.message])).toEqual([
    ["compose", "uses-bad (default, sandbox): user entry bad is invalid (decode) at FRAGMENT.md"],
    ["search-missing", "No search card; add a reviewed sidecar for search discovery."],
  ]);
});

test("apps are enumerated from the validated root, not from every origin", async () => {
  const home = temp();
  const bundled = join(home, "bundled");
  app(bundled, "elsewhere-app", "cli");
  reviewSearchFixture(bundled);
  const user = join(home, "authoring");
  stack(user, "mine");
  app(user, "local-app", "mine");
  const { status, report: got } = await report([user], { home, registry: bundled });
  expect(status).toBe(0);
  expect(
    got.sizes.filter((row) => row.kind === "composed").map((row) => [row.preset, row.with]),
  ).toEqual([
    ["default", undefined],
    ["default", "local-app"],
    ["sandbox", undefined],
    ["sandbox", "local-app"],
  ]);
});

test("step-names: a step name used twice in one entry, or by two entries of a composition [1.5#1]", async () => {
  const root = temp();
  stack(root, "dup", "fragments:\n  default: [clash]");
  fragment(root, "clash", 'verify:\n  - { name: lint, layer: lint, run: "true" }');
  writeEntry({
    root,
    kind: "fragment",
    dir: "twice",
    frontmatter: minimal(
      "fragment",
      "twice",
      'verify:\n  - { name: same, layer: test, run: "true" }\n  - { name: same, layer: test, run: "true" }',
    ),
  });
  const { report: got } = await report([root]);
  expect(
    only(got.findings, "step-names").map((finding) => [finding.entry, finding.message]),
  ).toEqual([
    ["dup", "dup (default, sandbox): can't compose (step_name): dup, clash; lint"],
    ["twice", "verify step same is declared twice"],
  ]);
});

test("verify-layers: D7 layers in the default composition, and a probed serve step for web or api stacks [1.5#1] [1.5#7]", async () => {
  const root = temp();
  stack(root, "web-no-serve", "", { body: SETUP, tags: "[web, scripts]" });
  stack(
    root,
    "web-served",
    '  - { name: dev, phase: serve, layer: serve, run: "true", expect: { http: "http://localhost:3000" } }',
    { body: SETUP, tags: "[web, scripts]" },
  );
  stack(root, "cli-only");
  writeEntry({
    root,
    kind: "stack",
    dir: "no-lint",
    frontmatter: minimal(
      "stack",
      "no-lint",
      'tags: [cli, make]\nverify:\n  - { name: t, layer: test, run: "true" }',
    ),
    body: SETUP,
  });
  const { report: got } = await report([root]);
  expect(
    only(got.findings, "verify-layers").map((finding) => [finding.entry, finding.message]),
  ).toEqual([
    ["no-lint", "no verify step with layer install (default, sandbox)"],
    ["no-lint", "no verify step with layer lint (default, sandbox)"],
    ["no-lint", "no verify step with layer typecheck (default, sandbox)"],
    [
      "web-no-serve",
      "no serve step with expect, which a stack tagged web or api needs (default, sandbox)",
    ],
  ]);
});

test("verify-layers names a step that matches the missing layer but has no layer, and how to fix it", async () => {
  const root = temp();
  writeEntry({
    root,
    kind: "stack",
    dir: "ported",
    frontmatter: minimal(
      "stack",
      "ported",
      [
        "tags: [cli, make]",
        "verify:",
        '  - { name: install, phase: setup, layer: install, run: "true" }',
        '  - { name: lint, run: "true" }',
        '  - { name: typecheck, layer: typecheck, run: "true" }',
        '  - { name: tests, run: "true" }',
      ].join("\n"),
    ),
    body: SETUP,
  });
  const { report: got } = await report([root]);
  expect(only(got.findings, "verify-layers").map((finding) => finding.message)).toEqual([
    "no verify step with layer lint (default, sandbox); step lint has no layer: add layer: lint to it",
    // No step is named test, so there is nothing to point at.
    "no verify step with layer test (default, sandbox)",
  ]);
});

test("a check-layer step is a described step: no step-layer warning, and no D7 layer is needed for it", async () => {
  const root = temp();
  stack(root, "checked", '  - { name: readme, layer: check, run: "true" }');
  fragment(root, "hooks", 'verify:\n  - { name: hooks-defined, layer: check, run: "true" }');
  const { status, report: got } = await report([root]);
  expect(status).toBe(0);
  expect(got.findings).toEqual([
    {
      check: "search-missing",
      entry: "checked",
      file: "search/stacks/checked.json",
      kind: "stack",
      message: "No search card; add a reviewed sidecar for search discovery.",
      severity: "note",
    },
    {
      check: "verify-run-duplicate",
      entry: "hooks",
      file: "fragments/hooks/FRAGMENT.md",
      kind: "fragment",
      severity: "note",
      message:
        "hooks with checked (add): steps readme, hooks-defined run the same command in one composed manifest; keep both only if the repetition is intentional.",
    },
    {
      check: "search-missing",
      entry: "hooks",
      file: "search/fragments/hooks.json",
      kind: "fragment",
      message: "No search card; add a reviewed sidecar for search discovery.",
      severity: "note",
    },
  ]);
});

test("stack-setup-section, task-runner-tag, step-layer and dep-version [1.5#1] [1.5#8]", async () => {
  const root = temp();
  stack(root, "no-setup", "", { body: "# Guide\n\n### Setup\n" });
  stack(root, "both-runners", "", { body: SETUP, tags: "[cli, make, scripts]" });
  stack(root, "no-runner", "", { body: SETUP, tags: "[cli]" });
  fragment(root, "loose-step", 'verify:\n  - { name: check-it, run: "true" }');
  fragment(root, "pinned", 'deps:\n  app: [effect, "@effect/platform-bun", "react@18", "^1.2.0"]');
  const { report: got } = await report([root]);
  expect(
    got.findings
      .filter((finding) => finding.check !== "verify-layers")
      .map((finding) => [finding.severity, finding.check, finding.entry, finding.message]),
  ).toEqual([
    [
      "warning",
      "task-runner-tag",
      "both-runners",
      "tags hold both make and scripts; a stack declares exactly one",
    ],
    [
      "note",
      "search-missing",
      "both-runners",
      "No search card; add a reviewed sidecar for search discovery.",
    ],
    [
      "warning",
      "task-runner-tag",
      "no-runner",
      "tags hold neither make nor scripts; a stack declares exactly one",
    ],
    [
      "note",
      "search-missing",
      "no-runner",
      "No search card; add a reviewed sidecar for search discovery.",
    ],
    ["warning", "stack-setup-section", "no-setup", 'no "## Setup" heading in the body'],
    [
      "note",
      "search-missing",
      "no-setup",
      "No search card; add a reviewed sidecar for search discovery.",
    ],
    ["warning", "step-layer", "loose-step", "verify step check-it has no layer"],
    [
      "note",
      "search-missing",
      "loose-step",
      "No search card; add a reviewed sidecar for search discovery.",
    ],
    ["error", "dep-version", "pinned", "deps.app[2] carries a version; deps name packages only"],
    ["error", "dep-version", "pinned", "deps.app[3] carries a version; deps name packages only"],
    [
      "note",
      "search-missing",
      "pinned",
      "No search card; add a reviewed sidecar for search discovery.",
    ],
  ]);
});

test("merge-path-missing and merge-json, checked per entry even when no composition includes it [1.5#1] [1.5#8]", async () => {
  const root = temp();
  stack(root, "base", "fragments:\n  optional: [hooks]");
  const hooks = fragment(root, "hooks", "merge: [.claude/settings.json, missing.json]");
  mkdirSync(join(hooks, "adapters", "claude", ".claude"), { recursive: true });
  writeFileSync(join(hooks, "adapters", "claude", ".claude", "settings.json"), "{ not json");
  const unused = fragment(root, "unused", "merge: [config.json]");
  mkdirSync(join(unused, "files"));
  writeFileSync(join(unused, "files", "config.json"), "[1,");
  const { report: got } = await report([root]);
  expect(
    got.findings
      .filter((finding) => finding.check.startsWith("merge"))
      .map((finding) => [finding.check, finding.entry, finding.file]),
  ).toEqual([
    ["merge-json", "hooks", "fragments/hooks/adapters/claude/.claude/settings.json"],
    ["merge-path-missing", "hooks", "fragments/hooks/FRAGMENT.md"],
    ["merge-json", "unused", "fragments/unused/files/config.json"],
  ]);
  // The broken copy is reported once, not again by every composition that includes it.
  expect(only(got.findings, "compose")).toEqual([]);
});

test("conditional prose: syntax with its file line and 1.1's problem code, unknown ids, unknown tags [1.5#1]", async () => {
  const root = temp();
  stack(root, "prose", "", {
    body: `${SETUP}<!-- stacks:when tag=web -->\nweb\n<!-- stacks:end -->\n`,
  });
  fragment(
    root,
    "ids",
    "",
    "# G\n<!-- stacks:when stack=nope with=missing -->\nx\n<!-- stacks:end -->\n",
  );
  fragment(root, "broken", "", "# G\n\n<!-- stacks:when preset=prod -->\nx\n<!-- stacks:end -->\n");
  const { report: got } = await report([root]);
  const conditional = got.findings.filter((finding) => finding.check.startsWith("conditional"));
  // Fixture fragment frontmatter includes its inert verify step, plus the two --- lines.
  expect(conditional).toEqual([
    expect.objectContaining({
      check: "conditional-tag",
      severity: "warning",
      entry: "prose",
      message: "tag=web is a tag no stack declares",
    }),
    expect.objectContaining({
      check: "conditional-syntax",
      entry: "broken",
      file: "fragments/broken/FRAGMENT.md",
      line: 14,
      problem: "bad_value",
    }),
    expect.objectContaining({
      check: "conditional-ids",
      entry: "ids",
      line: 13,
      message: "stack=nope names no stack, so the block is never kept",
    }),
    expect.objectContaining({
      check: "conditional-ids",
      entry: "ids",
      line: 13,
      message: "with=missing names no fragment, so the block is never kept",
    }),
  ]);
  // The malformed block is reported by its own check, not again as a compose failure.
  expect(only(got.findings, "compose")).toEqual([]);
});

test("a with= or stack= id that resolves only in another origin is a resolved-outside-root note", async () => {
  const home = temp();
  const bundled = join(home, "bundled");
  fragment(bundled, "shared");
  stack(bundled, "far-stack");
  reviewSearchFixture(bundled);
  const user = join(home, "authoring");
  stack(user, "mine", "", {
    body: `${SETUP}<!-- stacks:when with=shared stack=far-stack -->\nx\n<!-- stacks:end -->\n`,
  });
  const { status, report: got } = await report([user], { home, registry: bundled });
  expect(status).toBe(0);
  expect(got.findings.map((finding) => [finding.severity, finding.check, finding.message])).toEqual(
    [
      ["note", "search-missing", "No search card; add a reviewed sidecar for search discovery."],
      [
        "note",
        "resolved-outside-root",
        "stack=far-stack names a stack found in the bundled registry",
      ],
      [
        "note",
        "resolved-outside-root",
        "with=shared names a fragment found in the bundled registry",
      ],
    ],
  );
});

test("a directory under stacks/ or fragments/ with no markdown file, or the other kind's, is that kind's entry", async () => {
  const root = temp();
  stack(root, "fine");
  mkdirSync(join(root, "stacks", "empty"));
  const misplaced = join(root, "fragments", "misplaced");
  mkdirSync(misplaced, { recursive: true });
  writeFileSync(join(misplaced, "STACK.md"), `---\n${minimal("stack", "misplaced")}\n---\n`);
  const empty = await report([join(root, "stacks", "empty")]);
  expect(empty.status).toBe(2);
  expect(empty.report.findings.map((f) => [f.check, f.kind, f.entry, f.message])).toEqual([
    ["schema", "stack", "empty", "STACK.md is missing"],
  ]);
  const wrong = await report([misplaced]);
  expect(wrong.status).toBe(2);
  expect(wrong.report.findings.map((f) => [f.check, f.kind, f.entry, f.message])).toEqual([
    ["schema", "fragment", "misplaced", "FRAGMENT.md is missing"],
  ]);
});

test("a stacks/ the project registry skips as a symlink is one registry finding, not a newer schema_version per entry", async () => {
  const home = temp();
  const elsewhere = join(home, "elsewhere");
  stack(elsewhere, "linked");
  const project = join(home, ".stacks");
  mkdirSync(project);
  symlinkSync(join(elsewhere, "stacks"), join(project, "stacks"));
  writeEntry({
    root: project,
    kind: "fragment",
    dir: "newer",
    frontmatter: minimal("fragment", "newer").replace(/^schema_version: 1/, "schema_version: 2"),
  });
  const { status, report: got } = await report([project], { home });
  expect(status).toBe(2);
  expect(got.findings.map((f) => [f.check, f.kind, f.entry, f.file, f.message])).toEqual([
    [
      "symlink",
      undefined,
      undefined,
      "stacks",
      "stacks/ is a symlink, which a project registry never follows; its entries are skipped",
    ],
    [
      "schema",
      "fragment",
      "newer",
      "fragments/newer/FRAGMENT.md",
      "schema_version is newer than this CLI reads; update @steamfield/stacks",
    ],
  ]);
});

test("the Next line uses the invocation and escapes control characters in the echoed path", async () => {
  const home = temp();
  const root = join(home, "odd\u001bname");
  stack(root, "clean");
  const clean = await run([root], { home, host: { invocation: "npx -y stacks@9.9.9" } });
  expect(clean.status).toBe(0);
  expect(clean.stdout).not.toContain("\u001b");
  expect(clean.stdout).toContain(
    `Next: npx -y stacks@9.9.9 validate '${home}/odd\\u001bname' --brief clean --sandbox`,
  );
  stack(root, "broken", "decisions: [Pick a database]");
  const failed = await run([root], { home, host: { invocation: "npx -y stacks@9.9.9" } });
  expect(failed.status).toBe(2);
  expect(failed.stdout).not.toContain("\u001b");
  expect(failed.stdout).toContain(
    `Next: fix the errors above, then run npx -y stacks@9.9.9 validate '${home}/odd\\u001bname'`,
  );
});

test("a closed stdout keeps the failure's exit 2 and still writes the envelope", async () => {
  const root = temp();
  stack(root, "broken", "decisions: [Pick a database]");
  const result = await runCli(["validate", root, "--json"], {
    home: temp(),
    env: quiet,
    host: { registry: emptyRegistry },
    stdout: async () => {
      throw writeError("EPIPE");
    },
  });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr.trim().split("\n").at(-1) ?? "").error).toMatchObject({
    tag: "ValidationFailed",
    details: { errors: 1, warnings: 0 },
  });
});

test("--brief takes --with as a comma list and --without, like new", async () => {
  const root = temp();
  stack(root, "base", "fragments:\n  default: [helper]\n  optional: [one, two]");
  fragment(root, "helper");
  fragment(root, "one");
  fragment(root, "two");
  const result = await run([
    root,
    "--brief",
    "base",
    "--with",
    "one,two",
    "--without",
    "helper",
    "--json",
  ]);
  expect(result.status).toBe(0);
  expect(Schema.decodeUnknownSync(BriefPreview)(JSON.parse(result.stdout)).fragments).toEqual([
    "one",
    "two",
  ]);
  const json = await run([root, "--brief", "base", "--with", "one", "--with", "two", "--json"]);
  expect(Schema.decodeUnknownSync(BriefPreview)(JSON.parse(json.stdout)).fragments).toEqual([
    "helper",
    "one",
    "two",
  ]);
});

test("control characters from an entry are escaped in human output [1.5#10]", async () => {
  const root = temp();
  stack(root, "sneaky", "", {
    body: `${SETUP}<!-- stacks:when tag=\u001b[31m -->\nx\n<!-- stacks:end -->\n`,
  });
  const result = await run([root], { host: terminal });
  expect(result.stdout).toContain("tag=\\u001b[31m is a tag no stack declares");
  expect(result.stdout).not.toContain("\u001b");
  const brief = await run([root, "--brief", "sneaky"]);
  expect(brief.stdout).not.toContain("\u001b");
});

const git = spawnGit(["--version"]);
test.skipIf(git.status !== 0)(
  "inside a git checkout, a file the entry's own .gitignore hides is a git-ignored warning [1.5#1] [1.5#8]",
  async () => {
    const repo = temp();
    spawnGit(["init", "-q", repo]);
    const entry = stack(repo, "hides");
    mkdirSync(join(entry, "files"));
    writeFileSync(join(entry, "files", ".gitignore"), ".env.*\n");
    writeFileSync(join(entry, "files", ".env.example.tmpl"), "KEY=\n");
    const env = { PATH: process.env.PATH ?? "" };
    const { status, report: got } = await report([repo], { env });
    expect(status).toBe(0);
    expect(only(got.findings, "git-ignored")).toEqual([
      {
        check: "git-ignored",
        severity: "warning",
        kind: "stack",
        entry: "hides",
        file: "stacks/hides/files/.env.example.tmpl",
        message:
          "git ignores .env.example.tmpl here (rule .env.* in stacks/hides/files/.gitignore), so it never reaches a commit; ship stacks/hides/files/.gitignore as .gitignore.tmpl, which git doesn't read as ignore rules and new still writes as .gitignore",
      },
    ]);
    // Outside a checkout there is nothing to check.
    const plain = temp();
    const copy = stack(plain, "hides");
    mkdirSync(join(copy, "files"));
    writeFileSync(join(copy, "files", ".gitignore"), ".env.*\n");
    writeFileSync(join(copy, "files", ".env.example.tmpl"), "KEY=\n");
    expect(only((await report([plain], { env })).report.findings, "git-ignored")).toEqual([]);
  },
);

test.skipIf(git.status !== 0)(
  "git-ignored blames only ignore rules inside the entry: a root under an ignored directory is not flagged",
  async () => {
    const repo = temp();
    spawnGit(["init", "-q", repo]);
    writeFileSync(join(repo, ".gitignore"), "vendor/\n");
    const root = join(repo, "vendor", "registry");
    const entry = stack(root, "hides");
    mkdirSync(join(entry, "files"));
    writeFileSync(join(entry, "files", ".gitignore"), ".env.*\n");
    writeFileSync(join(entry, "files", ".env.example.tmpl"), "KEY=\n");
    const env = { PATH: process.env.PATH ?? "" };
    const { status, report: got } = await report([root], { env });
    expect(status).toBe(0);
    expect(only(got.findings, "git-ignored")).toEqual([]);
  },
);

test.skipIf(git.status !== 0)(
  "git-ignored matches paths with spaces and leading dashes, and names the rule's file",
  async () => {
    const repo = temp();
    spawnGit(["init", "-q", repo]);
    // A rule outside the entry ignores this file too, but isn't the entry's doing.
    writeFileSync(join(repo, ".gitignore"), "outside.tmpl\n");
    const entry = stack(repo, "odd");
    mkdirSync(join(entry, "files"));
    writeFileSync(join(entry, "files", ".gitignore"), "my notes.tmpl\n-dash.tmpl\n");
    for (const name of ["my notes.tmpl", "-dash.tmpl", "outside.tmpl", "kept.tmpl"])
      writeFileSync(join(entry, "files", name), "x\n");
    const env = { PATH: process.env.PATH ?? "" };
    const { report: got } = await report([repo], { env });
    expect(only(got.findings, "git-ignored").map((f) => [f.file, f.message])).toEqual([
      [
        "stacks/odd/files/-dash.tmpl",
        "git ignores -dash.tmpl here (rule -dash.tmpl in stacks/odd/files/.gitignore), so it never reaches a commit; ship stacks/odd/files/.gitignore as .gitignore.tmpl, which git doesn't read as ignore rules and new still writes as .gitignore",
      ],
      [
        "stacks/odd/files/my notes.tmpl",
        "git ignores my notes.tmpl here (rule my notes.tmpl in stacks/odd/files/.gitignore), so it never reaches a commit; ship stacks/odd/files/.gitignore as .gitignore.tmpl, which git doesn't read as ignore rules and new still writes as .gitignore",
      ],
    ]);
  },
);

test.skipIf(git.status !== 0)(
  "git-ignored suggests .gitignore.tmpl only for an ignore file the entry ships, and a shipped .gitignore.tmpl hides nothing",
  async () => {
    const repo = temp();
    spawnGit(["init", "-q", repo]);
    // An ignore file beside STACK.md isn't shipped, so renaming it is no fix.
    const local = stack(repo, "local");
    writeFileSync(join(local, ".gitignore"), "*.tmpl\n");
    mkdirSync(join(local, "files"));
    writeFileSync(join(local, "files", "a.tmpl"), "x\n");
    // One in adapters/ is shipped like one in files/.
    const adapted = stack(repo, "adapted");
    mkdirSync(join(adapted, "adapters", "claude", ".claude"), { recursive: true });
    writeFileSync(join(adapted, "adapters", "claude", ".claude", ".gitignore"), "*.local.json\n");
    writeFileSync(join(adapted, "adapters", "claude", ".claude", "settings.local.json"), "{}\n");
    // The fix applied: the same rules as .gitignore.tmpl, with no tokens, hide nothing.
    const fixed = stack(repo, "fixed");
    mkdirSync(join(fixed, "files"));
    writeFileSync(join(fixed, "files", ".gitignore.tmpl"), ".env.*\n");
    writeFileSync(join(fixed, "files", ".env.example.tmpl"), "KEY=\n");
    const env = { PATH: process.env.PATH ?? "" };
    const { status, report: got } = await report([repo], { env });
    expect(status).toBe(0);
    expect(got.findings.map((f) => [f.check, f.entry, f.message])).toEqual([
      [
        "git-ignored",
        "adapted",
        "git ignores settings.local.json here (rule *.local.json in stacks/adapted/adapters/claude/.claude/.gitignore), so it never reaches a commit; ship stacks/adapted/adapters/claude/.claude/.gitignore as .gitignore.tmpl, which git doesn't read as ignore rules and new still writes as .gitignore",
      ],
      ["search-missing", "adapted", "No search card; add a reviewed sidecar for search discovery."],
      ["search-missing", "fixed", "No search card; add a reviewed sidecar for search discovery."],
      [
        "git-ignored",
        "local",
        "git ignores a.tmpl here (rule *.tmpl in stacks/local/.gitignore), so it never reaches a commit",
      ],
      ["search-missing", "local", "No search card; add a reviewed sidecar for search discovery."],
    ]);
  },
);

test.skipIf(git.status !== 0)(
  "git-ignored drops only the repository-selecting GIT_ variables: GIT_DIR selects nothing, GIT_CEILING_DIRECTORIES holds",
  async () => {
    const repo = temp();
    spawnGit(["init", "-q", repo]);
    const root = join(repo, "registry");
    const entry = stack(root, "hides");
    mkdirSync(join(entry, "files"));
    writeFileSync(join(entry, "files", ".gitignore"), ".env.*\n");
    writeFileSync(join(entry, "files", ".env.example.tmpl"), "KEY=\n");
    const elsewhere = temp();
    spawnGit(["init", "-q", elsewhere]);
    const PATH = process.env.PATH ?? "";
    // A git hook exports GIT_DIR and GIT_WORK_TREE; git still finds the root's own checkout.
    const hooked = await report([root], {
      env: { PATH, GIT_DIR: join(elsewhere, ".git"), GIT_WORK_TREE: elsewhere },
    });
    expect(hooked.status).toBe(0);
    expect(only(hooked.report.findings, "git-ignored").map((f) => f.file)).toEqual([
      "stacks/hides/files/.env.example.tmpl",
    ]);
    // A ceiling at the checkout's top keeps git from finding it, so there is nothing to check.
    const ceiled = await report([root], {
      env: { PATH, GIT_CEILING_DIRECTORIES: realpathSync(repo) },
    });
    expect(ceiled.status).toBe(0);
    expect(only(ceiled.report.findings, "git-ignored")).toEqual([]);
  },
);

test("the realistic fixture registry validates without errors, its app brief inside 9,000 words", async () => {
  const { status, report: got } = await report([], { registry: realRegistry });
  expect(status).toBe(0);
  expect(got.findings.filter((finding) => finding.severity === "error")).toEqual([]);
  const withApp = got.sizes.filter((row) => row.kind === "composed" && row.with !== undefined);
  expect(withApp.length).toBe(2);
  for (const row of withApp) {
    expect(row.limit).toBe(BUDGET.composedWithApp);
    expect(row.words).toBeGreaterThan(BUDGET.composed - 500);
    expect(row.words).toBeLessThanOrEqual(BUDGET.composedWithApp);
  }
});

test("validate with no path checks a bundled registry whose path ends in a slash", async () => {
  // bin.ts resolves the packaged registry from a URL, which keeps the trailing slash.
  const { status, report: got } = await report([], { registry: `${realRegistry}/` });
  expect(status).toBe(0);
  expect(got.entries.stacks).toBeGreaterThan(0);
  expect(got.entries.fragments).toBeGreaterThan(0);
});

test("--brief prints the composed brief and its counts, and --json decodes as a BriefPreview [1.5#13]", async () => {
  const human = await run(["--brief", "typescript-cli", "--sandbox"], {
    registry: realRegistry,
    host: terminal,
  });
  expect(human.status).toBe(0);
  expect(human.stdout).toMatch(/^# /);
  expect(human.stdout).toContain("## Sandbox");
  expect(human.stderr).toMatch(
    /\n---\nBrief: [\d,]+ words \(fixed text [\d,]+\), limit 6,000\nStack: typescript-cli \(sandbox\)\nFragments: effect-schema, effect, git-hooks\n$/,
  );
  const json = await run(["--brief", "typescript-cli", "--with", "openrouter-chat-cli", "--json"], {
    registry: realRegistry,
  });
  expect(json.status).toBe(0);
  const preview = Schema.decodeUnknownSync(BriefPreview)(JSON.parse(json.stdout));
  expect(preview).toMatchObject({
    stack: "typescript-cli",
    preset: "default",
    app: "openrouter-chat-cli",
    limit: 9000,
    warnings: [],
  });
  expect(preview.briefWords).toBe(countWords(preview.brief));
  // The same composition's size row in the report carries the same counts.
  const { report: got } = await report([], { registry: realRegistry });
  expect(
    got.sizes.find((row) => row.preset === "default" && row.with === "openrouter-chat-cli"),
  ).toMatchObject({ words: preview.briefWords, fixedWords: preview.fixedWords });
});

test("--brief failures are compose's own: an unknown stack suggests the close one [1.5#13]", async () => {
  const result = await run(["--brief", "typscript-cli", "--json"], { registry: realRegistry });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr).error).toMatchObject({
    tag: "NotFound",
    details: { suggestions: ["typescript-cli"], id: "typscript-cli", kind: "stack" },
  });
});

test("--with, --without or --sandbox without --brief is BadInput naming the flag [1.5#13]", async () => {
  const result = await run(["--sandbox", "--json"], { registry: realRegistry });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr).error).toMatchObject({
    tag: "BadInput",
    details: { id: "--sandbox", flag: "brief" },
  });
  const human = await run(["--with", "x"], { registry: realRegistry });
  expect(human.status).toBe(2);
  expect(human.stdout).toBe("");
  expect(human.stderr).toBe(
    "Invalid input.\n  Flag: --with\n  Next: --with, --without and --sandbox need --brief <stack>; add it, or drop the flag.\n",
  );
});

test("a missing path's human failure says what a valid path is", async () => {
  const home = temp();
  const result = await run([join(home, "nonexistent")], { home });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(
    `Not found.\n  Looked for: ${join(home, "nonexistent")}\n  Next: pass a registry root (a directory holding stacks/ or fragments/) or an entry directory inside one.\n`,
  );
});

test("an unknown --brief id under a root list doesn't read points at validate for that root", async () => {
  const home = temp();
  const root = join(home, "root");
  cpSync(realRegistry, root, { recursive: true });
  const result = await run([root, "--brief", "typscript-cli", "--json"], { home });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr).error).toMatchObject({
    tag: "NotFound",
    details: { suggestions: ["typescript-cli"], id: "typscript-cli", kind: "stack", root },
  });
  const human = await run([root, "--brief", "typscript-cli"], { home });
  expect(human.stderr).toBe(
    `Not found.\n  Stack: typscript-cli\n  Did you mean: typescript-cli?\n  Next: stacks validate ${root} lists the ids under that root.\n`,
  );
  // The bundled registry is what `list` shows, so its command can recover this typo.
  const bundled = await run(["--brief", "typscript-cli"], { registry: realRegistry });
  expect(bundled.stderr).toBe(
    "Not found.\n  Stack: typscript-cli\n  Did you mean: typescript-cli?\n  Next: run stacks list to see every stack and fragment id.\n",
  );
});

it.effect("validate --help documents the path and every flag", () =>
  Effect.promise(async () => {
    const result = await runCli(["validate", "--help"], { env: quiet });
    expect(result.status).toBe(0);
    for (const word of ["path", "--brief", "--with", "--without", "--sandbox"])
      expect(result.stdout).toContain(word);
  }),
);

test.each(["agent", "human"])(
  "%s validation of one fragment prints its entry counts once",
  async (audience) => {
    const root = temp();
    const entry = fragment(root, "checked");
    const result = await run([entry], { host: audience === "human" ? terminal : {} });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.match(/0 stacks, 1 fragment/g)).toHaveLength(1);
    expect(result.stdout).toContain("0 stacks, 1 fragment: 0 errors");
  },
);

test("for an agent, no size table when every size is within budget; JSON keeps every size", async () => {
  const root = temp();
  stack(root, "clean");
  const agent = await run(["."], { home: root });
  expect(agent.status).toBe(0);
  expect(agent.stderr).toBe("");
  expect(agent.stdout).toBe(
    [
      "Validated .",
      "",
      "stack clean",
      "  note     search-missing  search/stacks/clean.json: No search card; add a reviewed sidecar for search discovery.",
      "",
      "1 stack, 0 fragments: 0 errors, 0 warnings, 1 note",
      "Next: stacks validate . --brief clean --sandbox",
      "",
    ].join("\n"),
  );
  const json = await report(["."], { home: root });
  expect(json.report.sizes.map((row) => `${row.entry} ${row.kind}`)).toEqual([
    "clean body",
    "clean composed",
    "clean composed",
  ]);
});

test("for an agent, only the sizes over their limit, and the counts once", async () => {
  const root = temp();
  stack(root, "long", "", { body: `${SETUP}\n${words(2100)}\n` });
  stack(root, "short");
  const agent = await run([root]);
  expect(agent.status).toBe(2);
  expect(agent.stdout).toMatch(/\nSizes \(words\)\n {2}long body {2}2,1\d\d \/ 2,000 {3}over\n\n/);
  expect(agent.stdout).not.toContain("short body");
  expect(agent.stdout).toContain("2 stacks, 0 fragments: 1 error, 0 warnings, 2 notes\n");
  // The report on stdout ends with the counts, so stderr only names the failure.
  expect(agent.stderr).toBe("Validation failed.\n");
  const human = await run([root], { host: terminal });
  expect(human.stdout).toMatch(/\n {2}short body +\d+ \/ 2,000\n/);
  expect(human.stdout).toMatch(/\n {2}long body +2,1\d\d \/ 2,000 {3}over\n/);
});

test("for an agent, the root is relative to the working directory, and absolute outside it", async () => {
  const home = temp();
  const root = join(home, "my registry");
  stack(root, "clean");
  const inside = await run([root], { home });
  expect(inside.stdout).toMatch(/^Validated my registry\n/);
  const outside = await run([root]);
  expect(outside.stdout.startsWith(`Validated ${root}\n`)).toBe(true);
  // Real paths that differ from the given one (/var and /private/var on macOS) still nest.
  const real = await run([realpathSync(root)], { home });
  expect(real.stdout).toMatch(/^Validated my registry\n/);
  const linked = join(temp(), "link");
  symlinkSync(home, linked);
  const viaLink = await run([root], { home: linked });
  expect(viaLink.stdout).toMatch(/^Validated my registry\n/);
  // A human and --json keep the absolute root.
  const human = await run([root], { home, host: terminal });
  expect(human.stdout.startsWith(`Validated ${root}\n`)).toBe(true);
  const json = await report([root], { home });
  expect(json.report.root).toBe(root);
});

test("overlays reject unknown or unadmitted stacks and duplicate shared paths", async () => {
  const root = temp();
  stack(root, "host");
  stack(root, "other");
  const entry = fragment(root, "overlay", "applies_to: [host]");
  for (const source of [
    "files/shared.txt",
    "stacks/host/shared.txt",
    "stacks/other/other.txt",
    "stacks/missing/file.txt",
  ]) {
    const at = join(entry, source);
    mkdirSync(join(at, ".."), { recursive: true });
    writeFileSync(at, "bytes");
  }
  const { report: got } = await report([root]);
  for (const code of ["overlay-stack-unknown", "overlay-stack-fit", "overlay-path-duplicate"])
    expect(only(got.findings, code)).toEqual([
      expect.objectContaining({ severity: "error", entry: "overlay" }),
    ]);
});

test("shipped files reject conditional markers in shared, adapter and stack files but accept fill", async () => {
  const root = temp();
  stack(root, "host");
  const entry = fragment(root, "markers");
  for (const prefix of ["files", "adapters/claude", "stacks/host"]) {
    mkdirSync(join(entry, prefix), { recursive: true });
    writeFileSync(
      join(entry, prefix, "bad.md"),
      "<!-- stacks:when mode=add -->\ntext\n<!-- stacks:end -->\n",
    );
    writeFileSync(join(entry, prefix, "fill.md"), "<!-- stacks:fill: write this -->\n");
  }
  const { report: got } = await report([root]);
  const markers = only(got.findings, "shipped-conditional");
  expect(markers).toHaveLength(6);
  expect(
    markers.every((found) => found.severity === "error" && found.file?.endsWith("bad.md")),
  ).toBe(true);
});

test("validate notes missing fragment verification and duplicate commands", async () => {
  const root = temp();
  writeEntry({
    root,
    kind: "stack",
    dir: "host",
    frontmatter: minimal(
      "stack",
      "host",
      `tags: [cli, scripts]\n${STEPS}\n  - {name: second, layer: check, run: "true # test"}\nfragments:\n  default: [unchecked]`,
    ),
    body: SETUP,
  });
  writeEntry({
    root,
    kind: "fragment",
    dir: "unchecked",
    frontmatter: minimal("fragment", "unchecked"),
  });
  const { status, report: got } = await report([root]);
  expect(status).toBe(0);
  expect(only(got.findings, "fragment-no-verify")).toEqual([
    expect.objectContaining({ entry: "unchecked", severity: "note" }),
  ]);
  expect(only(got.findings, "verify-run-duplicate")).toEqual([
    expect.objectContaining({ entry: "host", severity: "note" }),
  ]);
});

test("add compositions budget add-only guidance with a host and with none", async () => {
  const root = temp();
  stack(root, "host");
  fragment(root, "large", "", `<!-- stacks:when mode=add -->\n${words(6500)}\n<!-- stacks:end -->`);
  const { report: got } = await report([root]);
  const failures = only(got.findings, "budget-add");
  expect(failures).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ severity: "error", message: expect.stringContaining("with host") }),
      expect.objectContaining({
        severity: "error",
        message: expect.stringContaining("without a stack"),
      }),
    ]),
  );
});

test("overlay compositions check imports and shipped references even when unlisted", async () => {
  const root = temp();
  stack(root, "host");
  const entry = fragment(root, "overlay");
  mkdirSync(join(entry, "stacks/host"), { recursive: true });
  mkdirSync(join(entry, "stacks/host/.claude"), { recursive: true });
  writeFileSync(
    join(entry, "stacks/host/.claude/settings.json"),
    `{"hooks":{"PreToolUse":[{"command":"bash \${CLAUDE_PROJECT_DIR}/.claude/hooks/missing.sh"}]}}`,
  );
  writeFileSync(join(entry, "stacks/host/index.ts"), 'import "./absent.ts";\n');
  const { report: got } = await report([root]);
  expect(got.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ check: "import-closure", severity: "error" }),
      expect.objectContaining({ check: "ref-hook", severity: "error" }),
    ]),
  );
});

test("preview tools use deterministic wording without claiming a PATH lookup", async () => {
  const root = temp();
  stack(root, "host", "tools: [git]");
  const preview = await run([root, "--brief", "host", "--json"]);
  const brief = Schema.decodeUnknownSync(BriefPreview)(JSON.parse(preview.stdout)).brief;
  expect(brief).not.toContain("found on PATH");
  expect(brief).toContain("PATH not checked");
});

test.each([
  { retained: 4800, note: 0, added: 800 },
  { retained: 3800, note: 950, added: 950 },
])(
  "add budgets retain the host manifest and applied-fragment notes: $note note words",
  async ({ retained, note, added }) => {
    const root = temp();
    writeEntry({
      root,
      kind: "stack",
      dir: "host",
      frontmatter: minimal(
        "stack",
        "host",
        `tags: [cli, scripts]\n${STEPS}\n  - {name: retained, layer: check, run: "echo ${words(retained)}"}\nfragments:\n  default: [applied]`,
      ),
      body: SETUP,
    });
    fragment(
      root,
      "applied",
      "",
      `<!-- stacks:when with=addon mode=add -->\n${words(note)}\n<!-- stacks:end -->`,
    );
    fragment(
      root,
      "addon",
      "applies_to: [host]",
      `<!-- stacks:when mode=add -->\n${words(added)}\n<!-- stacks:end -->`,
    );
    const { report: got } = await report([root]);
    expect(only(got.findings, "budget-composed")).toEqual([]);
    expect(only(got.findings, "budget-add")).toEqual([
      expect.objectContaining({
        entry: "addon",
        severity: "error",
        message: expect.stringContaining("with host (default, add)"),
      }),
      expect.objectContaining({
        entry: "addon",
        severity: "error",
        message: expect.stringContaining("with host (sandbox, add)"),
      }),
    ]);
  },
);

test.each([false, true])(
  "duplicate-command notes cover unlisted and stackless add compositions (host=%s)",
  async (host) => {
    const root = temp();
    if (host) stack(root, "host");
    fragment(
      root,
      "duplicate",
      'verify:\n  - {name: first, layer: check, run: "true"}\n  - {name: second, layer: check, run: "true"}',
    );
    const { status, report: got } = await report([root]);
    expect(status).toBe(0);
    const notes = only(got.findings, "verify-run-duplicate");
    expect(notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entry: "duplicate",
          severity: "note",
          message: expect.stringContaining("first, second"),
        }),
      ]),
    );
    expect(notes.some((finding) => finding.severity !== "note")).toBe(false);
  },
);
