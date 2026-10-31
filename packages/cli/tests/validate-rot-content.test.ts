import { existsSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { spawnGit } from "./helpers/git";
import {
  findingsAre,
  fragment,
  lineOf,
  rotWorkspace,
  setupBody,
  ship,
  stack,
  validateRot,
} from "./helpers/rot";
import { missingSearchNotes } from "./helpers/search-fixture";

const space = rotWorkspace();
afterEach(() => space.cleanup());
const validate = (root: string) => validateRot(root, { home: space.temp() });

test("a listed fragment's undeclared collision uses the existing composition check [2.2#1]", async () => {
  const root = space.temp();
  stack(root, "conflicting", "fragments:\n  default: [base]\n  optional: [extra]");
  stack(root, "compatible", "fragments:\n  optional: [extra]");
  const base = fragment(root, "base");
  const extra = fragment(root, "extra");
  ship(base, "files/shared.txt", "Base file.\n");
  ship(extra, "files/shared.txt", "Extra file.\n");
  const { report, status } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["compatible", "conflicting"], fragments: ["base", "extra"] }),
    ["compose", "error", { entry: "conflicting", text: ["extra", "base"] }],
  ]);
  expect(status).toBe(2);
  expect(report.findings[1]?.message).toContain("conflicting");
});

test("compose-each checks an undeclared collision for an unlisted tag-applicable fragment [2.2#1]", async () => {
  const root = space.temp();
  stack(root, "sample", "fragments:\n  default: [base]");
  const base = fragment(root, "base");
  const extra = fragment(root, "extra", "applies_to: [cli]");
  ship(base, "files/shared.txt", "Base file.\n");
  ship(extra, "files/shared.txt", "Extra file.\n");
  const { report } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["base", "extra"] }),
    ["compose-each", "error", { text: ["extra", "base", "sample"] }],
  ]);
});

test("a tag-applicable fragment replaces a default it declares a conflict with [2.2#1]", async () => {
  const root = space.temp();
  stack(root, "sample", "fragments:\n  default: [base]");
  fragment(root, "base");
  fragment(root, "extra", "applies_to: [cli]\nconflicts: [base]");
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["base", "extra"] }),
  ]);
});

test("dead stack branches warn, --with-only branches note, listed branches are reachable [2.2#1]", async () => {
  const root = space.temp();
  stack(root, "go-stack", "fragments:\n  optional: [listed]");
  stack(root, "python");
  const branch = "<!-- stacks:when stack=go-stack -->\nUse Go.\n<!-- stacks:end -->\n";
  fragment(root, "dead", "applies_to: [python]", branch);
  fragment(root, "manual", "applies_to: [cli]", branch);
  fragment(root, "listed", "", branch);
  const { report } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({
      stacks: ["go-stack", "python"],
      fragments: ["dead", "listed", "manual"],
    }),
    [
      "conditional-dead-branch",
      "warning",
      {
        kind: "fragment",
        entry: "dead",
        file: "fragments/dead/FRAGMENT.md",
        line: lineOf(join(root, "fragments/dead/FRAGMENT.md"), "<!-- stacks:when"),
        text: ["go-stack"],
      },
    ],
    [
      "conditional-dead-branch",
      "note",
      {
        kind: "fragment",
        entry: "manual",
        file: "fragments/manual/FRAGMENT.md",
        line: lineOf(join(root, "fragments/manual/FRAGMENT.md"), "<!-- stacks:when"),
        text: ["go-stack"],
      },
    ],
  ]);
  expect(report.findings.map((f) => [f.entry, f.severity])).toEqual([
    ["go-stack", "note"],
    ["python", "note"],
    ["dead", "warning"],
    ["dead", "note"],
    ["listed", "note"],
    ["manual", "note"],
    ["manual", "note"],
  ]);
  for (const finding of [report.findings[2], report.findings[5]]) {
    expect(finding?.file).toBe(`fragments/${finding?.entry}/FRAGMENT.md`);
    expect(finding?.line).toBeGreaterThan(0);
    expect(finding?.message).toContain("go-stack");
  }
});

test.each(["make", "bun run", "npm run", "pnpm", "pnpm run", "yarn", "yarn run"])(
  "%s verify steps warn only for commands missing from the composed table [2.2#1]",
  async (runner) => {
    const root = space.temp();
    stack(root, "sample", 'commands: { lint: "Lint the project" }\nfragments:\n  default: [check]');
    fragment(
      root,
      "check",
      `verify:\n  - { name: typo, layer: check, run: "${runner} lnt" }\n  - { name: correct, layer: check, run: "${runner} lint" }`,
    );
    const { report, warnings } = await validate(root);
    findingsAre(report.findings, [
      ...missingSearchNotes({ stacks: ["sample"], fragments: ["check"] }),
      ["undeclared-command", "warning", { text: ["lnt"] }],
    ]);
    expect(warnings).toBe(1);
    expect(report.findings[1]?.message).toContain("lnt");
  },
);

