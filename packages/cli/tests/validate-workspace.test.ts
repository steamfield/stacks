/**
 * `validate` of workspace stacks (a stack with `parts`), through the real command tree over the
 * shared workspace fixture and per-test variants of it. Each case asserts the exact findings the
 * variant adds to the fixture's own report, so a duplicate or a false positive fails as surely as
 * a missing finding.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { type Finding, ValidateReport } from "../src/schemas/validate";
import { quiet, runCli, tempDir } from "./helpers/cli";
import { emptyRegistry, minimal, writeEntry } from "./helpers/registry";
import { workspaceRegistry, workspaceVariant } from "./helpers/workspace";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A fixture copy edited by `edit`, removed after the test. */
function variant(edit: (root: string) => void): string {
  const { root, cleanup } = workspaceVariant(edit);
  cleanups.push(cleanup);
  return root;
}

/** Replaces `from` with `to` in a fixture file; throws when `from` is absent, so a typo fails. */
function replace(root: string, file: string, from: string, to: string) {
  const path = join(root, file);
  const text = readFileSync(path, "utf8");
  if (!text.includes(from)) throw new Error(`${file} has no ${JSON.stringify(from)}`);
  writeFileSync(path, text.replace(from, to));
}

const PAIR = "stacks/pair/STACK.md";
const API = "stacks/api-part/STACK.md";
const WEB = "stacks/web-part/STACK.md";
const DB = "fragments/db/FRAGMENT.md";

/** `validate <path> --json` with an empty bundled registry: exit status, stderr and the report. */
async function validate(path: string) {
  const home = tempDir();
  cleanups.push(home.cleanup);
  const result = await runCli(["validate", path, "--json"], {
    home: home.path,
    env: quiet,
    host: { registry: emptyRegistry },
  });
  return {
    status: result.status,
    stderr: result.stderr,
    report: Schema.decodeUnknownSync(ValidateReport)(JSON.parse(result.stdout)),
  };
}

/** One finding as a line: what a test compares, so a mismatch names the finding. */
const line = (finding: Finding) =>
  `${finding.severity} ${finding.check} ${finding.kind}/${finding.entry} ${finding.file}: ${finding.message}`;

let baseline: string[] = [];
beforeAll(async () => {
  baseline = (await validate(workspaceRegistry)).report.findings.map(line);
});

/** The findings `path`'s report holds that the unmodified fixture's report doesn't, in order. */
async function added(path: string): Promise<string[]> {
  const rest = [...baseline];
  return (await validate(path)).report.findings.map(line).filter((item) => {
    const index = rest.indexOf(item);
    if (index === -1) return true;
    rest.splice(index, 1);
    return false;
  });
}

const WORKSPACE_CHECKS = new Set([
  "part-stack",
  "part-role",
  "part-name-duplicate",
  "part-nested",
  "part-roles",
  "part-cwd",
  "part-role-rule",
  "part-required-restated",
  "link-openapi-drift",
  "workspace-heading",
  "workspace-part-dirs",
  "part-namespace-shadowed",
]);

const onPair = (severity: string, check: string, message: string) =>
  `${severity} ${check} stack/pair ${PAIR}: ${message}`;

