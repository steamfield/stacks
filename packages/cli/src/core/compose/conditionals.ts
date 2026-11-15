/**
 * Resolves the conditional blocks in an entry's markdown body for one composition.
 *
 * An entry (a stack or a fragment) can hold prose meant only for some compositions, such as a
 * paragraph that matters only when the `postgres` fragment is present or only under `--sandbox`:
 *
 *   <!-- stacks:when stack=go-cli,python-react preset=default -->
 *   ...
 *   <!-- stacks:end -->
 *
 * Commas are OR within a key, several keys are AND, blocks don't nest and each marker is alone on
 * its line. A matching block loses its marker lines; a non-matching block is removed whole.
 * Markers are found on every line, code fences included: an entry that shows a marker as an
 * example has to indent it or break its spelling. `stacks:fill` markers are a different thing
 * (text the agent replaces) and pass through untouched.
 *
 * `compose.ts` calls `resolveConditionals` on every composed body before the brief is rendered,
 * and again with `withFragment` to pull out the recipe notes `stacks add` shows. `validate` uses
 * `scanConditionals` to report malformed markers, and `brief/words.ts` uses `isConditionalMarker`
 * so marker lines don't count toward word budgets.
 */
import type { ConditionalProblem } from "../../errors";
import { DEFAULT_PAYLOAD, PAYLOADS, type Payload } from "../registry/entry";

/** What a block's condition is matched against. */
export type ConditionContext = {
  stack: string;
  tags: ReadonlyArray<string>;
  mode: "new" | "add";
  preset: "default" | "sandbox";
  /** Every fragment id in the composition, an app included. */
  with: ReadonlyArray<string>;
  /** The stack's payload variant (`new --payload`); absent is the example. */
  payload?: Payload;
};

type Key = "stack" | "tag" | "tag!=" | "mode" | "preset" | "with" | "payload";
export type Condition = Partial<Record<Key, ReadonlyArray<string>>>;
/** A malformed marker: its 1-based line in the body and what is wrong with it. */
type ConditionalError = { line: number; problem: ConditionalProblem };

const MARKER = /^\s*<!--\s*stacks:(\S+)(.*?)-->\s*$/;
/**
 * `stacks:fill`, `stacks:fill: text` and `stacks:fill:text` mark text the agent
 * replaces; they are not conditionals and stay as written.
 */
const isFill = (directive: string) => directive === "fill" || directive.startsWith("fill:");
const KEYS: ReadonlyArray<Key> = ["stack", "tag", "tag!=", "mode", "preset", "with", "payload"];
const VALUES: Partial<Record<Key, ReadonlyArray<string>>> = {
  mode: ["new", "add"],
  preset: ["default", "sandbox"],
  payload: PAYLOADS,
};

/** True for a `when` or `end` marker line, which `countWords` leaves out. */
export function isConditionalMarker(line: string): boolean {
  const match = MARKER.exec(line);
  return match?.[1] === "when" || match?.[1] === "end";
}

/** A `when` marker's condition, or what is wrong with it. */
function parseCondition(spec: string): Condition | ConditionalProblem {
  const parts = spec.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "empty";
  const condition: Condition = {};
  for (const part of parts) {
    const match = /^([a-z]+)(!?=)(.*)$/.exec(part);
    if (!match) return "unknown_key";
    const [, name = "", operator, valueList = ""] = match;
    // `tag!=x` is its own key; every other key takes `=` only.
    const spelled = operator === "!=" ? `${name}!=` : name;
    const key = KEYS.find((known) => known === spelled);
    if (!key) return "unknown_key";
    // Every comma-separated value is non-empty: `stack=`, `stack=a,,b` and `stack=a,` are refused.
    const values = valueList.split(",");
    if (values.some((value) => !value)) return "bad_value";
    if (condition[key]) return "repeated";
    const allowed = VALUES[key];
    if (allowed && values.some((value) => !allowed.includes(value))) return "bad_value";
    condition[key] = values;
  }
  return condition;
}