test("a command supplied by one stack doesn't hide its absence in another composition [2.2#1]", async () => {
  const root = space.temp();
  stack(root, "declared", 'commands: { lint: "Lint" }\nfragments:\n  default: [check]');
  stack(root, "missing", "fragments:\n  default: [check]");
  fragment(root, "check", 'verify:\n  - { name: check-lint, layer: check, run: "make lint" }');
  const { report } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["declared", "missing"], fragments: ["check"] }),
    ["undeclared-command", "warning", { text: ["missing", "lint"] }],
  ]);
  expect(report.findings[2]?.message).toContain("missing");
});

test("a bare Actions expression in a template warns while dotted and literal expressions pass [2.2#1]", async () => {
  const root = space.temp();
  stack(root);
  // Unselected fragments isolate the content warning from rendering's unknown-variable error.
  const bad = fragment(root, "bad");
  ship(bad, "files/action.yml.tmpl", `value: \${{ github }}\n`);
  const good = fragment(root, "good");
  ship(good, "files/action.yml.tmpl", `value: \${{ github.sha }}\n`);
  ship(good, "files/literal.yml", `value: \${{ github }}\n`);
  const { report } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["bad", "good"] }),
    [
      "template-expression",
      "warning",
      { kind: "fragment", entry: "bad", file: "fragments/bad/files/action.yml.tmpl", line: 1 },
    ],
  ]);
  expect(report.findings[1]).toMatchObject({
    entry: "bad",
    file: "fragments/bad/files/action.yml.tmpl",
    line: 1,
  });
});

test("underlined headings warn while ATX headings and thematic breaks pass [2.2#1]", async () => {
  const root = space.temp();
  stack(root);
  fragment(root, "underlined-top", "", "Title\n=====\n");
  fragment(root, "underlined-sub", "", "Subtitle\n-----\n");
  fragment(root, "ordinary", "", "# Title\n\nText.\n\n---\n\n## Subtitle\n");
  const { report } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({
      stacks: ["sample"],
      fragments: ["ordinary", "underlined-sub", "underlined-top"],
    }),
    [
      "setext-heading",
      "warning",
      { entry: "underlined-top", file: "fragments/underlined-top/FRAGMENT.md" },
    ],
    [
      "setext-heading",
      "warning",
      { entry: "underlined-sub", file: "fragments/underlined-sub/FRAGMENT.md" },
    ],
  ]);
});

test.each([
  "Cargo.toml",
  "compose.yaml",
  ".goreleaser.yml",
  "biome.jsonc",
  "playwright.config.ts",
  "orval.config.ts",
])(
  "shipping a pinned version in %s warns, including adapter files and dropped template suffixes [2.2#1]",
  async (name) => {
    const root = space.temp();
    const entry = stack(root);
    ship(entry, `files/${name}`, 'version = "1.2.3"\n');
    ship(entry, `adapters/codex/nested/${name}.tmpl`, 'version = "1.2.3"\n');
    ship(entry, "files/README.md", "# Project\n");
    const { report } = await validate(root);
    findingsAre(report.findings, [
      ...missingSearchNotes({ stacks: ["sample"] }),
      [
        "version-sensitive-file",
        "warning",
        { entry: "sample", file: `stacks/sample/files/${name}`, text: ["1.2.3"] },
      ],
      [
        "version-sensitive-file",
        "warning",
        {
          entry: "sample",
          file: `stacks/sample/adapters/codex/nested/${name}.tmpl`,
          text: ["1.2.3"],
        },
      ],
    ]);
    expect(report.findings.map((f) => f.file).sort()).toEqual(
      [
        "search/stacks/sample.json",
        `stacks/sample/adapters/codex/nested/${name}.tmpl`,
        `stacks/sample/files/${name}`,
      ].sort(),
    );
  },
);

test.each([
  ["package.json", '{"name":"sample","type":"module","scripts":{"check":"true"}}'],
  ["package.json.tmpl", '{"name":"{{project_slug}}","type":"module"}'],
  ["tsconfig.json", '{"compilerOptions":{"strict":true}}'],
  [".golangci.yml", 'version: "2"\n'],
  ["biome.json.tmpl", '{"formatter":{"enabled":true}}'],
  ["src/index.ts", 'export const version = "1.2.3";\n'],
  [".github/workflows/ci.yml", `if: \${{ github.run_number > 1 && github.run_number < 5 }}\n`],
  ["biome.jsonc", '// "engines": intentionally omitted\n{"formatter":{"enabled":true}}'],
  ["biome.jsonc", '/* {"packageManager":"omitted"} */\n{"formatter":{"enabled":true}}'],
  ["biome.jsonc", JSON.stringify({ description: 'The "engines": key is intentionally omitted' })],
])("shipping version-free config or uninspected source %s passes", async (name, text) => {
  const root = space.temp();
  const entry = stack(root);
  ship(entry, `files/${name}`, text);
  const { report } = await validate(root);
  findingsAre(report.findings, [...missingSearchNotes({ stacks: ["sample"] })]);
});