describe("the unmodified workspace fixture", () => {
  test("has no workspace finding and checks part steps against namespaced commands", async () => {
    const { status, report } = await validate(workspaceRegistry);
    // The fixture has unrelated errors (no typecheck layer, a misfit overlay), so validate fails.
    expect(status).toBe(2);
    const relevant = report.findings
      .filter(
        (finding) =>
          WORKSPACE_CHECKS.has(finding.check) ||
          ["undeclared-command", "verify-run-duplicate", "ref-command-coverage"].includes(
            finding.check,
          ),
      )
      .map(line);
    expect(relevant).toEqual([
      `note verify-run-duplicate stack/api-part ${API}: Steps install, up run the same command in one composed manifest; keep both only if the repetition is intentional.`,
      // backend-test and frontend-test both run `bun run test`, but in their own directories.
      `note verify-run-duplicate stack/pair ${PAIR}: Steps backend-install, backend-up run the same command in one composed manifest; keep both only if the repetition is intentional.`,
      `note verify-run-duplicate stack/web-part ${WEB}: Steps install, up run the same command in one composed manifest; keep both only if the repetition is intentional.`,
      // A command of a fragment placed on a part is named as its author wrote it.
      `warning ref-command-coverage fragment/db ${DB}: command db-up is a deliverable in the commands table, but no verify step runs it`,
      `note verify-run-duplicate fragment/db ${DB}: db with api-part (add): steps install, up run the same command in one composed manifest; keep both only if the repetition is intentional.`,
      // The add composition onto the workspace places db on backend, so its step runs there.
      `note verify-run-duplicate fragment/db ${DB}: db with pair (add): steps backend-install, backend-up run the same command in one composed manifest; keep both only if the repetition is intentional.`,
    ]);
  });

  test("a stack without parts gets none of the workspace findings", async () => {
    const { report } = await validate(join(workspaceRegistry, "stacks", "api-part"));
    expect(report.findings.filter((finding) => WORKSPACE_CHECKS.has(finding.check))).toEqual([]);
  });
});

describe("part problems are reported once, naming the part, and not again by compose", () => {
  test.each([
    {
      name: "a part naming a stack that doesn't exist",
      edit: (root: string) =>
        replace(root, PAIR, "role: web, stack: web-part", "role: web, stack: no-such-stack"),
      expected: [
        onPair(
          "error",
          "part-stack",
          "part frontend: stack no-such-stack is not in the registry; name an existing stack",
        ),
      ],
    },
    {
      name: "a role the CLI doesn't know",
      edit: (root: string) => replace(root, PAIR, "role: api", "role: mobile"),
      expected: [
        onPair(
          "error",
          "part-role",
          "part backend: role mobile is not one this CLI knows (api, web)",
        ),
      ],
    },
    {
      name: "two parts with one name",
      edit: (root: string) => {
        replace(root, PAIR, "name: backend", "name: app");
        replace(root, PAIR, "name: frontend", "name: app");
        replace(root, PAIR, "`backend/` serves", "`app/` serves");
      },
      expected: [
        onPair(
          "error",
          "part-name-duplicate",
          "part app: another part has the same name; give each part its own name, which is its directory",
        ),
      ],
    },
    {
      name: "a part that is itself a workspace",
      edit: (root: string) =>
        replace(root, PAIR, "role: web, stack: web-part", "role: web, stack: pair"),
      expected: [
        onPair(
          "error",
          "part-nested",
          "part frontend: stack pair has parts of its own; a part must be a stack without parts",
        ),
      ],
    },
    {
      name: "two web parts and no api part",
      edit: (root: string) => replace(root, PAIR, "role: api", "role: web"),
      expected: [
        onPair(
          "error",
          "part-roles",
          "the parts are backend (web), frontend (web); a workspace takes exactly one api part and one client part (web)",
        ),
      ],
    },
    {
      name: "two api parts",
      edit: (root: string) => replace(root, PAIR, "role: web", "role: api"),
      expected: [
        onPair(
          "error",
          "part-roles",
          "the parts are backend (api), frontend (api); a workspace takes exactly one api part and one client part (web)",
        ),
      ],
    },
  ])("$name", async ({ edit, expected }) => {
    expect(await added(variant(edit))).toEqual(expected);
  });
});

