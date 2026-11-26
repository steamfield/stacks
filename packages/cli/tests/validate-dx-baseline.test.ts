import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { DX_SEVERITY } from "../src/core/validate/checks/dx-baseline";
import { ErrorEnvelope } from "../src/errors";
import { BriefPreview, type Finding, ValidateReport } from "../src/schemas/validate";
import { quiet, runCli, tempDir } from "./helpers/cli";
import { emptyRegistry, minimal, writeEntry } from "./helpers/registry";
import { reviewSearchFixture } from "./helpers/search-fixture";

const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});

function registry() {
  const dir = tempDir();
  dirs.push(dir);
  return dir.path;
}

const steps = [
  "verify:",
  '  - { name: install, phase: setup, layer: install, run: "true # install" }',
  '  - { name: lint, layer: lint, run: "true # lint" }',
  '  - { name: typecheck, layer: typecheck, run: "true # typecheck" }',
  '  - { name: test, layer: test, run: "true # test" }',
].join("\n");

function stack(root: string, extra: string, { id = "sample", serveStep = "" } = {}) {
  return writeEntry({
    root,
    kind: "stack",
    dir: id,
    frontmatter: minimal("stack", id, `${extra}\n${steps}\n${serveStep}`),
    body: "## Setup\n\nSet up the project.\n",
  });
}

function fragment(
  root: string,
  id: string,
  extra = "",
  step = `  - { name: ${id}, layer: check, run: "true # ${id}" }`,
) {
  writeEntry({
    root,
    kind: "fragment",
    dir: id,
    frontmatter: minimal("fragment", id, `${extra}\nverify:\n${step}`),
  });
}

const baseline = "fragments: { default: [agent-ops, git-hooks, ci-github] }";
const serve =
  '  - { name: serve, phase: serve, layer: serve, run: "true", expect: { http: "http://localhost:3100/healthz", within: 60s } }';

function commandRegistry() {
  const root = registry();
  for (const id of ["agent-ops", "git-hooks", "ci-github"]) fragment(root, id);
  return root;
}

function commands(names: readonly string[]) {
  return `commands: { ${names.map((name) => `"${name}": ${name} the project`).join(", ")} }`;
}

async function validate(root: string, target?: string, bundled = true) {
  reviewSearchFixture(root);
  const { status, stdout, stderr } = await runCli(
    ["validate", "--json", ...(target === undefined ? [] : [target])],
    { env: quiet, host: { registry: bundled ? root : emptyRegistry } },
  );
  const report = Schema.decodeUnknownSync(ValidateReport)(JSON.parse(stdout));
  expect(report.bundled).toBe(bundled);
  return { status, stderr, report };
}

const dx = ({ findings }: Pick<ValidateReport, "findings">) =>
  findings.filter((f) => f.check.startsWith("dx-"));

async function expectDx(root: string, expected: readonly Finding[], target?: string) {
  const { status, stderr, report } = await validate(root, target);
  const errors = report.findings.filter((finding) => finding.severity === "error");
  expect({ status, stderr, errors }).toEqual({ status: 0, stderr: "", errors: [] });
  expect(dx(report)).toEqual(expected);
}

function note(check: string, message: string): Finding {
  return {
    check: `dx-${check}`,
    severity: DX_SEVERITY,
    entry: "sample",
    file: "stacks/sample/STACK.md",
    kind: "stack",
    message,
  };
}

const aggregate = (name: string) =>
  note("aggregate", `declares no ${name} command; add one that runs everything CI runs`);
const format = note(
  "format",
  "declares no format or lint-fix command; add format to run the formatter and the linter's safe fixes, or add a separate lint-fix command",
);
const audit = note(
  "audit",
  "declares no audit or vuln command; add one that checks dependencies without an account or API key",
);

