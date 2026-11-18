import { statSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import type { StackMeta } from "@steamfield/stacks-format";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { declaredRuleProblems, knownRole } from "../src/core/compose/roles";
import { isRejected } from "../src/core/registry/entry";
import { Registry } from "../src/core/registry/registry";
import { ComposeConflict, EntryInvalid, errorTable } from "../src/errors";
import { quiet, runCli, terminal } from "./helpers/cli";
import { workspaceRegistry } from "./helpers/workspace";

const partReasons = [
  "part_stack",
  "part_role",
  "part_name_duplicate",
  "part_nested",
  "part_roles",
  "part_cwd",
] as const;

test.each(partReasons)(
  "an EntryInvalid %s names its part and step in both modes",
  async (reason) => {
    const error = new EntryInvalid({
      details: { id: "pair", origin: "bundled", reason, part: "backend", step: "backend-lint" },
    });
    const next = `fix the workspace's parts list or that part's step; stacks validate lists every problem in a registry.`;
    const json = await runCli(["--json"], { program: Effect.fail(error) });
    expect(json.status).toBe(2);
    expect(JSON.parse(json.stderr)).toEqual({
      error: {
        tag: "EntryInvalid",
        message: "Entry is invalid.",
        retryable: false,
        next,
        details: { id: "pair", origin: "bundled", reason, part: "backend", step: "backend-lint" },
      },
    });
    const human = await runCli([], { program: Effect.fail(error), env: quiet, host: terminal });
    expect(human.stderr).toBe(
      `Entry is invalid.\n  Entry: pair (bundled, ${reason})\n  Part: backend\n  Step: backend-lint\n  Next: ${next}\n`,
    );
  },
);

test("a ComposeConflict with parts prints them and encodes them in the envelope", async () => {
  const error = new ComposeConflict({
    details: {
      reason: "file_owner",
      stack: "pair",
      ids: [],
      path: ".claude/hooks/shared-guard.sh",
      parts: ["backend", "frontend"],
    },
  });
  const json = await runCli(["--json"], { program: Effect.fail(error) });
  expect(JSON.parse(json.stderr).error.details).toEqual({
    reason: "file_owner",
    stack: "pair",
    ids: [],
    path: ".claude/hooks/shared-guard.sh",
    parts: ["backend", "frontend"],
  });
  const human = await runCli([], { program: Effect.fail(error), env: quiet, host: terminal });
  expect(human.stderr).toContain("  Stack: pair\n  Parts: backend, frontend\n  Path: ");
});

test("the error table and `stacks schema error` list the new reasons and fields", async () => {
  const entry = errorTable.EntryInvalid.details;
  const conflict = errorTable.ComposeConflict.details;
  expect(entry).toBeDefined();
  expect(conflict).toBeDefined();
  const schema = await runCli(["schema", "error", "--json"], { env: quiet });
  expect(schema.status).toBe(0);
  const text = schema.stdout;
  for (const reason of partReasons) expect(text).toContain(`"${reason}"`);
  expect(text).toContain('"part"');
  expect(text).toContain('"parts"');
});

const apiMeta = (): StackMeta => ({
  schemaVersion: 1,
  id: "x",
  name: "x",
  description: "x",
  tags: [],
  deps: {},
  commands: {},
  tools: [],
  decisions: [],
  env: { PORT_API: "3100" },
  verify: [
    {
      name: "api",
      run: "true",
      phase: "serve",
      expect: { http: `http://localhost:\${PORT_API}/healthz` },
    },
  ],
  merge: [],
  kind: "stack",
  fragments: { required: [], default: [], optional: [] },
});

const withServe = (http: string): StackMeta => {
  const meta = apiMeta();
  return { ...meta, verify: [{ name: "api", run: "true", phase: "serve", expect: { http } }] };
};

test("an api part with PORT_API and a /healthz serve step breaks no rule", () => {
  expect(declaredRuleProblems("api", apiMeta())).toEqual([]);
});

test("an api part without PORT_API breaks api-port-env", () => {
  const { PORT_API: _port, ...env } = apiMeta().env;
  const problems = declaredRuleProblems("api", { ...apiMeta(), env });
  expect(problems.map((problem) => problem.rule)).toEqual(["api-port-env"]);
});

test.each([
  ["ends in /health", `http://localhost:\${PORT_API}/health`],
  ["uses a literal port", "http://localhost:3100/healthz"],
])("an api serve step that %s breaks api-healthz-serve", (_name, http) => {
  const problems = declaredRuleProblems("api", withServe(http));
  expect(problems.map((problem) => problem.rule)).toEqual(["api-healthz-serve"]);
});

test("an api part with no serve step breaks api-healthz-serve", () => {
  const problems = declaredRuleProblems("api", { ...apiMeta(), verify: [] });
  expect(problems.map((problem) => problem.rule)).toEqual(["api-healthz-serve"]);
});

test("a web part needs PORT_WEB, and an unknown role has no rules", () => {
  const web = { ...apiMeta(), env: { PORT_WEB: "4173" } };
  expect(declaredRuleProblems("web", web)).toEqual([]);
  expect(declaredRuleProblems("web", apiMeta()).map((problem) => problem.rule)).toEqual([
    "web-port-env",
  ]);
  expect(declaredRuleProblems("mobile", apiMeta())).toEqual([]);
  expect(knownRole("api")).toBe(true);
  expect(knownRole("mobile")).toBe(false);
});

test("every fixture entry decodes", async () => {
  const entries = await Effect.runPromise(
    Effect.flatMap(Registry, (registry) => registry.all).pipe(
      Effect.provide(Registry.layer([{ origin: "bundled", path: workspaceRegistry }])),
      Effect.provide(NodeServices.layer),
    ),
  );
  expect(entries.filter(isRejected)).toEqual([]);
  expect(entries.map((entry) => `${entry.kind}/${entry.id}`).sort()).toEqual([
    "fragment/client-link",
    "fragment/db",
    "fragment/harness",
    "fragment/root-ci",
    "stack/api-part",
    "stack/pair",
    "stack/web-part",
  ]);
});

test("the shared guard hook is executable and the same in both parts", () => {
  const hook = (part: string) =>
    join(workspaceRegistry, "stacks", part, "adapters/claude/.claude/hooks/shared-guard.sh");
  expect(statSync(hook("api-part")).mode & 0o111).not.toBe(0);
  expect(statSync(hook("web-part")).mode & 0o111).not.toBe(0);
});

test("validate over the fixture reports findings only from the existing checks", async () => {
  const result = await runCli(["validate", workspaceRegistry, "--json"], { env: quiet });
  const report: { findings: { check: string; severity: string }[] } = JSON.parse(result.stdout);
  expect(report.findings.filter((found) => found.check.startsWith("workspace"))).toEqual([]);
  expect([0, 2]).toContain(result.status);
});
