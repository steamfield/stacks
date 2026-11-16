import { afterEach, test } from "vitest";
import { findingsAre, fragment, rotWorkspace, ship, stack, validateRot } from "./helpers/rot";
import { missingSearchNotes } from "./helpers/search-fixture";

const space = rotWorkspace();
afterEach(() => space.cleanup());
const validate = (root: string) => validateRot(root, { home: space.temp() });

test("known template variables after a dollar sign are intentional substitutions", async () => {
  const root = space.temp();
  const entry = stack(root);
  ship(entry, "files/install.sh.tmpl", `# Install in \${{env_prefix}}_INSTALL_DIR\n`);
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
  ]);
});

test("a fragment describing a stack-owned command doesn't add a new deliverable", async () => {
  const root = space.temp();
  stack(root, "sample", 'commands: { check: "Run every check" }\nfragments:\n  required: [app]');
  fragment(root, "app", 'commands: { check: "Run checks including the app" }');
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["app"] }),
  ]);
});

test("an unknown variable in a selected adapter template is a compose error", async () => {
  const root = space.temp();
  const entry = stack(root);
  ship(entry, "adapters/codex/AGENTS.md.tmpl", "{{ unknown }}\n");
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    [
      "compose",
      "error",
      { entry: "sample", file: "stacks/sample/adapters/codex/AGENTS.md.tmpl", line: 1 },
    ],
  ]);
});

test("compose-each also sees file collisions in non-default adapters", async () => {
  const root = space.temp();
  const entry = stack(root, "sample", "fragments:\n  default: [base]");
  const base = fragment(root, "base");
  const extra = fragment(root, "extra", "applies_to: [cli]");
  ship(entry, "files/README.md", "# Project\n");
  ship(base, "adapters/codex/AGENTS.md", "Base instructions.\n");
  ship(extra, "adapters/codex/AGENTS.md", "Extra instructions.\n");
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["base", "extra"] }),
    ["compose-each", "error", { entry: "extra", text: ["sample", "base", "AGENTS.md"] }],
  ]);
});

test("a listed fragment's adapter collision uses the existing compose check", async () => {
  const root = space.temp();
  stack(root, "sample", "fragments:\n  default: [base]\n  optional: [extra]");
  const base = fragment(root, "base");
  const extra = fragment(root, "extra");
  ship(base, "adapters/codex/AGENTS.md", "Base instructions.\n");
  ship(extra, "adapters/codex/AGENTS.md", "Extra instructions.\n");
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["base", "extra"] }),
    ["compose", "error", { entry: "base", text: ["sample", "base", "AGENTS.md"] }],
  ]);
});

test("comments and strings in shipped JavaScript don't create imports", async () => {
  const root = space.temp();
  const entry = stack(root);
  ship(
    entry,
    "files/main.js",
    [
      '// require("./line-comment")',
      '/* require("./block-comment") */',
      "/*",
      'import "./commented-import";',
      "*/",
      'const example = `require("./example")`;',
      "const message = \"require('./message')\";",
      'const local = require("./local");',
      "",
    ].join("\n"),
  );
  ship(entry, "files/local.js", "module.exports = {};\n");
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
  ]);
});

test("shell source paths stop before trailing comments and preserve quoted spaces", async () => {
  const root = space.temp();
  const entry = stack(root);
  ship(
    entry,
    "files/main.sh",
    '. "./local file.sh" # shared setup\nsource ./local.sh # shared setup\n',
  );
  ship(entry, "files/local file.sh", "true\n");
  ship(entry, "files/local.sh", "true\n");
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
  ]);
});

test("quoted hook paths with spaces resolve as complete paths", async () => {
  const root = space.temp();
  const entry = stack(root);
  ship(entry, "files/.claude/hooks/check file.sh", "true\n");
  ship(
    entry,
    "files/.claude/settings.json",
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { hooks: [{ command: `sh "\${CLAUDE_PROJECT_DIR}/.claude/hooks/check file.sh"` }] },
        ],
      },
    }),
  );
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
  ]);
});

test("merged permission findings blame the full rule when validating one fragment", async () => {
  const root = space.temp();
  const entry = stack(
    root,
    "sample",
    "merge: [.claude/settings.json]\nfragments:\n  required: [rules]",
  );
  const rules = fragment(root, "rules", "merge: [.claude/settings.json]");
  ship(
    entry,
    "files/.claude/settings.json",
    JSON.stringify({ description: "missing", permissions: { allow: ["Bash(git status)"] } }),
  );
  ship(
    rules,
    "files/.claude/settings.json",
    JSON.stringify({ permissions: { allow: ["Bash(bun run missing)"] } }),
  );
  const expected = [
    [
      "ref-command",
      "error",
      { entry: "rules", file: "fragments/rules/files/.claude/settings.json", text: ["missing"] },
    ],
  ] as const;
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["rules"] }),
    ...expected,
  ]);
  findingsAre((await validate(rules)).report.findings, [
    ...missingSearchNotes({ fragments: ["rules"] }),
    ...expected,
  ]);
});