test.each([
  ["package.json", '{"dependencies":{"effect":"1.2.3"}}', "1.2.3"],
  ["package.json", '{"dependencies":{"effect":"^4.0.0"}}', "^4.0.0"],
  ["package.json", '{"dependencies":{"effect":"~1.2"}}', "~1.2"],
  ["package.json", '{"dependencies":{"effect":">=22"}}', ">=22"],
  ["package.json", '{"dependencies":{"effect":"<=4.0"}}', "<=4.0"],
  ["package.json", '{"dependencies":{"effect":">4"}}', ">4"],
  ["package.json", '{"dependencies":{"effect":"<5"}}', "<5"],
  ["package.json", '{"packageManager":"bun@1.2.3"}', '"packageManager"'],
  ["package.json", '{"engines":{"node":"22"}}', '"engines"'],
  ["go.mod", "module example.com/sample\n\ngo 1.24\n", "go 1.24"],
  ["go.mod", "module example.com/sample\n\ntoolchain go1.24\n", "toolchain go1.24"],
  [".github/workflows/ci.yml", "steps:\n  - uses: actions/checkout@v4\n", "actions/checkout@v4"],
  [
    ".github/workflows/ci.yml",
    "steps:\n  - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567\n",
    "actions/checkout@0123456789abcdef0123456789abcdef01234567",
  ],
  ["biome.json", '{"$schema":"https://biomejs.dev/schemas/2.1.0/schema.json"}', "2.1.0"],
  [
    "biome.jsonc",
    '{"$schema":"https://example.com/schema.json","engines":{"node":"22"}}',
    '"engines"',
  ],
  ["biome.jsonc", '// Previously used 1.2.3\n{"formatter":{"enabled":true}}', "1.2.3"],
  ["package.json.tmpl", '{"name":"{{project_slug}}","dependencies":{"effect":"^4.0.0"}}', "^4.0.0"],
])("shipping a version literal in %s warns once: %s", async (name, text, literal) => {
  const root = space.temp();
  const entry = stack(root);
  ship(entry, `files/${name}`, text);
  const { report } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    [
      "version-sensitive-file",
      "warning",
      {
        entry: "sample",
        file: `stacks/sample/files/${name}`,
        text: [literal, "remove", "agent", "current"],
      },
    ],
  ]);
});

test("a file with several version literals names only the first in source order", async () => {
  const root = space.temp();
  const entry = stack(root);
  ship(
    entry,
    "files/package.json",
    '{"dependencies":{"effect":"~4","other":"1.2.3"},"engines":{"node":">=22"}}',
  );
  const { report } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    [
      "version-sensitive-file",
      "warning",
      { entry: "sample", file: "stacks/sample/files/package.json", text: ["~4"] },
    ],
  ]);
  const versionFinding = report.findings.find(
    (finding) => finding.check === "version-sensitive-file",
  );
  expect(versionFinding?.message).not.toContain("1.2.3");
  expect(versionFinding?.message).not.toContain("engines");
});

test.each(["body", "decisions", "markdown"])(
  "pinned versions in %s warn without matching IPv4 addresses or fenced examples [2.2#1]",
  async (location) => {
    const root = space.temp();
    const text = "Use 1.27.2\nHosts 127.0.0.1 and 0.0.0.0.\n\n```text\nUse 8.9.10\n```\n";
    const entry = stack(
      root,
      "sample",
      location === "decisions" ? 'decisions: ["Version 1.27.2 (default)"]' : "",
      location === "body" ? setupBody + text : setupBody,
    );
    if (location === "markdown") ship(entry, "files/README.md.tmpl", text);
    const { report } = await validate(root);
    findingsAre(report.findings, [
      ...missingSearchNotes({ stacks: ["sample"] }),
      [
        "pinned-version",
        "warning",
        {
          entry: "sample",
          file:
            location === "markdown"
              ? "stacks/sample/files/README.md.tmpl"
              : "stacks/sample/STACK.md",
          text: ["1.27.2"],
        },
      ],
    ]);
    expect(report.findings[0]?.message).toContain("1.27.2");
  },
);

