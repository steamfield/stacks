import { cpSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  findingsAre,
  fragment,
  rotWorkspace,
  setupBody,
  ship,
  stack,
  validateRot,
} from "./helpers/rot";
import { missingSearchNotes, reviewSearchFixture } from "./helpers/search-fixture";

const space = rotWorkspace();
afterEach(() => space.cleanup());
const validate = (root: string) => validateRot(root, { home: space.temp() });
const settings = (entry: string, value: unknown, agent = "claude") =>
  ship(entry, `adapters/${agent}/.claude/settings.json`, JSON.stringify(value));
const hook = (file: string) => ({
  hooks: {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [{ type: "command", command: `sh "\${CLAUDE_PROJECT_DIR}/.claude/hooks/${file}"` }],
      },
    ],
  },
});

test.each(["args", "runtimeArgs"])(
  "launch %s names a missing command; inline-code command declarations satisfy permission rules [2.2#2]",
  async (field) => {
    const root = space.temp();
    const entry = stack(
      root,
      "sample",
      "",
      `${setupBody}\nImplement \`stub\` before running it.\n`,
    );
    ship(
      entry,
      "files/.vscode/launch.json",
      JSON.stringify({
        configurations: [
          { type: "node", request: "launch", name: "Ask", [field]: ["ask", "hello"] },
        ],
      }),
    );
    settings(entry, {
      permissions: { allow: ["Bash(bun run stub)"], deny: ["Bash(npm run stub)"] },
    });
    const { report, status } = await validate(root);
    findingsAre(report.findings, [
      ...missingSearchNotes({ stacks: ["sample"] }),
      [
        "ref-command",
        "error",
        { entry: "sample", file: "stacks/sample/files/.vscode/launch.json", text: ["ask"] },
      ],
    ]);
    expect(status).toBe(2);
    expect(report.findings[0]?.message).toContain("ask");
  },
);

test.each(["make", "bun run", "npm run", "pnpm", "pnpm run"])(
  "allow and deny %s rules check the merged commands without treating tools as commands [2.2#2]",
  async (runner) => {
    const root = space.temp();
    const entry = stack(root, "sample", 'commands: { lint: "Lint" }');
    settings(entry, {
      permissions: {
        allow: [`Bash(${runner} lint:*)`, "Bash(git status:*)"],
        deny: [`Bash(${runner} missing:*)`],
      },
    });
    const { report } = await validate(root);
    findingsAre(report.findings, [
      ...missingSearchNotes({ stacks: ["sample"] }),
      [
        "ref-command",
        "error",
        {
          entry: "sample",
          file: "stacks/sample/adapters/claude/.claude/settings.json",
          text: ["missing"],
        },
      ],
    ]);
    expect(report.findings[0]?.message).toContain("missing");
  },
);

test("a command declared by a fragment satisfies the stack's shipped permission rule [2.2#2]", async () => {
  const root = space.temp();
  const entry = stack(root, "sample", "fragments:\n  required: [tools]");
  settings(entry, { permissions: { allow: ["Bash(make lint)", "Bash(make lnt)"] } });
  fragment(
    root,
    "tools",
    'commands: { lint: "Lint" }\nverify:\n  - { name: fragment-lint, layer: check, run: "make lint" }',
  );
  const { report } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["tools"] }),
    [
      "ref-command",
      "error",
      {
        entry: "sample",
        file: "stacks/sample/adapters/claude/.claude/settings.json",
        text: ["lnt"],
      },
    ],
  ]);
  expect(report.findings[0]?.message).toContain("lnt");
});

test("reference checks read neutral-rendered templates and accept commands declared by rendered name [2.2#2]", async () => {
  const root = space.temp();
  const entry = stack(root);
  ship(
    entry,
    "files/.claude/settings.json.tmpl",
    JSON.stringify({
      permissions: { allow: ["Bash(bun run {{ project_slug }})"] },
    }),
  );
  const bad = await validate(root);
  findingsAre(bad.report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    [
      "ref-command",
      "error",
      {
        entry: "sample",
        file: "stacks/sample/files/.claude/settings.json.tmpl",
        text: ["example"],
      },
    ],
  ]);
  expect(bad.report.findings[0]?.message).not.toContain("{{ project_slug }}");
  stack(root, "sample", 'commands: { example: "Run the project" }');
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
  ]);
});

test("missing hook files fail while hooks shipped by a merged settings owner's sibling pass [2.2#3]", async () => {
  const root = space.temp();
  const entry = stack(
    root,
    "sample",
    "merge: [.claude/settings.json]\nfragments:\n  required: [hooks]",
  );
  settings(entry, hook("missing.sh"));
  const hooks = fragment(root, "hooks", "merge: [.claude/settings.json]");
  settings(hooks, hook("present.sh"));
  // The hook named by the fragment lives in the other settings owner.
  ship(entry, "files/.claude/hooks/present.sh", "#!/bin/sh\nexit 0\n");
  const { report } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["hooks"] }),
    ["ref-hook", "error", { text: ["missing.sh"] }],
  ]);
  expect(report.findings[0]?.message).toContain("missing.sh");
  settings(entry, hook("present.sh"));
  settings(hooks, hook("fragment-missing.sh"));
  const inverse = await validate(root);
  findingsAre(inverse.report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["hooks"] }),
    ["ref-hook", "error", { text: ["fragment-missing.sh"] }],
  ]);
});