test("a template error preserves kind when a stack and fragment share an id", async () => {
  const root = space.temp();
  stack(root, "sample", "fragments:\n  required: [sample]");
  const entry = fragment(root, "sample");
  ship(entry, "adapters/codex/AGENTS.md.tmpl", "{{ unknown }}\n");
  const expected = [
    [
      "compose",
      "error",
      {
        kind: "fragment",
        entry: "sample",
        file: "fragments/sample/adapters/codex/AGENTS.md.tmpl",
        line: 1,
      },
    ],
  ] as const;
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["sample"] }),
    ...expected,
  ]);
  findingsAre((await validate(entry)).report.findings, [
    ...missingSearchNotes({ fragments: ["sample"] }),
    ...expected,
  ]);
});

test.each([
  ["bun run", "test.unit"],
  ["make", "test/unit"],
])(
  "command tokens in %s %s are checked in steps, permissions and coverage",
  async (runner, target) => {
    const root = space.temp();
    const entry = stack(root, "sample", "fragments:\n  required: [task]");
    const metadata = `verify:\n  - { name: task, layer: check, run: "${runner} ${target}" }`;
    fragment(root, "task", `commands: { "${target}": "Run the task" }\n${metadata}`);
    ship(
      entry,
      "files/.claude/settings.json",
      JSON.stringify({ permissions: { allow: [`Bash(${runner} ${target}:*)`] } }),
    );
    findingsAre((await validate(root)).report.findings, [
      ...missingSearchNotes({ stacks: ["sample"], fragments: ["task"] }),
    ]);
    fragment(root, "task", metadata);
    findingsAre((await validate(root)).report.findings, [
      ...missingSearchNotes({ stacks: ["sample"], fragments: ["task"] }),

      ["undeclared-command", "warning", { entry: "task", text: [target] }],
      ["ref-command", "error", { entry: "sample", text: [target] }],
    ]);
  },
);

test("adapter-specific compose errors retain the unsafe file's source", async () => {
  const root = space.temp();
  const entry = stack(root);
  ship(entry, "adapters/codex/.stacks/unsafe.txt", "Reserved metadata.\n");
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    [
      "compose",
      "error",
      {
        entry: "sample",
        file: "stacks/sample/adapters/codex/.stacks/unsafe.txt",
        text: ["reserved_path"],
      },
    ],
  ]);
});

test("adapter-specific template merge failures are reported as compose errors", async () => {
  const root = space.temp();
  const entry = stack(root, "sample", "merge: [.claude/settings.json]");
  ship(entry, "adapters/codex/.claude/settings.json.tmpl", "{}\n");
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    [
      "compose",
      "error",
      {
        entry: "sample",
        file: "stacks/sample/adapters/codex/.claude/settings.json.tmpl",
        text: ["merge_template"],
      },
    ],
  ]);
});

test("an optional fragment's adapter template merge failure is not discarded", async () => {
  const root = space.temp();
  stack(root, "sample", "fragments:\n  optional: [rules]");
  const entry = fragment(root, "rules", "merge: [.claude/settings.json]");
  ship(entry, "adapters/codex/.claude/settings.json.tmpl", "{}\n");
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["rules"] }),
    [
      "compose",
      "error",
      {
        entry: "rules",
        file: "fragments/rules/adapters/codex/.claude/settings.json.tmpl",
        text: ["merge_template"],
      },
    ],
  ]);
});

test("compose-each replaces defaults whose conflicts name the added fragment", async () => {
  const root = space.temp();
  stack(root, "sample", "fragments:\n  default: [base]");
  fragment(root, "base", "conflicts: [extra]");
  fragment(root, "extra", "applies_to: [cli]");
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["base", "extra"] }),
  ]);
});

test("compose-each does not budget applicable compositions", async () => {
  const root = space.temp();
  stack(
    root,
    "sample",
    "fragments:\n  default: [one, two, three, four]",
    `## Setup\n\n${"word ".repeat(1_000)}\n`,
  );
  for (const id of ["one", "two", "three", "four"]) fragment(root, id, "", "word ".repeat(900));
  fragment(root, "extra", "applies_to: [cli]", "word ".repeat(900));
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({
      stacks: ["sample"],
      fragments: ["extra", "four", "one", "three", "two"],
    }),
  ]);
});
