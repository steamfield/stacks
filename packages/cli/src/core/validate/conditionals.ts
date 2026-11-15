/**
 * Checks the conditional blocks in each entry's markdown body during `stacks validate`.
 *
 * An entry (a stack or a fragment) can wrap prose in `<!-- stacks:when ... -->` and
 * `<!-- stacks:end -->` markers so it reaches the brief (the task text the CLI writes for the
 * coding agent) only in some compositions; `compose/conditionals.ts` owns the syntax. This check
 * reports the first malformed marker in a body as an error (the scan stops there, so that entry
 * gets no other conditional findings). In a well-formed body it checks each block's values:
 * a `stack=` or `with=` id must name a known entry, and a `tag=` or `tag!=` value should be a tag
 * some stack declares, or the block is never kept.
 *
 * `validate/index.ts` runs `conditionalChecks`; `conditionals-reach.ts` then looks for blocks
 * whose stack exists but never brings the fragment in. Findings carry lines in the entry's file,
 * not its body, so an author can jump straight to them.
 */
import { Effect } from "effect";
import type { ConditionalProblem } from "../../errors";
import type { Finding } from "../../schemas/validate";
import { type Condition, scanConditionals } from "../compose/conditionals";
import { type Entry, isStack, markdownFile } from "../registry/entry";
import { Registry } from "../registry/registry";
import type { Check, View } from "./types";
import { entryFile, finding } from "./view";

const PROBLEMS: Record<ConditionalProblem, string> = {
  unclosed: "a when block has no end marker",
  nested: "a when block opens inside another; blocks don't nest",
  stray_end: "an end marker closes no block",
  unknown_key: "a when marker has an unknown key (stack, tag, tag!=, mode, preset, with)",
  bad_value: "a when marker has an empty value, or a mode or preset value that doesn't exist",
  empty: "a when marker has no condition",
  repeated: "a when marker repeats a key; use commas for alternatives",
  unknown_marker: "an unknown stacks: directive (when, end and fill exist)",
  not_alone: "a marker shares its line with other text",
};

/** A finding before the entry, file and line it belongs to are attached. */
type ConditionalFinding = Pick<Finding, "check" | "severity" | "message">;

export const conditionalChecks: Check = (view) =>
  Effect.gen(function* () {
    const findings: Finding[] = [];
    const tags = new Set(view.all.filter(isStack).flatMap((item) => item.meta.tags));
    for (const entry of view.entries)
      findings.push(...(yield* entryConditionalFindings(view, entry, tags)));
    return { findings };
  });

const entryConditionalFindings = (view: View, entry: Entry, tags: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const offset = yield* bodyLineOffset(entry);
    const file = entryFile(view, entry);
    const scanned = scanConditionals(entry.body);
    if (!("blocks" in scanned))
      return [
        finding(entry, {
          check: "conditional-syntax",
          severity: "error",
          file,
          line: scanned.line + offset,
          problem: scanned.problem,
          message: PROBLEMS[scanned.problem],
        }),
      ];
    return scanned.blocks.flatMap((block) =>
      [...idFindings(view, block.condition), ...tagFindings(tags, block.condition)].map((found) =>
        finding(entry, { ...found, file, line: block.start + offset }),
      ),
    );
  });

/**
 * How many lines of the entry's markdown file come before its body (the frontmatter), so a body
 * line plus this is a file line. A file that can't be read counts as 0.
 */
const bodyLineOffset = (entry: Entry) =>
  Effect.gen(function* () {
    const registry = yield* Registry;
    const text = yield* Effect.option(registry.read(entry, markdownFile(entry.kind)));
    if (text._tag === "None") return 0;
    return text.value.split("\n").length - entry.body.split("\n").length;
  });

function idFindings(view: View, condition: Condition): ConditionalFinding[] {
  return [
    ...(condition.stack ?? []).flatMap((id) => resolveId(view, "stack", "stack", id) ?? []),
    ...(condition.with ?? []).flatMap((id) => resolveId(view, "fragment", "with", id) ?? []),
  ];
}

/**
 * A `stack=` or `with=` id: unknown is an error; found only outside the root is the same
 * `resolved-outside-root` note `referenceChecks` gives, since the block then depends on this
 * machine.
 */
function resolveId(
  view: View,
  kind: "stack" | "fragment",
  key: string,
  id: string,
): ConditionalFinding | undefined {
  const target = view.all.find((item) => item.kind === kind && item.id === id);
  if (!target)
    return {
      check: "conditional-ids",
      severity: "error",
      message: `${key}=${id} names no ${kind}, so the block is never kept`,
    };
  if (view.inRoot(target)) return undefined;
  return {
    check: "resolved-outside-root",
    severity: "note",
    message: `${key}=${id} names a ${kind} found in the ${target.origin} registry`,
  };
}

function tagFindings(tags: ReadonlySet<string>, condition: Condition): ConditionalFinding[] {
  const undeclared = (key: string, values: ReadonlyArray<string>) =>
    values
      .filter((tag) => !tags.has(tag))
      .map(
        (tag): ConditionalFinding => ({
          check: "conditional-tag",
          severity: "warning",
          message: `${key}${tag} is a tag no stack declares`,
        }),
      );
  return [
    ...undeclared("tag=", condition.tag ?? []),
    ...undeclared("tag!=", condition["tag!="] ?? []),
  ];
}
