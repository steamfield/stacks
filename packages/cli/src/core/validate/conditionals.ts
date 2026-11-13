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

/**
 * Conditional prose in each body: the first malformed marker (1.1's `ConditionalProblem`), with
 * its line in the file; otherwise every `stack=` and `with=` id names an entry of the resolution
 * set, and every `tag=` or `tag!=` value is a tag some stack declares.
 */
export const conditionalChecks: Check = (view) =>
  Effect.gen(function* () {
    const findings: Finding[] = [];
    const tags = new Set(view.all.filter(isStack).flatMap((item) => item.meta.tags));
    for (const entry of view.entries)
      findings.push(...(yield* entryConditionalFindings(view, entry, tags)));
    return { findings };
  });

/**
 * A `stack=` or `with=` id: unknown is an error; found only outside the root is the same
 * `resolved-outside-root` note `referenceChecks` gives, since the block then depends on this
 * machine.
 */
function resolveId(view: View, kind: "stack" | "fragment", key: string, id: string) {
  const target = view.all.find((item) => item.kind === kind && item.id === id);
  if (!target)
    return {
      check: "conditional-ids",
      severity: "error",
      message: `${key}=${id} names no ${kind}, so the block is never kept`,
    } as const;
  if (view.inRoot(target)) return undefined;
  return {
    check: "resolved-outside-root",
    severity: "note",
    message: `${key}=${id} names a ${kind} found in the ${target.origin} registry`,
  } as const;
}

type ConditionalFinding = Pick<Finding, "check" | "severity" | "message">;

function idFindings(view: View, condition: Condition): ConditionalFinding[] {
  const findings: ConditionalFinding[] = [];
  for (const [kind, key, ids] of [
    ["stack", "stack", condition.stack ?? []],
    ["fragment", "with", condition.with ?? []],
  ] as const)
    for (const id of ids) {
      const found = resolveId(view, kind, key, id);
      if (found) findings.push(found);
    }
  return findings;
}

function tagFindings(tags: ReadonlySet<string>, condition: Condition): ConditionalFinding[] {
  const findings: ConditionalFinding[] = [];
  for (const [key, values] of [
    ["tag", condition.tag ?? []],
    ["tag!", condition["tag!="] ?? []],
  ] as const)
    for (const tag of values)
      if (!tags.has(tag))
        findings.push({
          check: "conditional-tag",
          severity: "warning",
          message: `${key}=${tag} is a tag no stack declares`,
        });
  return findings;
}

const entryConditionalFindings = (view: View, entry: Entry, tags: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const registry = yield* Registry;
    const findings: Finding[] = [];
    const file = entryFile(view, entry);
    // The body is the file's tail, so file lines are body lines plus the lines before it.
    const text = yield* Effect.option(registry.read(entry, markdownFile(entry.kind)));
    const offset =
      text._tag === "Some" ? text.value.split("\n").length - entry.body.split("\n").length : 0;
    const scanned = scanConditionals(entry.body);
    if (!("blocks" in scanned)) {
      findings.push(
        finding(entry, {
          check: "conditional-syntax",
          severity: "error",
          file,
          line: scanned.line + offset,
          problem: scanned.problem,
          message: PROBLEMS[scanned.problem],
        }),
      );
      return findings;
    }
    for (const block of scanned.blocks) {
      const line = block.start + offset;
      for (const found of [
        ...idFindings(view, block.condition),
        ...tagFindings(tags, block.condition),
      ])
        findings.push(finding(entry, { ...found, file, line }));
    }
    return findings;
  });
