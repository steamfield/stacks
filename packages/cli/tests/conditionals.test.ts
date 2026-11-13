import { Exit } from "effect";
import { afterEach, expect, test } from "vitest";
import { type ConditionContext, resolveConditionals } from "../src/core/compose/conditionals";
import type { Composition } from "../src/core/compose/types";
import { EntryInvalid } from "../src/errors";
import { tempDir } from "./helpers/cli";
import { bundledAt, composeExit } from "./helpers/compose";
import { composeRegistry, minimal, writeEntry } from "./helpers/registry";

const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});
function temp() {
  const dir = tempDir();
  dirs.push(dir);
  return dir.path;
}

const context: ConditionContext = {
  stack: "go-cli",
  tags: ["go", "cli"],
  mode: "new",
  preset: "default",
  with: ["lint"],
};
const block = (when: string, text = "INSIDE") =>
  `before\n<!-- stacks:when ${when} -->\n${text}\n<!-- stacks:end -->\nafter`;
const resolved = (body: string, over: Partial<ConditionContext> = {}) =>
  resolveConditionals(body, { ...context, ...over });

test.each([
  ["stack=go-cli,python-react", true],
  ["stack=python-react", false],
  ["tag=cli", true],
  ["tag=web,cli", true],
  ["tag=web", false],
  ["tag!=web", true],
  ["tag!=web,go", false],
  ["with=lint", true],
  ["with=hooks", false],
  ["preset=default", true],
  ["preset=sandbox", false],
  ["mode=new", true],
  ["mode=add", false],
  ["stack=go-cli preset=sandbox", false],
  ["stack=go-cli tag=go mode=new", true],
] as const)("a when %s block is kept: %s, losing its marker lines either way", (when, kept) => {
  expect(resolved(block(when))).toEqual({
    text: kept ? "before\nINSIDE\nafter" : "before\nafter",
  });
});

test("a removed block leaves no doubled blank line", () => {
  const body = "one\n\n<!-- stacks:when tag=web -->\nWEB\n<!-- stacks:end -->\n\ntwo";
  expect(resolved(body)).toEqual({ text: "one\n\ntwo" });
});

test("fill markers are not conditionals and stay as written, even inside a kept block", () => {
  const body = block("tag=go", "<!-- stacks:fill describe the CLI -->");
  expect(resolved(body)).toEqual({
    text: "before\n<!-- stacks:fill describe the CLI -->\nafter",
  });
});

test.each([
  ["a nested block", block("tag=go", block("tag=cli")), 4, "nested"],
  ["an unclosed block", "a\n<!-- stacks:when tag=go -->\nb", 2, "unclosed"],
  ["a stray end", "a\n<!-- stacks:end -->", 2, "stray_end"],
  ["an unknown key", "<!-- stacks:when os=linux -->", 1, "unknown_key"],
  ["an unknown preset", "<!-- stacks:when preset=prod -->", 1, "bad_value"],
  ["a key with no value", "<!-- stacks:when stack= -->", 1, "bad_value"],
  ["an empty value between commas", "<!-- stacks:when stack=a,,b -->", 1, "bad_value"],
  ["a trailing comma", "<!-- stacks:when tag=a, -->", 1, "bad_value"],
  ["an empty condition", "<!-- stacks:when -->", 1, "empty"],
  ["a repeated key", "<!-- stacks:when tag=a tag=b -->", 1, "repeated"],
  ["an unknown directive", "<!-- stacks:unless tag=a -->", 1, "unknown_marker"],
  ["a marker sharing its line", "text <!-- stacks:when tag=a -->", 1, "not_alone"],
] as const)("%s fails at its line", (_case, body, line, problem) => {
  expect(resolved(body)).toEqual({ line, problem });
});

test("every fill spelling passes through: bare, with a space, and with no space after the colon", () => {
  for (const marker of [
    "<!-- stacks:fill -->",
    "<!-- stacks:fill: the summary -->",
    "<!-- stacks:fill:summary -->",
  ])
    expect(resolved(`a\n${marker}\nb`)).toEqual({ text: `a\n${marker}\nb` });
});

test("markers inside a code fence are processed like any other line", () => {
  const body = ["```md", "<!-- stacks:when tag=web -->", "WEB", "<!-- stacks:end -->", "```"].join(
    "\n",
  );
  expect(resolved(body)).toEqual({ text: "```md\n```" });
  expect(resolved("```\n<!-- stacks:end -->\n```")).toEqual({ line: 2, problem: "stray_end" });
});

test("compose resolves the stack's blocks against the stack, its tags, the selection and the preset [1.1#13]", async () => {
  const body = async (options: Parameters<typeof composeExit>[0]) => {
    const exit = await composeExit(options);
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
    return (exit.value as Composition).stack.body;
  };
  const plain = await body({});
  for (const kept of ["STACK-BLOCK-KEPT", "NOT-GO-KEPT", "DEFAULT-PRESET-NEW"])
    expect(plain).toContain(kept);
  for (const dropped of ["STACK-BLOCK-DROPPED", "NOT-WEB-DROPPED", "WITH-HOOKS-A", "SANDBOX-ONLY"])
    expect(plain).not.toContain(dropped);
  expect(plain).not.toContain("stacks:");
  const other = await body({ with: ["hooks-a"], preset: "sandbox" });
  for (const kept of ["WITH-HOOKS-A", "SANDBOX-ONLY"]) expect(other).toContain(kept);
  expect(other).not.toContain("DEFAULT-PRESET-NEW");
});

test.each([
  ["unclosed", "# Bad\n\n<!-- stacks:when tag=web -->\ntext\n", 11],
  ["nested", "# Bad\n<!-- stacks:when tag=web -->\n<!-- stacks:when tag=bun -->\n", 11],
] as const)(
  "an entry with an %s block fails EntryInvalid with the line in its file [1.1#13]",
  async (_case, text, line) => {
    const user = temp();
    // Frontmatter fills lines 1-8 of FRAGMENT.md, so the body starts at line 9.
    writeEntry({
      root: user,
      kind: "fragment",
      dir: "bad-when",
      frontmatter: minimal("fragment", "bad-when"),
      body: text,
    });
    const roots = [{ origin: "user", path: user } as const, ...bundledAt(composeRegistry)];
    expect(await composeExit({ with: ["bad-when"] }, { roots })).toEqual(
      Exit.fail(
        new EntryInvalid({
          details: {
            id: "bad-when",
            origin: "user",
            reason: "conditional",
            path: "FRAGMENT.md",
            line,
            problem: _case,
          },
        }),
      ),
    );
  },
);