test.each([
  {
    name: "make needs ci",
    tags: "make",
    declared: ["check", "format", "audit"],
    expected: [aggregate("ci")],
  },
  {
    name: "make accepts ci, lint-fix and vuln",
    tags: "make",
    declared: ["ci", "lint-fix", "vuln"],
    expected: [],
  },
  {
    name: "scripts needs check",
    tags: "scripts",
    declared: ["format", "audit"],
    expected: [aggregate("check")],
  },
  {
    name: "ci does not satisfy the scripts aggregate",
    tags: "scripts",
    declared: ["ci", "format", "audit"],
    expected: [aggregate("check")],
  },
  {
    name: "scripts accepts check, format and audit",
    tags: "scripts",
    declared: ["check", "format", "audit"],
    expected: [],
  },
  {
    name: "make takes precedence when both runner tags are present",
    tags: "scripts, make",
    declared: ["check", "format", "audit"],
    expected: [aggregate("ci")],
  },
  {
    name: "missing fix command",
    tags: "scripts",
    declared: ["check", "audit"],
    expected: [format],
  },
  { name: "missing audit command", tags: "make", declared: ["ci", "format"], expected: [audit] },
  { name: "no runner tag skips command checks", tags: "cli", declared: [], expected: [] },
])("$name", async ({ tags, declared, expected }) => {
  const root = commandRegistry();
  stack(root, `tags: [${tags}]\n${commands(declared)}\n${baseline}`);
  await expectDx(root, expected);
});

test.each([
  { tier: "default", expected: [] },
  { tier: "optional", expected: [aggregate("check")] },
])("check from the $tier tier counts only when composed by default", async ({ tier, expected }) => {
  const root = commandRegistry();
  fragment(
    root,
    "project-check",
    commands(["check"]),
    '  - { name: project-check, layer: check, run: "bun run check" }',
  );
  const tiers =
    tier === "default"
      ? "default: [agent-ops, git-hooks, ci-github, project-check]"
      : "default: [agent-ops, git-hooks, ci-github]\n  optional: [project-check]";
  stack(root, `tags: [scripts]\n${commands(["format", "audit"])}\nfragments:\n  ${tiers}`);
  await expectDx(root, expected);
});

const noBackground = (names: string) =>
  note(
    "background",
    `has a serve step but no ${names} command; add a background start that logs to logs/dev.log and a stop that signals only its process group`,
  );

test.each([
  {
    name: "make web stacks need both Make targets",
    runner: "make",
    tag: "web",
    step: serve,
    present: [],
    expected: [noBackground("dev-bg or dev-stop")],
  },
  {
    name: "scripts API stacks need both script names",
    runner: "scripts",
    tag: "api",
    step: serve,
    present: [],
    expected: [noBackground("dev:bg or dev:stop")],
  },
  {
    name: "when only the start is missing, name the start",
    runner: "make",
    tag: "api",
    step: serve,
    present: ["dev-stop"],
    expected: [
      note(
        "background",
        "has a serve step but no dev-bg command; add a background start that logs to logs/dev.log",
      ),
    ],
  },
  {
    name: "when only the stop is missing, name the stop",
    runner: "scripts",
    tag: "web",
    step: serve,
    present: ["dev:bg"],
    expected: [
      note(
        "background",
        "has a serve step but no dev:stop command; add a stop that signals only its process group",
      ),
    ],
  },
  {
    name: "the complete background pair clears the check",
    runner: "scripts",
    tag: "web",
    step: serve,
    present: ["dev:bg", "dev:stop"],
    expected: [],
  },
  {
    name: "a serve step alone does not require a background pair",
    runner: "make",
    tag: "desktop",
    step: serve,
    present: [],
    expected: [],
  },
  {
    name: "a web stack with no serve step of its own skips the background check",
    runner: "scripts",
    tag: "web",
    step: "",
    present: [],
    expected: [],
  },
  {
    name: "a runnerless API with a serve step skips the background check",
    runner: "",
    tag: "api",
    step: serve,
    present: [],
    expected: [],
  },
])("$name", async ({ runner, tag, step, present, expected }) => {
  const root = commandRegistry();
  const declared = [runner === "make" ? "ci" : "check", "format", "audit", ...present];
  const tags = [runner, tag].filter(Boolean).join(", ");
  const defaults = step
    ? baseline
    : "fragments: { default: [agent-ops, git-hooks, ci-github, server] }";
  if (!step) fragment(root, "server", "", serve);
  stack(root, `tags: [${tags}]\n${commands(declared)}\n${defaults}`, { serveStep: step });
  await expectDx(root, expected);
});

