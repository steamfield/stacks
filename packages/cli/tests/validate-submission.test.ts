import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { skeleton } from "../src/core/create-text";
import { ValidateReport } from "../src/schemas/validate";
import { runCli, tempDir } from "./helpers/cli";
import { emptyRegistry } from "./helpers/registry";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A user registry under a fresh home, and a scaffolded entry with its description written. */
function setup(kind: "stack" | "fragment" = "stack", id = "demo-app") {
  const home = tempDir();
  cleanups.push(home.cleanup);
  const root = join(home.path, "config", "stacks");
  const dir = join(root, kind === "stack" ? "stacks" : "fragments", id);
  mkdirSync(dir, { recursive: true });
  const markdown = join(dir, kind === "stack" ? "STACK.md" : "FRAGMENT.md");
  writeFileSync(
    markdown,
    skeleton(kind, id, "ci").replace(/"stacks:fill: describe the \w+"/, '"A demo entry."'),
  );
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  return { home: home.path, root, dir, markdown, write };
}

/** The CLI with an empty bundled registry, which still supplies the search vocabulary. */
const cli = (args: string[], options: { home: string; env?: Record<string, string> }) =>
  runCli(args, { ...options, host: { registry: emptyRegistry } });

/** Every finding that isn't a note, as `[check, severity, file, line]`. */
async function validateSubmission(home: string, dir: string) {
  const run = await cli(["validate", dir, "--submission", "--json"], { home });
  const report = Schema.decodeUnknownSync(ValidateReport)(JSON.parse(run.stdout));
  return {
    run,
    findings: report.findings
      .filter((finding) => finding.severity !== "note")
      .map((finding) => [finding.check, finding.severity, finding.file, finding.line]),
  };
}

const missingCard = ["missing-card", "warning", "search/stacks/demo-app.json", undefined];

// Credential-shaped values are assembled at run time so no source file holds one.
const githubToken = ["gh", "p_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"].join("");
const pemHeader = ["-----BEGIN", "RSA PRIVATE", "KEY-----"].join(" ");
const homePath = ["", "Users", "someone", "work", "notes.md"].join("/");

test("a scaffolded entry with its description written passes, warning only that it has no card", async () => {
  const { home, dir, write } = setup();
  write("files/README.md", "<!-- stacks:fill: describe the project -->\n");
  write("files/.env.example", "API_KEY=your-api-key-here\n");
  const { run, findings } = await validateSubmission(home, dir);
  expect(run.status).toBe(0);
  expect(run.stderr).toBe("");
  expect(findings).toEqual([missingCard]);
});

test("a search card clears missing-card", async () => {
  const { home, root, dir } = setup();
  const card = join(root, "search", "stacks", "demo-app.json");
  mkdirSync(dirname(card), { recursive: true });
  writeFileSync(
    card,
    JSON.stringify({
      schemaVersion: 1,
      id: "demo-app",
      source: { digest: `sha256:${"0".repeat(64)}`, by: "author", reviewedAt: null },
      summary: "A demo entry.",
      requests: ["build a demo", "start a demo project", "check a demo"],
      useCases: [],
      synonyms: [],
      goodFor: [],
      notFor: [],
      kind: "stack",
      platforms: [],
      productKinds: [],
      languages: [],
    }),
  );
  const { findings } = await validateSubmission(home, dir);
  expect(findings.map(([check]) => check)).not.toContain("missing-card");
});