describe("a part step whose cwd leaves the part directory", () => {
  test.each(["..", "../x", "/tmp"])("cwd %s on a part's own step", async (cwd) => {
    const root = variant((root) =>
      replace(
        root,
        API,
        'run: "test -f src/index.ts" }',
        `run: "test -f src/index.ts", cwd: "${cwd}" }`,
      ),
    );
    expect(await added(root)).toEqual([
      onPair(
        "error",
        "part-cwd",
        `part backend: step lint in ${API} has cwd "${cwd}", which leaves backend/; keep cwd inside the part's directory`,
      ),
    ]);
  });

  test("on a step of a fragment placed on the part, reported on the fragment", async () => {
    const root = variant((root) => replace(root, DB, "cwd: . }", "cwd: .. }"));
    expect(await added(root)).toEqual([
      `error part-cwd fragment/db ${DB}: part backend of pair: step migrate has cwd "..", which leaves backend/; keep cwd inside the part's directory`,
    ]);
  });

  /** A fragment the workspace doesn't list that `add` still places on backend, with two bad steps. */
  const unlisted = (root: string) =>
    writeEntry({
      root,
      kind: "fragment",
      dir: "api-extra",
      frontmatter: minimal(
        "fragment",
        "api-extra",
        [
          "applies_to: [api-part]",
          "verify:",
          '  - { name: up, layer: check, run: "true", cwd: .. }',
          '  - { name: ok, layer: check, run: "true", cwd: src }',
          '  - { name: out, layer: check, run: "true", cwd: /tmp }',
        ].join("\n"),
      ),
    });
  const EXTRA = "fragments/api-extra/FRAGMENT.md";
  // Findings sort by message, so `out` reads before `up`.
  const extraFindings = [
    `error part-cwd fragment/api-extra ${EXTRA}: part backend of pair: step out has cwd "/tmp", which leaves backend/; keep cwd inside the part's directory`,
    `error part-cwd fragment/api-extra ${EXTRA}: part backend of pair: step up has cwd "..", which leaves backend/; keep cwd inside the part's directory`,
  ];
  const partCwd = (findings: ReadonlyArray<Finding>) =>
    findings.filter((finding) => finding.check === "part-cwd").map(line);

  test("on every step of a fragment the workspace doesn't list but add would place", async () => {
    const root = variant(unlisted);
    expect(partCwd((await validate(root)).report.findings)).toEqual(extraFindings);
  });

  test("when only that fragment is validated", async () => {
    const root = variant(unlisted);
    const { report } = await validate(join(root, "fragments", "api-extra"));
    expect(partCwd(report.findings)).toEqual(extraFindings);
  });
});

describe("what a workspace must restate and declare", () => {
  test("a workspace that drops a part's required fragment reports it for each part", async () => {
    const root = variant((root) =>
      replace(root, PAIR, "required: [client-link, harness]", "required: [client-link]"),
    );
    expect(await added(root)).toEqual([
      onPair(
        "error",
        "part-required-restated",
        `part backend requires fragment harness (${API}); add it to this workspace's fragments.required, since a part's own tiers are not selected`,
      ),
      onPair(
        "error",
        "part-required-restated",
        `part frontend requires fragment harness (${WEB}); add it to this workspace's fragments.required, since a part's own tiers are not selected`,
      ),
    ]);
  });

  const rule = (part: string, file: string, name: string, text: string) =>
    onPair("error", "part-role-rule", `part ${part} (${file}) breaks role rule ${name}: ${text}`);

  test.each([
    {
      name: "an api part without PORT_API",
      edit: (root: string) => replace(root, API, 'env:\n  PORT_API: "3100"\n', ""),
      expected: [rule("backend", API, "api-port-env", "An api part declares PORT_API in env.")],
    },
    {
      name: "an api part whose serve step ends in /health",
      edit: (root: string) => replace(root, API, "/healthz", "/health"),
      expected: [
        rule(
          "backend",
          API,
          "api-healthz-serve",
          "An api part has a serve step whose expect.http uses the PORT_API variable and ends in /healthz.",
        ),
      ],
    },
    {
      name: "a web part without PORT_WEB",
      edit: (root: string) => replace(root, WEB, 'env:\n  PORT_WEB: "4173"\n', ""),
      expected: [rule("frontend", WEB, "web-port-env", "A web part declares PORT_WEB in env.")],
    },
  ])("$name breaks a Declared role rule", async ({ edit, expected }) => {
    expect(await added(variant(edit))).toEqual(expected);
  });

  test("a required link needs an openapi-drift step on the api part", async () => {
    const withoutStep = (root: string) =>
      replace(root, API, "  - { name: openapi-drift, layer: check, run: bun run openapi }\n", "");
    expect(await added(variant(withoutStep))).toEqual([
      onPair(
        "error",
        "link-openapi-drift",
        `required link client-link needs the api part backend (${API}) to have a verify step named openapi-drift`,
      ),
    ]);
    // Without the link the step isn't needed. Dropping the link also drops the composition's
    // client-drift step and its body block, which the fixture's report doesn't list either way.
    const withoutLink = await added(
      variant((root) => {
        withoutStep(root);
        replace(root, PAIR, "required: [client-link, harness]", "required: [harness]");
      }),
    );
    expect(withoutLink.filter((item) => item.includes("link-openapi-drift"))).toEqual([]);
  });
});