const fragments = ["agent-ops", "ci-github", "git-hooks"];
const missingFragments = fragments.map((id) =>
  note("fragments", `${id} is not in the default composition; add it to fragments.default`),
);

test.each([
  { name: "absent fragments each get a finding", tiers: "", expected: missingFragments },
  {
    name: "optional fragments each get a finding",
    tiers: "fragments: { optional: [agent-ops, git-hooks, ci-github] }",
    expected: missingFragments,
  },
  {
    name: "explicit required fragments count",
    tiers: "fragments: { required: [agent-ops, git-hooks, ci-github] }",
    expected: [],
  },
  {
    name: "transitive required fragments count",
    tiers: "fragments: { required: [tooling] }",
    expected: [],
  },
])("$name", async ({ tiers, expected }) => {
  const root = commandRegistry();
  fragment(root, "tooling", "requires: [agent-ops, git-hooks, ci-github]");
  stack(root, `tags: [make]\n${commands(["ci", "format", "audit"])}\n${tiers}`);
  await expectDx(root, expected);
});

test("a workspace with a runner and a serve step gets only fragment findings", async () => {
  const root = registry();
  stack(root, 'tags: [scripts]\nenv: { PORT_API: "3100" }', {
    id: "api-part",
    serveStep: serve.replace(":3100/", `:\${PORT_API}/`),
  });
  stack(root, 'tags: [scripts]\nenv: { PORT_WEB: "3101" }', { id: "web-part" });
  const workspace = stack(
    root,
    "tags: [make, web]\nparts:\n  - { name: backend, role: api, stack: api-part }\n  - { name: frontend, role: web, stack: web-part }",
    { serveStep: serve },
  );
  await expectDx(root, missingFragments, workspace);
});

test("skips a failed base composition even when an optional selection renders", async () => {
  const root = registry();
  fragment(root, "agent-ops");
  fragment(root, "tooling", "requires: [agent-ops]");
  fragment(root, "incompatible", "conflicts: [agent-ops]");
  stack(
    root,
    "tags: [make]\nfragments: { required: [tooling], default: [incompatible], optional: [agent-ops] }",
  );
  const { status, stderr, report } = await validate(root);
  expect(status).toBe(2);
  const { error } = Schema.decodeUnknownSync(ErrorEnvelope)(JSON.parse(stderr));
  expect(error.tag).toBe("ValidationFailed");
  expect(report.findings.filter((f) => f.severity === "error")).toEqual([
    expect.objectContaining({ check: "compose", entry: "sample" }),
  ]);
  expect(dx(report)).toEqual([]);
});

test("the same registry gets DX findings only when validated as bundled", async () => {
  const root = registry();
  stack(root, `tags: [make]\n${commands(["ci", "format", "audit"])}`);
  await expectDx(root, missingFragments);
  const user = await validate(root, root, false);
  expect({ status: user.status, stderr: user.stderr }).toEqual({ status: 0, stderr: "" });
  expect(dx(user.report)).toEqual([]);
});

test("a bundled brief preview leaves the DX audit to registry validation", async () => {
  const root = registry();
  stack(root, "tags: [make]");
  await expectDx(root, [aggregate("ci"), audit, format, ...missingFragments]);
  const { status, stdout, stderr } = await runCli(["validate", "--brief", "sample", "--json"], {
    env: quiet,
    host: { registry: root },
  });
  expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
  const preview = Schema.decodeUnknownSync(BriefPreview)(JSON.parse(stdout));
  expect(preview.preset).toBe("default");
  expect(dx(preview)).toEqual([]);
});
