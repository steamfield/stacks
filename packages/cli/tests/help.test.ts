import { expect, test } from "vitest";
import { cli } from "../src/cli";
import { errorTable } from "../src/errors";
import { runCli } from "./helpers/cli";
import { declaredFlags, helpSection } from "./helpers/help";

type Node = { readonly path: ReadonlyArray<string>; readonly command: Command };
type Command = (typeof cli.subcommands)[number]["commands"][number];

const children = (command: Command) => command.subcommands.flatMap((group) => group.commands);

/** Every command below the root, depth first, with the argv that reaches it. */
function walk(command: Command, path: ReadonlyArray<string> = []): Node[] {
  return children(command).flatMap((child) => {
    const node = { path: [...path, child.name], command: child };
    return [node, ...walk(child, node.path)];
  });
}

const nodes = walk(cli);
const leaves = nodes.filter((node) => children(node.command).length === 0);
const help = async (path: ReadonlyArray<string>) => {
  const run = await runCli([...path, "--help"]);
  expect(run.status, `${path.join(" ")}: ${run.stderr}`).toBe(0);
  return run.stdout;
};

test("every command has a description and a one-line short description for the root list", () => {
  expect(nodes.map((node) => node.path.join(" "))).toContain("skill install");
  for (const { path, command } of nodes) {
    const name = path.join(" ");
    expect(command.description?.trim(), name).toBeTruthy();
    expect(command.shortDescription?.trim(), name).toBeTruthy();
    expect(command.shortDescription?.length ?? 0, name).toBeLessThanOrEqual(80);
    expect(command.shortDescription, name).not.toContain("\n");
  }
});

test("the root --help lists subcommands alphabetically by their short descriptions", async () => {
  const text = await help([]);
  expect(text).toContain('Start here (agents): stacks search "<their words>" --json');
  expect(text).toContain("Browse or recover with stacks list --json.");
  const listed = helpSection(text, "SUBCOMMANDS").map((line) => line.trim());
  const names = listed.map((line) => line.split(/\s+/)[0]);
  expect(names).toEqual([...names].sort());
  for (const command of children(cli)) {
    const line = listed.find((entry) => entry.startsWith(`${command.name} `));
    expect(line?.replace(/^\S+\s+/, ""), command.name).toBe(command.shortDescription);
  }
});

test("every flag and argument in a command's help has a description", async () => {
  for (const { path } of nodes) {
    const text = await help(path);
    for (const heading of ["ARGUMENTS", "FLAGS"])
      for (const line of helpSection(text, heading))
        expect(line, `${path.join(" ")} ${heading}`).toMatch(/^ {2}\S.*? {2,}\S/);
  }
});

test("every leaf command's help has examples whose flags that command declares", async () => {
  for (const { path } of leaves) {
    const name = path.join(" ");
    const text = await help(path);
    const examples = helpSection(text, "EXAMPLES").filter((line) => !line.trim().startsWith("#"));
    expect(examples.length, name).toBeGreaterThanOrEqual(2);
    const flags = declaredFlags(text);
    for (const example of examples) {
      const argv = example.trim().split(/\s+/);
      expect(argv.slice(0, path.length + 1), example).toEqual(["stacks", ...path]);
      for (const flag of argv.filter((word) => word.startsWith("--")))
        expect(flags.has(flag), `${example}: ${flag}`).toBe(true);
    }
  }
});

/**
 * The exits each command's handler can reach, beyond the agent's own status after a launch. A
 * change here means rereading that command's error paths, not just its description.
 */
const exits: Record<string, ReadonlyArray<number>> = {
  add: [0, 2, 3, 5, 6, 130],
  "create fragment": [0, 2, 6, 130],
  "create stack": [0, 2, 6, 130],
  doctor: [0, 2, 130],
  guide: [0, 2, 130],
  "guide author": [0, 2, 6, 130],
  list: [0, 2, 6, 130],
  new: [0, 2, 3, 6, 130],
  runs: [0, 2, 3, 6, 130],
  schema: [0, 2, 130],
  search: [0, 2, 6, 130],
  show: [0, 2, 3, 6, 130],
  "skill install": [0, 2, 6, 130],
  "telemetry disable": [0, 2, 3, 6, 130],
  "telemetry enable": [0, 2, 3, 6, 130],
  "telemetry flush": [0, 2, 130],
  "telemetry reset": [0, 2, 130],
  "telemetry status": [0, 2, 130],
  update: [0, 2, 4, 6, 130],
  validate: [0, 2, 3, 6, 130],
  verify: [0, 2, 3, 5, 6, 130],
};

test("every command's description states exactly the exits it can reach, naming real tags", () => {
  // Leaves, plus a command that runs a handler of its own beside its subcommands (`guide`).
  const runnable = nodes.filter(
    (node) => leaves.includes(node) || /\bExits /.test(node.command.description ?? ""),
  );
  expect(runnable.map((node) => node.path.join(" ")).sort()).toEqual(Object.keys(exits).sort());
  const tags = new Set(Object.keys(errorTable));
  for (const { path, command } of runnable) {
    const name = path.join(" ");
    const sentence = /Exits (.*)$/.exec(command.description ?? "")?.[1];
    expect(sentence, `${name} states its exit codes`).toBeDefined();
    const stated = new Set((sentence?.match(/\b\d+\b/g) ?? []).map(Number));
    expect(
      [...stated].sort((a, b) => a - b),
      name,
    ).toEqual(exits[name]);
    for (const [, tag] of command.description?.matchAll(/\(([A-Z][A-Za-z]+)[;)]/g) ?? [])
      expect(tags.has(tag ?? ""), `${name}: ${tag}`).toBe(true);
  }
});