test("reference checks visit codex-only adapters as well as the default Claude adapter [2.2#3]", async () => {
  const root = space.temp();
  const entry = stack(root);
  settings(entry, hook("missing.sh"), "codex");
  const { report } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    [
      "ref-hook",
      "error",
      {
        entry: "sample",
        file: "stacks/sample/adapters/codex/.claude/settings.json",
        text: ["missing.sh"],
      },
    ],
  ]);
  expect(report.findings[0]?.message).toContain("missing.sh");
});

test.each(["localhost", "127.0.0.1"])(
  "literal %s ports warn only in settings and VS Code JSON when a PORT segment is declared [2.2#4]",
  async (host) => {
    const root = space.temp();
    const entry = stack(root, "sample", 'env: { PORT_WEB: "5173" }');
    settings(entry, { permissions: { allow: [`Bash(curl http://${host}:5173)`] } });
    ship(entry, "files/.vscode/settings.json", JSON.stringify({ endpoint: `http://${host}:5173` }));
    ship(entry, "files/.env.example", `URL=http://${host}:5173\n`);
    ship(entry, "files/fixture.json", JSON.stringify({ endpoint: `http://${host}:5173` }));
    const { report, status } = await validate(root);
    findingsAre(report.findings, [
      ...missingSearchNotes({ stacks: ["sample"] }),
      [
        "ref-port",
        "warning",
        {
          entry: "sample",
          file: "stacks/sample/adapters/claude/.claude/settings.json",
          text: ["5173"],
        },
      ],
      [
        "ref-port",
        "warning",
        { entry: "sample", file: "stacks/sample/files/.vscode/settings.json", text: ["5173"] },
      ],
    ]);
    expect(status).toBe(0);
  },
);

test("PORT is an env-name segment, and expanded ports don't produce literal-port warnings [2.2#4]", async () => {
  const root = space.temp();
  const port = stack(root, "declared", 'env: { WEB_PORT_HTTP: "5173" }');
  settings(port, {
    endpoint: "http://localhost:5173",
    variable: `http://localhost:\${WEB_PORT_HTTP}`,
  });
  const noPort = stack(root, "ordinary", 'env: { TELEPORT: "yes" }');
  settings(noPort, { endpoint: "http://localhost:5173" });
  const { report } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["declared", "ordinary"] }),
    [
      "ref-port",
      "warning",
      {
        entry: "declared",
        file: "stacks/declared/adapters/claude/.claude/settings.json",
        text: ["5173"],
      },
    ],
  ]);
});

test("a default fragment is not an import dependency; requiring it makes the same import valid [2.2#5]", async () => {
  const root = space.temp();
  const entry = stack(root, "sample", "fragments:\n  default: [helper]");
  ship(entry, "files/main.ts", 'import { helper } from "./_lib.js";\nhelper();\n');
  const helper = fragment(root, "helper");
  ship(helper, "files/_lib.ts", "export const helper = () => 1;\n");
  const bad = await validate(root);
  findingsAre(bad.report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["helper"] }),
    [
      "import-closure",
      "error",
      { entry: "sample", file: "stacks/sample/files/main.ts", text: ["_lib", "helper"] },
    ],
  ]);
  expect(bad.report.findings[0]?.message).toContain("main.ts");
  expect(bad.report.findings[0]?.message).toContain("_lib");
  expect(bad.report.findings[0]?.message).toContain("helper");
  expect(bad.report.findings[0]?.message).toContain("fragments.required");
  stack(root, "sample", "fragments:\n  required: [helper]");
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["helper"] }),
  ]);
});

test("two requires hops allow a fragment's import, but applies_to never grants ownership [2.2#5]", async () => {
  const root = space.temp();
  stack(root, "sample", "fragments:\n  required: [consumer]");
  const consumer = fragment(root, "consumer", "requires: [middle]");
  ship(consumer, "files/consumer.ts", 'export { shared } from "./shared";\n');
  fragment(root, "middle", "requires: [producer]");
  const producer = fragment(root, "producer");
  ship(producer, "files/shared.ts", "export const shared = 1;\n");
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["consumer", "middle", "producer"] }),
  ]);
  fragment(root, "consumer", "applies_to: [sample]");
  stack(root, "sample", "fragments:\n  required: [consumer]\n  default: [producer]");
  const bad = await validate(root);
  findingsAre(bad.report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["consumer", "middle", "producer"] }),

    [
      "import-closure",
      "error",
      {
        entry: "consumer",
        file: "fragments/consumer/files/consumer.ts",
        text: ["shared", "producer"],
      },
    ],
  ]);
  expect(bad.report.findings[1]?.message).toContain("requires");
});

