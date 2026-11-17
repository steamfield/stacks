import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { put, writeJson } from "./capture";

type Fixture = { cwd: string; project: string; home: string };
type Case = {
  id: string;
  args: ReadonlyArray<string>;
  project?: "inside" | "outside";
  prepare?: (fixture: Fixture) => void;
};

const CHECK = ". ./check.sh";
const CHECK_SCRIPT = String.raw`case "$(cat action.txt)" in
  fail)
    printf 'fixture check failed\n' >&2
    exit 7
    ;;
  interrupt)
    # The detached Node process (or the PTY's command) must lead its own group.
    pgid=$(ps -o pgid= -p "$PPID" | tr -d ' ')
    [ "$pgid" = "$PPID" ] || { printf 'CLI does not lead its group\n' >&2; exit 8; }
    mkfifo .snapshot-wait || exit
    kill -INT "-$pgid" || exit
    # Keep the step running until the signal handler cancels it.
    read -r unused < .snapshot-wait
    ;;
  *) printf 'fixture check passed\n' > checked.txt ;;
esac
`;

export function seedRegistry(home: string) {
  const registry = join(home, "config", "stacks");
  const stack = join(registry, "stacks", "snapshot-fixture");
  put(
    join(stack, "STACK.md"),
    `---
schema_version: 1
id: snapshot-fixture
kind: stack
name: Snapshot fixture
description: A project with deterministic checks for the behavior snapshot.
verify:
  - { name: test, layer: test, run: '${CHECK}' }
  - name: cleanup
    phase: teardown
    run: "rm -f .snapshot-wait && printf 'cleaned\\\\n' > teardown.txt"
---

Run the fixture checks.
`,
  );
  put(join(stack, "files", "check.sh"), CHECK_SCRIPT);
  put(join(stack, "files", "action.txt"), "pass\n");
  const fragments: ReadonlyArray<readonly [id: string, file: string, contents: string]> = [
    ["snapshot-extra", "extra.txt", "added by a fragment\n"],
    ["snapshot-conflict", "action.txt", "keep the live file and park this one\n"],
  ];
  for (const [id, file, contents] of fragments) {
    const fragment = join(registry, "fragments", id);
    put(
      join(fragment, "FRAGMENT.md"),
      `---
schema_version: 1
id: ${id}
kind: fragment
category: tooling
name: ${id}
description: A fragment that writes one file.
applies_to: []
---

Inspect the fragment's file.
`,
    );
    put(join(fragment, "files", file), contents);
  }
}

function changedSteps({ project }: Fixture) {
  const path = join(project, ".stacks", "manifest.json");
  const manifest = readFileSync(path, "utf8");
  const original = JSON.stringify(CHECK);
  if (!manifest.includes(original)) throw new Error("Fixture manifest is missing its test command");
  put(path, manifest.replace(original, JSON.stringify("printf 'changed command\n'")));
}

export const cases: ReadonlyArray<Case> = [
  { id: "help", args: ["--help"] },
  { id: "help-new", args: ["new", "--help"] },
  { id: "list", args: ["list"] },
  { id: "show", args: ["show", "typescript-cli"] },
  { id: "search", args: ["search", "go command line", "--local"] },
  { id: "schema", args: ["schema"] },
  { id: "schema-verify", args: ["schema", "verify"] },
  { id: "schema-error", args: ["schema", "error"] },
  { id: "validate", args: ["validate"] },
  { id: "new", args: ["new", "typescript-cli", "bundled-app", "--no-launch"] },
  {
    id: "new-fixture",
    args: ["new", "snapshot-fixture", "app", "--no-launch"],
    project: "outside",
    prepare: ({ home }) => seedRegistry(home),
  },
  {
    id: "new-preset-dry-run",
    args: ["new", "typescript-cli", "--dry-run"],
    prepare: ({ home }) =>
      writeJson(join(home, "config", "stacks", "config.json"), { preset: "sandbox" }),
  },
  {
    id: "add",
    args: ["add", "snapshot-extra", "--no-launch"],
    project: "inside",
    prepare: ({ home }) => seedRegistry(home),
  },
  {
    id: "add-conflict",
    args: ["add", "snapshot-conflict", "--no-launch"],
    project: "inside",
    prepare: ({ home }) => seedRegistry(home),
  },
  { id: "verify", args: ["verify"], project: "inside" },
  { id: "runs", args: ["runs"], project: "inside" },
  { id: "create", args: ["create", "stack", "snapshot-created", "--yes"] },
  { id: "unknown-command", args: ["shwo"] },
  { id: "unknown-flag", args: ["list", "--sorce"] },
  { id: "unknown-stack", args: ["new", "typescript-cl", "--no-launch"] },
  { id: "unknown-entry", args: ["show", "go-cl"] },
  { id: "unknown-schema", args: ["schema", "verfy"] },
  { id: "validate-missing-path", args: ["validate", "missing-registry"] },
  {
    id: "validate-findings",
    args: ["validate", "invalid-registry"],
    prepare: ({ cwd }) =>
      put(join(cwd, "invalid-registry", "stacks", "bad", "STACK.md"), "No frontmatter.\n"),
  },
  {
    id: "new-occupied-target",
    args: ["new", "typescript-cli", "occupied", "--no-launch"],
    prepare: ({ cwd }) => put(join(cwd, "occupied", "keep.txt"), "Keep this file.\n"),
  },
  {
    id: "unknown-fragment",
    args: ["add", "snapshot-missing", "--no-launch"],
    project: "inside",
    prepare: ({ home }) => seedRegistry(home),
  },
  { id: "create-existing", args: ["create", "stack", "go-cli", "--yes"] },
  { id: "verify-outside", args: ["verify"] },
  {
    id: "verify-failed",
    args: ["verify"],
    project: "inside",
    prepare: ({ project }) => put(join(project, "action.txt"), "fail\n"),
  },
  {
    id: "verify-interrupted",
    args: ["verify"],
    project: "inside",
    prepare: ({ project }) => {
      put(join(project, "action.txt"), "interrupt\n");
      rmSync(join(project, "teardown.txt"), { force: true });
    },
  },
  {
    id: "verify-changed-bogus-only",
    args: ["verify", "--only", "bogus"],
    project: "inside",
    prepare: changedSteps,
  },
  { id: "verify-changed", args: ["verify"], project: "inside" },
];
