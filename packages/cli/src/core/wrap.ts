/**
 * Wraps long lines of text output to fit a person's terminal, for the human audience only.
 *
 * Commands such as `stacks show`, `list`, `search` and `guide` print entry descriptions and
 * guidance that can run hundreds of characters on one line. `textWidth` picks the width once per
 * command (a terminal-sized width for a person, no limit for an agent or a pipe, since an agent
 * reads lines whole), and the report renderers (`show-report.ts`, `list-report.ts`,
 * `search/report.ts`, `commands/guide.ts`) call `wrap` or `wrapWords` with it.
 *
 * Width is measured with an injected function, `Host.stringWidth` from `platform/width.ts`,
 * because a wide character such as a CJK ideograph or an emoji takes two terminal columns, and
 * this module stays pure. Markdown that has its own layout is left exactly as written: fenced
 * code blocks, indented lines and `-` list items pass through byte for byte, and blank lines
 * still separate paragraphs.
 */
import { Option } from "effect";

/** The opening line of a fenced code block, capturing its run of backticks or tildes. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/** Human text wraps at the terminal, between 20 and 80 columns; agent text never wraps. */
export function textWidth(human: boolean, columns: Option.Option<number>): number {
  if (!human) return Number.POSITIVE_INFINITY;
  return Option.match(columns, {
    onNone: () => 80,
    onSome: (value) => Math.min(80, Math.max(20, value)),
  });
}

/** Whether `width` asks for wrapping; infinity (the agent width), zero and NaN don't. */
const wrapsAt = (width: number) => width > 0 && Number.isFinite(width);

/** Whether `line` closes the fence `opener` began: the same character, at least as many. */
function closesFence(line: string, opener: string): boolean {
  return new RegExp(`^ {0,3}${opener.charAt(0)}{${opener.length},}\\s*$`).test(line);
}

/** Indented lines (code, nested items) and `-` list items keep their own line breaks. */
const keepsLayout = (line: string) => /^(?:\s|-)/.test(line);

/** Wrap prose at spaces; preserve code, lists, fences and paragraph breaks. */
export function wrap(text: string, width: number, measure: (text: string) => number): string {
  if (!wrapsAt(width)) return text;
  const lines: string[] = [];
  let fence: string | undefined;
  for (const line of text.split("\n")) {
    if (fence !== undefined) {
      if (closesFence(line, fence)) fence = undefined;
      lines.push(line);
      continue;
    }
    fence = FENCE_OPEN.exec(line)?.[1];
    const keep = fence !== undefined || keepsLayout(line);
    lines.push(keep ? line : wrapWords(line, width, measure));
  }
  return lines.join("\n");
}

/** Wrap plain prose, including descriptions whose first word resembles Markdown. */
export function wrapWords(text: string, width: number, measure: (text: string) => number): string {
  if (!wrapsAt(width)) return text;
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/ +/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (current && measure(next) > width) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  lines.push(current);
  return lines.join("\n");
}