test("fill markers left in the frontmatter, body, shipped files and card are errors", async () => {
  const home = setup("fragment", "demo-lint");
  const { dir, write, markdown, root } = home;
  writeFileSync(
    markdown,
    `${skeleton("fragment", "demo-lint", "ci")}\n<!-- stacks:fill: explain the lint rules -->\n\nRun \`grep stacks:fill\` to find markers.\n`,
  );
  write("files/docs/lint.md", "# Lint\n\n<!-- stacks:fill: list the rules -->\n");
  write("adapters/claude/CLAUDE.md", "stacks:fill\n");
  const card = join(root, "search", "fragments", "demo-lint.json");
  mkdirSync(dirname(card), { recursive: true });
  writeFileSync(
    card,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id: "demo-lint",
        source: { digest: `sha256:${"0".repeat(64)}`, by: "author", reviewedAt: null },
        summary: "stacks:fill: summarize",
        requests: ["lint a project", "add lint rules", "check lint"],
        useCases: [],
        synonyms: [],
        goodFor: [],
        notFor: [],
        kind: "fragment",
        capabilities: [],
      },
      null,
      2,
    )}\n`,
  );
  const { run, findings } = await validateSubmission(home.home, dir);
  expect(run.status).toBe(2);
  // Ordered by file the way validate sorts them (case-insensitive), then by line.
  expect(findings.filter(([check]) => check === "fill-marker")).toEqual([
    ["fill-marker", "error", "fragments/demo-lint/adapters/claude/CLAUDE.md", 1],
    ["fill-marker", "error", "fragments/demo-lint/files/docs/lint.md", 3],
    ["fill-marker", "error", "fragments/demo-lint/FRAGMENT.md", 6],
    ["fill-marker", "error", "fragments/demo-lint/FRAGMENT.md", 38],
    ["fill-marker", "error", "search/fragments/demo-lint.json", 9],
  ]);
});

test("a shipped marker is the project's to fill when a verify step checks for it", async () => {
  const { home, dir, write, markdown } = setup();
  // The scaffold's readme step runs `grep -n 'stacks:fill' README.md`; that line isn't a marker.
  // A second step checks the Claude adapter's CLAUDE.md the same way.
  writeFileSync(
    markdown,
    readFileSync(markdown, "utf8").replace(
      "merge: []",
      "  - { name: claude-md, phase: check, layer: docs, run: \"! grep -n 'stacks:fill' CLAUDE.md\" }\nmerge: []",
    ),
  );
  write("files/README.md", "<!-- stacks:fill: describe the project -->\n");
  write("adapters/claude/CLAUDE.md", "<!-- stacks:fill: the project's commands -->\n");
  const { findings } = await validateSubmission(home, dir);
  expect(findings).toEqual([missingCard]);
});

test("credential-shaped strings are errors wherever they sit in the entry, placeholders aren't", async () => {
  const { home, dir, write } = setup();
  write("files/src/client.ts", `const client = connect();\nconst token = "${githubToken}";\n`);
  write("files/certs/dev.pem", `${pemHeader}\nMIIB\n`);
  write("files/config.json", `{\n  "password": "hunter2hunter2hunter2"\n}\n`);
  write("files/example.json", `{ "api_key": "your-api-key-goes-here-123" }\n`);
  write("NOTES.txt", `scratch: ${githubToken}\n`);
  const { run, findings } = await validateSubmission(home, dir);
  expect(run.status).toBe(2);
  expect(findings).toEqual([
    ["secret", "error", "stacks/demo-app/files/certs/dev.pem", 1],
    ["secret", "error", "stacks/demo-app/files/config.json", 2],
    ["secret", "error", "stacks/demo-app/files/src/client.ts", 2],
    ["secret", "error", "stacks/demo-app/NOTES.txt", 1],
    missingCard,
  ]);
  // The report names the kind of credential, never the value.
  expect(run.stdout).not.toContain(githubToken);
  expect(run.stdout).toContain("looks like a GitHub token");
});

test("environment files other than .env.example are errors", async () => {
  const { home, dir, write } = setup();
  write("files/.env", "DEBUG=1\n");
  write("files/api/.env.local", "DEBUG=1\n");
  write(".env.production", "DEBUG=1\n");
  write("files/.env.example", "DEBUG=\n");
  write("files/.envrc.md", "not an env file\n");
  const { run, findings } = await validateSubmission(home, dir);
  expect(run.status).toBe(2);
  expect(findings).toEqual([
    ["env-file", "error", "stacks/demo-app/.env.production", undefined],
    ["env-file", "error", "stacks/demo-app/files/.env", undefined],
    ["env-file", "error", "stacks/demo-app/files/api/.env.local", undefined],
    missingCard,
  ]);
});

test("absolute home and drive paths in shipped text are warnings", async () => {
  const { home, dir, write, markdown } = setup();
  write("files/setup.md", `Copy ${homePath} first.\n`);
  write("adapters/codex/AGENTS.md", "Logs go to C:\\temp\\logs.\n");
  write("NOTES.txt", `${homePath}\n`);
  writeFileSync(
    markdown,
    skeleton("stack", "demo-app", "ci")
      .replace(/"stacks:fill: describe the \w+"/, '"A demo entry."')
      .replace("Describe the test strategy.", `Fixtures live in ${homePath}.`),
  );
  const { run, findings } = await validateSubmission(home, dir);
  expect(run.status).toBe(0);
  expect(findings).toEqual([
    missingCard,
    ["absolute-path", "warning", "stacks/demo-app/adapters/codex/AGENTS.md", 1],
    ["absolute-path", "warning", "stacks/demo-app/files/setup.md", 1],
    ["absolute-path", "warning", "stacks/demo-app/STACK.md", 47],
  ]);
});

test("without --submission none of the readiness checks run", async () => {
  const { home, dir, write } = setup();
  write("files/.env", `TOKEN=${githubToken}\n`);
  const run = await cli(["validate", dir, "--json"], { home });
  const report = Schema.decodeUnknownSync(ValidateReport)(JSON.parse(run.stdout));
  const ids = ["fill-marker", "secret", "env-file", "absolute-path", "missing-card"];
  expect(report.findings.filter((finding) => ids.includes(finding.check))).toEqual([]);
});

test("errors keep the report on stdout and exit 2 with ValidationFailed", async () => {
  const { home, dir, write } = setup();
  write("files/.env", "DEBUG=1\n");
  const run = await cli(["validate", dir, "--submission"], {
    home,
    env: { CLAUDECODE: "1" },
  });
  expect(run.status).toBe(2);
  expect(run.stdout).toContain(
    "  error    env-file        stacks/demo-app/files/.env: Environment files don't ship; keep only .env.example, with placeholders.\n",
  );
  expect(run.stdout.trimEnd().split("\n").at(-1)).toBe(
    `Next: fix the errors above, then run stacks validate ${dir} --submission`,
  );
  expect(run.stderr).toBe("Validation failed.\n");
});

test("a passing submission check points at a dry-run submit", async () => {
  const { home, dir } = setup();
  const run = await cli(["validate", dir, "--submission"], { home, env: { CLAUDECODE: "1" } });
  expect(run.status).toBe(0);
  expect(run.stdout.trimEnd().split("\n").at(-1)).toBe(`Next: stacks submit ${dir} --dry-run`);
});

test("--submission takes one entry directory and no --brief", async () => {
  const { home, root, dir } = setup();
  const brief = await cli(["validate", dir, "--submission", "--brief", "demo-app", "--json"], {
    home,
  });
  expect(brief.status).toBe(2);
  expect(brief.stdout).toBe("");
  expect(JSON.parse(brief.stderr.trim()).error).toMatchObject({
    tag: "Usage",
    details: { flags: ["--submission", "--brief"] },
  });
  for (const args of [
    ["validate", root, "--submission", "--json"],
    ["validate", "--submission", "--json"],
  ]) {
    const run = await cli(args, { home });
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(JSON.parse(run.stderr.trim()).error).toMatchObject({
      tag: "Usage",
      details: {
        flag: "--submission",
        value: args[1] === root ? root : "",
        expected: "one entry directory, such as <root>/stacks/<id>",
      },
    });
  }
});

/** Shell and Actions references are written with this, so they aren't JavaScript templates. */
const DOLLAR = "$";

test("template and environment references assigned to secret-looking names aren't secrets", async () => {
  const { home, dir, write } = setup();
  write(
    "files/docs/database.md.tmpl",
    [
      "services:",
      "  db:",
      "    environment:",
      '      POSTGRES_PASSWORD: "{{project_slug}}-local"',
      "",
    ].join("\n"),
  );
  write(
    "files/docs/release.md",
    [
      "      - run: npm publish",
      "        env:",
      `          token: "${DOLLAR}{{secrets.NPM_TOKEN}}"`,
      "",
    ].join("\n"),
  );
  write("files/.npmrc.md", `NODE_AUTH_TOKEN: "${DOLLAR}{NPM_TOKEN_FROM_THE_ENV}"\n`);
  write("files/src/config.json", '{ "apiKey": "process.env.OPENAI_KEY_VALUE" }\n');
  const { findings } = await validateSubmission(home, dir);
  expect(findings).toEqual([missingCard]);
});

test("a placeholder word elsewhere on the line doesn't excuse a real-shaped key", async () => {
  const { home, dir, write } = setup();
  const key = ["sk", "ant", "api03", "Q7vR2mXk9LpT4wZs8NdY3bHc"].join("-");
  write("files/.env.example", `ANTHROPIC_API_KEY=${key} # replace before use\n`);
  const { run, findings } = await validateSubmission(home, dir);
  expect(run.status).toBe(2);
  expect(findings).toEqual([
    ["secret", "error", "stacks/demo-app/files/.env.example", 1],
    missingCard,
  ]);
  expect(run.stdout).not.toContain(key);
});

