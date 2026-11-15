/**
 * Markdown line handling for entry bodies: moving their headings under a brief section, and
 * finding the prose lines outside code blocks.
 *
 * An entry's body (the Markdown below its frontmatter) is written as a standalone document, often
 * starting with its own `# Title`. When `render.ts` places that body under a `## Stack: ...`
 * section, `nest` drops the title and shifts the remaining headings down so the brief's outline
 * stays consistent. `core/validate/` uses `proseLines` to check headings and wording without
 * reading inside fenced examples.
 *
 * ATX headings are the `#`-prefixed kind; setext headings (underlined with `===` or `---`) are
 * left alone. A fence is a line opening or closing a code block with three or more backticks or
 * tildes.
 */

const ATX = /^ {0,3}(#{1,6})(?=[ \t]|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const H1 = /^ {0,3}#(?:[ \t]|$)/;

const nonBlank = (line: string) => line.trim() !== "";

/**
 * An entry body nested under a brief section whose heading is `level - 1` deep: a leading level-1
 * heading is dropped when more content follows (the section heading names the entry). Other ATX
 * headings shift so the shallowest lands at `level`, keeping relative depth and clamping at
 * `######`. Lines inside fenced code blocks are never touched; setext headings are left alone.
 */
export function nest(body: string, level = 3): string {
  const lines = withoutTitle(body.split("\n"));
  const depths = headingDepths(lines);
  const present = depths.filter((depth) => depth > 0);
  if (present.length === 0) return lines.join("\n");
  const shift = level - Math.min(...present);
  return lines
    .map((line, i) => {
      const depth = depths[i] ?? 0;
      return depth ? shiftedHeading(line, depth, shift) : line;
    })
    .join("\n");
}

/**
 * The lines without a leading `# Title` and the blank lines after it, when anything else is left;
 * otherwise the lines unchanged.
 */
function withoutTitle(lines: ReadonlyArray<string>): string[] {
  const first = lines.findIndex(nonBlank);
  if (lines.filter(nonBlank).length < 2 || !H1.test(lines[first] ?? "")) return [...lines];
  let next = first + 1;
  while (lines[next]?.trim() === "") next++;
  return [...lines.slice(0, first), ...lines.slice(next)];
}

/** Each line's ATX heading depth, 0 for a non-heading or any line in or around a fence. */
function headingDepths(lines: ReadonlyArray<string>): number[] {
  let fence: string | undefined;
  const depths: number[] = [];
  for (const line of lines) {
    const marker = FENCE.exec(line)?.[1];
    if (marker !== undefined) {
      fence = fenceAfter(fence, marker);
      depths.push(0);
    } else depths.push(fence === undefined ? (ATX.exec(line)?.[1]?.length ?? 0) : 0);
  }
  return depths;
}

/** The open fence after a fence line: it opens one, closes the open one, or sits inside it. */
function fenceAfter(open: string | undefined, marker: string): string | undefined {
  if (open === undefined) return marker;
  return closes(marker, open) ? undefined : open;
}

/** A marker closes a fence when it uses the same character and is at least as long. */
function closes(marker: string, open: string): boolean {
  return marker[0] === open[0] && marker.length >= open.length;
}

/** A heading line at `depth + shift`, clamped to 1 to 6, with its leading indent removed. */
function shiftedHeading(line: string, depth: number, shift: number): string {
  const indent = line.length - line.trimStart().length;
  const next = Math.min(6, Math.max(1, depth + shift));
  return `${"#".repeat(next)}${line.slice(indent + depth)}`;
}

/** Markdown lines outside fenced examples, retaining their source line numbers. */
export function proseLines(text: string): Array<{ text: string; line: number }> {
  const prose: Array<{ text: string; line: number }> = [];
  let fence: string | undefined;
  text.split("\n").forEach((raw, index) => {
    const line = raw.replace(/\r$/, "");
    const marker = FENCE.exec(line)?.[1];
    if (fence !== undefined) {
      // Only a bare marker line closes the fence here.
      if (marker !== undefined && closes(marker, fence) && line.trim().length === marker.length)
        fence = undefined;
      return;
    }
    if (marker) {
      fence = marker;
      return;
    }
    prose.push({ text: line, line: index + 1 });
  });
  return prose;
}