test("a stack overlay may import its host stack's files; the shared files tree may not", async () => {
  const root = space.temp();
  const host = stack(root, "sample", "fragments:\n  optional: [addon]");
  ship(host, "files/config.ts", "export const config = 1;\n");
  const addon = fragment(root, "addon", "applies_to: [sample]");
  ship(addon, "stacks/sample/feature.ts", 'import { config } from "./config";\nconfig;\n');
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["addon"] }),
  ]);
  ship(addon, "files/shared.ts", 'import { config } from "./config";\nconfig;\n');
  findingsAre((await validate(root)).report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["addon"] }),
    [
      "import-closure",
      "error",
      { entry: "addon", file: "fragments/addon/files/shared.ts", text: ["config", "sample"] },
    ],
  ]);
});

test.each([
  ["main.ts", 'import "./lib";\n'],
  ["main.tsx", 'import { value } from "./lib/index.js";\n'],
  ["main.js", 'export { value } from "./lib";\n'],
  ["main.mjs", 'const lib = require("./lib");\n'],
  ["main.sh", '. "$CLAUDE_PROJECT_DIR/lib/load.sh"\n'],
  ["hooks/main.sh", 'source "$SCRIPT_DIR/../lib/load.sh"\n'],
])(
  "relative imports in %s resolve extensions, directory indexes and shell variables [2.2#5]",
  async (name, text) => {
    const root = space.temp();
    const entry = stack(root, "sample", "fragments:\n  default: [library]");
    ship(entry, `files/${name}`, text);
    const lib = fragment(root, "library");
    ship(lib, "files/lib/index.ts", "export const value = 1;\n");
    ship(lib, "files/lib/load.sh", "#!/bin/sh\ntrue\n");
    findingsAre((await validate(root)).report.findings, [
      ...missingSearchNotes({ stacks: ["sample"], fragments: ["library"] }),
      [
        "import-closure",
        "error",
        { entry: "sample", file: `stacks/sample/files/${name}`, text: ["library"] },
      ],
    ]);
    stack(root, "sample", "fragments:\n  required: [library]");
    findingsAre((await validate(root)).report.findings, [
      ...missingSearchNotes({ stacks: ["sample"], fragments: ["library"] }),
    ]);
  },
);

test("missing relative imports fail while self-owned and package imports pass [2.2#5]", async () => {
  const root = space.temp();
  const entry = stack(root);
  ship(entry, "files/main.ts", 'import "effect";\nimport "./local";\nimport "./missing";\n');
  ship(entry, "files/local.ts", "export {};\n");
  const { report } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    [
      "import-closure",
      "error",
      { entry: "sample", file: "stacks/sample/files/main.ts", line: 3, text: ["missing"] },
    ],
  ]);
  expect(report.findings[0]?.message).toContain("missing");
});

test("fragment command deliverables need verify coverage while stack dev and clean are exempt [2.2#1]", async () => {
  const root = space.temp();
  stack(
    root,
    "sample",
    'commands: { dev: "Start dev", clean: "Clean" }\nfragments:\n  required: [check]',
  );
  fragment(
    root,
    "check",
    'commands: { audit: "Audit", format: "Format" }\nverify:\n  - { name: audit, layer: check, run: "bun run audit" }',
  );
  const { report } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["sample"], fragments: ["check"] }),
    [
      "ref-command-coverage",
      "warning",
      { entry: "check", file: "fragments/check/FRAGMENT.md", text: ["format"] },
    ],
  ]);
  expect(report.findings[1]?.message).toContain("format");
});

test("malformed reference JSON reports one error per file and skips cascading reference findings [2.2#13]", async () => {
  const root = space.temp();
  const entry = stack(root, "sample", 'env: { PORT_WEB: "5173" }');
  ship(
    entry,
    "files/.claude/settings.json",
    '{"permissions":{"allow":["Bash(bun run missing)"]},"url":"http://localhost:5173",',
  );
  ship(entry, "files/.vscode/launch.json", '{"configurations":[{"args":["missing"]}],');
  ship(entry, "files/.vscode/settings.json", '{"endpoint":"http://localhost:5173"}');
  const { report, status } = await validate(root);
  findingsAre(report.findings, [
    ...missingSearchNotes({ stacks: ["sample"] }),
    ["ref-json", "error", { entry: "sample", file: "stacks/sample/files/.claude/settings.json" }],
    ["ref-json", "error", { entry: "sample", file: "stacks/sample/files/.vscode/launch.json" }],
    [
      "ref-port",
      "warning",
      { entry: "sample", file: "stacks/sample/files/.vscode/settings.json", text: ["5173"] },
    ],
  ]);
  expect(status).toBe(2);
});

test("the shipped entry bodies have zero errors and warnings with every rot check enabled [2.2#9]", async () => {
  const root = space.temp();
  cpSync(join(import.meta.dirname, "..", "registry"), root, { recursive: true });
  reviewSearchFixture(root);
  const { report, status } = await validateRot(root, {
    home: space.temp(),
    bundled: true,
    env: { PATH: process.env.PATH ?? "" },
  });
  expect(status).toBe(0);
  expect(report.bundled).toBe(true);
  expect(report.findings.filter((f) => f.severity !== "note")).toEqual([]);
  // This walks every shipped entry and composition; concurrent gates can exceed Vitest's 5 s.
}, 30_000);