test("generic container and CI homes and format strings aren't home paths; a person's home is", async () => {
  const { home, dir, write } = setup();
  write("files/docs/container.md", "In the image:\n\n    WORKDIR /home/node/app\n");
  write("files/docs/ci.md", "The runner caches /home/runner/.cache between jobs.\n");
  write("files/src/log.c", "printf('%s:\\n', name);\n");
  write("files/docs/setup.md", "Clone it into /home/alice/code/demo first.\n");
  write("files/.vscode/settings.json", '{ "cwd": "C:\\\\Users\\\\bob\\\\proj" }\n');
  const { findings } = await validateSubmission(home, dir);
  expect(findings).toEqual([
    missingCard,
    ["absolute-path", "warning", "stacks/demo-app/files/.vscode/settings.json", 1],
    ["absolute-path", "warning", "stacks/demo-app/files/docs/setup.md", 1],
  ]);
});

test(".env.sample and .env.template ship like .env.example", async () => {
  const { home, dir, write } = setup();
  write("files/.env.sample", "DEBUG=\n");
  write("files/.env.template", "DEBUG=\n");
  write("files/api/.env.sample.tmpl", "DEBUG=\n");
  const { findings } = await validateSubmission(home, dir);
  expect(findings).toEqual([missingCard]);
});

test("a shipped marker passes only in a file a fill-checking verify step names", async () => {
  const { home, dir, write } = setup();
  // The scaffold's readme step checks README.md, so its marker is the project's to fill.
  write("files/README.md", "<!-- stacks:fill: describe the project -->\n");
  write("files/src/config.ts.tmpl", "// stacks:fill: the project's settings\n");
  const { run, findings } = await validateSubmission(home, dir);
  expect(run.status).toBe(2);
  expect(findings).toEqual([
    ["fill-marker", "error", "stacks/demo-app/files/src/config.ts.tmpl", 1],
    missingCard,
  ]);
});