test("each known dated phrase warns; version-less prerelease advice and fenced text pass [2.2#6]", async () => {
  const root = space.temp();
  stack(root);
  fragment(root, "dated", "", "while published only under the rc dist-tag\n");
  fragment(
    root,
    "current",
    "",
    "if the latest release is still a prerelease\n\n```text\nwhile published rc dist-tag alpha nightly canary\n```\n",
  );
  const { report } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["current", "dated"] }),
    ...["while published", "rc", "dist-tag"].map(
      (phrase) =>
        [
          "dated-phrase",
          "warning",
          {
            entry: "dated",
            file: "fragments/dated/FRAGMENT.md",
            line: lineOf(join(root, "fragments/dated/FRAGMENT.md"), "while published"),
            text: [phrase],
          },
        ] as const,
    ),
  ]);
  expect(report.findings.map((f) => f.entry)).toEqual([
    "sample",
    "current",
    "dated",
    "dated",
    "dated",
    "dated",
  ]);
});

test.each(["ALPHA", "Nightly", "canary", "as of March", "as of 2026", "October 2026"])(
  "dated phrase %s is found in decisions and shipped Markdown [2.2#6]",
  async (phrase) => {
    const root = space.temp();
    const entry = stack(root, "sample", `decisions: ["${phrase} (default)"]`);
    ship(entry, "files/README.md", `${phrase}\n`);
    const { report } = await validate(root);
    findingsAre(report.findings, [
      ...missingSearchNotes({ stacks: ["sample"] }),
      ["dated-phrase", "warning", { entry: "sample", file: "stacks/sample/STACK.md" }],
      [
        "dated-phrase",
        "warning",
        { entry: "sample", file: "stacks/sample/files/README.md", line: 1 },
      ],
    ]);
  },
);

test("fence styles, CRLF and word boundaries don't turn examples or IP addresses into prose findings [2.2#12]", async () => {
  const root = space.temp();
  stack(
    root,
    "sample",
    "",
    setupBody +
      [
        "Stable release 1.27.2",
        "ALPHA release",
        "",
        "~~~text",
        "rc 2.3.4",
        "~~~",
        "",
        "```text",
        "nightly 3.4.5",
        "```",
        "",
        "127.0.0.1 0.0.0.0 11.22.33.44",
        "alphabet canarybird nightlyjob rcfile beta prerelease Effect 4",
        "",
      ].join("\r\n"),
  );
  const { report } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    [
      "pinned-version",
      "warning",
      { entry: "sample", file: "stacks/sample/STACK.md", text: ["1.27.2"] },
    ],
    [
      "dated-phrase",
      "warning",
      { entry: "sample", file: "stacks/sample/STACK.md", text: ["ALPHA"] },
    ],
  ]);
});

test("a symlinked root and paths with spaces and non-ASCII text retain real source locations [2.2#10]", async () => {
  const home = space.temp();
  const root = join(home, "registry café");
  const entry = stack(root);
  ship(entry, "files/-notes café.md.tmpl", "Use 1.27.2\n");
  const alias = join(home, "linked registry");
  symlinkSync(root, alias);
  const first = await validateRot(alias, { home });
  const second = await validateRot(realpathSync(root), { home });
  findingsAre(first.report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    [
      "pinned-version",
      "warning",
      {
        entry: "sample",
        file: "stacks/sample/files/-notes café.md.tmpl",
        line: 1,
        text: ["1.27.2"],
      },
    ],
  ]);
  expect(first.report.findings).toEqual(second.report.findings);
  expect(first.report.findings[0]?.file).toBe("stacks/sample/files/-notes café.md.tmpl");
});

test("validation in an author's checkout ignores repository-selecting env and never runs verify commands [2.2#11]", async () => {
  const home = space.temp();
  const root = join(home, "registry");
  mkdirSync(root);
  expect(spawnGit(["init", "-q", root]).status).toBe(0);
  const elsewhere = space.temp();
  expect(spawnGit(["init", "-q", elsewhere]).status).toBe(0);
  const entry = stack(root, "sample", "fragments:\n  default: [check]");
  ship(entry, "files/.gitignore", "ignored.txt\n");
  ship(entry, "files/ignored.txt", "This entry file is accidentally ignored.\n");
  fragment(
    root,
    "check",
    'verify:\n  - { name: missing, layer: check, run: "make lnt; touch executed" }',
  );
  const { report } = await validateRot(root, {
    home,
    cwd: elsewhere,
    env: {
      PATH: process.env.PATH ?? "",
      GIT_DIR: join(elsewhere, ".git"),
      GIT_WORK_TREE: elsewhere,
      CLAUDECODE: "1",
    },
  });
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["check"] }),
    ["undeclared-command", "warning", { text: ["lnt"] }],
    ["git-ignored", "warning", { entry: "sample", file: "stacks/sample/files/ignored.txt" }],
  ]);
  expect(existsSync(join(root, "executed"))).toBe(false);
  expect(existsSync(join(elsewhere, "executed"))).toBe(false);
});
