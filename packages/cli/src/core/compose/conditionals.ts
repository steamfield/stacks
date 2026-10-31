/**
 * Conditional prose in entry bodies:
 *
 *   <!-- stacks:when stack=go-cli,python-react preset=default -->
 *   ...
 *   <!-- stacks:end -->
 *
 * Commas are OR within a key, several keys are AND, blocks don't nest and each marker is alone on
 * its line. A matching block loses its marker lines; a non-matching block is removed whole.
 * Markers are found on every line, code fences included: an entry that shows a marker as an
 * example has to indent it or break its spelling.
 */
import type { ConditionalProblem } from "../../errors";

/** What a block's condition is matched against. */
export type ConditionContext = {
  stack: string;
  tags: ReadonlyArray<string>;
  mode: "new" | "add";
  preset: "default" | "sandbox";
  /** Every fragment id in the composition, an app included. */
  with: ReadonlyArray<string>;
};

type Key = "stack" | "tag" | "tag!=" | "mode" | "preset" | "with";
export type Condition = Partial<Record<Key, ReadonlyArray<string>>>;
/** A malformed marker: its 1-based line in the body and what is wrong with it. */
export type ConditionalError = { line: number; problem: ConditionalProblem };

const MARKER = /^\s*<!--\s*stacks:(\S+)(.*?)-->\s*$/;
/**
 * `stacks:fill`, `stacks:fill: text` and `stacks:fill:text` mark text the agent
 * replaces; they are not conditionals and stay as written.
 */
const isFill = (directive: string) => directive === "fill" || directive.startsWith("fill:");
const KEYS: ReadonlyArray<Key> = ["stack", "tag", "tag!=", "mode", "preset", "with"];
const VALUES: Partial<Record<Key, ReadonlyArray<string>>> = {
  mode: ["new", "add"],
  preset: ["default", "sandbox"],
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
    const key = KEYS.find(
      (known) => match && known === `${match[1]}${match[2] === "!=" ? "!=" : ""}`,
    );
    if (!match || !key) return "unknown_key";
    // Every comma-separated value is non-empty: `stack=`, `stack=a,,b` and `stack=a,` are refused.
    const values = (match[3] ?? "").split(",");
    if (values.some((value) => !value)) return "bad_value";
    if (condition[key]) return "repeated";
    const allowed = VALUES[key];
    if (allowed && values.some((value) => !allowed.includes(value))) return "bad_value";
    condition[key] = values;
  }
  return condition;
}

function matches(condition: Condition, context: ConditionContext): boolean {
  const has: Record<Key, (value: string) => boolean> = {
    stack: (value) => value === context.stack,
    tag: (value) => context.tags.includes(value),
    "tag!=": (value) => context.tags.includes(value),
    mode: (value) => value === context.mode,
    preset: (value) => value === context.preset,
    with: (value) => context.with.includes(value),
  };
  return KEYS.every((key) => {
    const values = condition[key];
    if (!values) return true;
    return key === "tag!=" ? !values.some(has[key]) : values.some(has[key]);
  });
}

/** A well-formed block: its `when` and `end` lines (1-based in the body) and its condition. */
export type ConditionalBlock = { start: number; end: number; condition: Condition };

type MarkerState = {
  open: { line: number; condition: Condition } | undefined;
  blocks: ConditionalBlock[];
};

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
 */
export function resolveConditionals(
  body: string,
  context: ConditionContext,
): { text: string } | ConditionalError {
  const scanned = scanConditionals(body);
  if (!("blocks" in scanned)) return scanned;
  const drop = new Set<number>();
  for (const block of scanned.blocks) {
    // Marker lines always go; a block whose condition doesn't match goes whole.
    const keep = matches(block.condition, context);
    for (let line = block.start; line <= block.end; line++)
      if (!keep || line === block.start || line === block.end) drop.add(line - 1);
  }
  return { text: keepLines(body.split("\n"), drop) };
}

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