/** Whether every key in `condition` holds: any listed value matches, or for `tag!=`, none does. */
function matches(condition: Condition, context: ConditionContext): boolean {
  const has: Record<Key, (value: string) => boolean> = {
    stack: (value) => value === context.stack,
    tag: (value) => context.tags.includes(value),
    "tag!=": (value) => context.tags.includes(value),
    mode: (value) => value === context.mode,
    preset: (value) => value === context.preset,
    with: (value) => context.with.includes(value),
    payload: (value) => value === (context.payload ?? DEFAULT_PAYLOAD),
  };
  return KEYS.every((key) => {
    const values = condition[key];
    if (!values) return true;
    return key === "tag!=" ? !values.some(has[key]) : values.some(has[key]);
  });
}

/** A well-formed block: its `when` and `end` lines (1-based in the body) and its condition. */
type ConditionalBlock = { start: number; end: number; condition: Condition };

/** The scan so far: the block whose `when` has no `end` yet, and the blocks already closed. */
type MarkerState = {
  open: { line: number; condition: Condition } | undefined;
  blocks: ConditionalBlock[];
};

/** Applies one marker line to the scan, or reports what is wrong with it. */
function scanMarker(
  match: RegExpExecArray,
  line: number,
  state: MarkerState,
): ConditionalError | undefined {
  const [, directive = "", rest = ""] = match;
  if (directive === "when") {
    if (state.open) return { line, problem: "nested" };
    const condition = parseCondition(rest);
    if (typeof condition === "string") return { line, problem: condition };
    state.open = { line, condition };
  } else if (directive === "end") {
    if (!state.open) return { line, problem: "stray_end" };
    state.blocks.push({ start: state.open.line, end: line, condition: state.open.condition });
    state.open = undefined;
  } else if (!isFill(directive)) return { line, problem: "unknown_marker" };
  return undefined;
}

/** Every block in `body`, in order, or the first malformed marker. */
export function scanConditionals(
  body: string,
): { blocks: ReadonlyArray<ConditionalBlock> } | ConditionalError {
  const blocks: ConditionalBlock[] = [];
  const state: MarkerState = { open: undefined, blocks };
  for (const [i, text] of body.split("\n").entries()) {
    const line = i + 1;
    const match = MARKER.exec(text);
    if (!match) {
      if (/<!--\s*stacks:(?:when|end)\b/.test(text)) return { line, problem: "not_alone" };
      continue;
    }
    const problem = scanMarker(match, line, state);
    if (problem) return problem;
  }
  if (state.open) return { line: state.open.line, problem: "unclosed" };
  return { blocks };
}

/**
 * `body` with every block resolved for `context`, or the first malformed marker. A blank line
 * left doubled by a removal is dropped, so a removed block leaves no gap.
 * With `withFragment`, keep only matching blocks explicitly naming that fragment, for add notes.
 */
export function resolveConditionals(
  body: string,
  context: ConditionContext,
  withFragment?: string,
): { text: string } | ConditionalError {
  const scanned = scanConditionals(body);
  if (!("blocks" in scanned)) return scanned;
  const lines = body.split("\n");
  // Indexes of lines to drop. For add notes, start with every line dropped, so only the inside
  // of a block naming the fragment survives.
  const drop = new Set<number>(withFragment === undefined ? [] : lines.keys());
  for (const block of scanned.blocks) {
    // Marker lines always go; a block whose condition doesn't match goes whole.
    const keep =
      matches(block.condition, context) &&
      (withFragment === undefined || block.condition.with?.includes(withFragment));
    for (let line = block.start; line <= block.end; line++) {
      if (!keep || line === block.start || line === block.end) drop.add(line - 1);
      else drop.delete(line - 1);
    }
  }
  return { text: keepLines(lines, drop) };
}

/** `lines` without the dropped ones, skipping a blank line that a removal would leave doubled. */
function keepLines(lines: ReadonlyArray<string>, drop: ReadonlySet<number>): string {
  const out: string[] = [];
  let removed = false;
  for (const [i, text] of lines.entries()) {
    if (drop.has(i)) {
      removed = true;
      continue;
    }
    const previous = out.at(-1);
    if (removed && text.trim() === "" && (previous === undefined || previous.trim() === ""))
      continue;
    removed = false;
    out.push(text);
  }
  return out.join("\n");
}