describe("the workspace body", () => {
  test.each(["How the parts connect", "Changing the API"])(
    "a body without ## %s",
    async (heading) => {
      const root = variant((root) => replace(root, PAIR, `## ${heading}\n`, ""));
      expect(await added(root)).toEqual([
        onPair("warning", "workspace-heading", `no "## ${heading}" heading in the body`),
      ]);
    },
  );

  test("a body that never names a part's directory", async () => {
    const root = variant((root) => {
      replace(root, PAIR, "and `frontend/` calls it", "and the web app calls it");
      replace(root, PAIR, "then run `frontend/`'s checks", "then run the web app's checks");
    });
    expect(await added(root)).toEqual([
      onPair(
        "warning",
        "workspace-part-dirs",
        "the body never mentions frontend/; name each part's directory at least once",
      ),
    ]);
  });
});

test("a workspace command or deps role equal to a namespaced part one is reported as shadowing", async () => {
  const root = variant((root) => {
    replace(
      root,
      PAIR,
      "commands:\n  check: Run both parts' checks\n",
      "commands:\n  check: Run both parts' checks\n  backend-test: Run the API tests from the root\ndeps:\n  backend-dev: [tsx]\n",
    );
  });
  expect(await added(root)).toEqual([
    onPair(
      "warning",
      "part-namespace-shadowed",
      "command backend-test replaces part backend's own test command in the merged table; rename it unless that is intended",
    ),
    onPair(
      "warning",
      "part-namespace-shadowed",
      "deps role backend-dev merges with part backend's own dev role; rename it unless that is intended",
    ),
  ]);
});

describe("verify steps of the parts", () => {
  test("a part step running an undeclared target is reported on the part", async () => {
    const root = variant((root) =>
      replace(
        root,
        API,
        "  - { name: openapi-drift,",
        "  - { name: nope, layer: check, run: bun run nope }\n  - { name: openapi-drift,",
      ),
    );
    expect(await added(root)).toEqual([
      `warning undeclared-command stack/api-part ${API}: api-part: verify step nope runs nope, which is missing from the composed commands table`,
      `warning undeclared-command stack/api-part ${API}: pair: verify step backend-nope runs nope, which is missing from the composed commands table`,
    ]);
  });

  test("two steps in one part running one command are still a duplicate", async () => {
    const root = variant((root) =>
      replace(
        root,
        API,
        "  - { name: openapi-drift,",
        "  - { name: test-again, layer: test, run: bun run test }\n  - { name: openapi-drift,",
      ),
    );
    expect(await added(root)).toEqual([
      `note verify-run-duplicate stack/api-part ${API}: Steps test, test-again run the same command in one composed manifest; keep both only if the repetition is intentional.`,
      `note verify-run-duplicate stack/pair ${PAIR}: Steps backend-test, backend-test-again run the same command in one composed manifest; keep both only if the repetition is intentional.`,
    ]);
  });
});

test("compose-each composes a part-scoped fragment onto the workspace that doesn't list it", async () => {
  // db fits pair only through its api part, and its MODE clashes with the workspace's own, so
  // the clash exists only on pair.
  const root = variant((root) => {
    replace(root, PAIR, "  optional: [db]\n", "");
    replace(root, PAIR, "merge: [", 'env:\n  MODE: "workspace"\nmerge: [');
    replace(
      root,
      DB,
      'env:\n  DATABASE_URL: "postgres://localhost/example"\n',
      'env:\n  DATABASE_URL: "postgres://localhost/example"\n  MODE: "part"\n',
    );
  });
  const { report } = await validate(join(root, "fragments", "db"));
  expect(
    report.findings.filter((finding) => finding.check.startsWith("compose")).map(line),
  ).toEqual([
    `error compose-each fragment/db ${DB}: db with pair: can't compose (env): pair, db; MODE`,
  ]);
});
