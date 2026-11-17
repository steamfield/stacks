/**
 * Nests standalone entry headings under a brief section and identifies prose outside fenced
 * examples.
 */

const ATX = /^ {0,3}(#{1,6})(?=[ \t]|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const H1 = /^ {0,3}#(?:[ \t]|$)/;

const nonBlank = (line: string) => line.trim() !== "";

/**
 * Drop a leading ATX title if more content follows because the section names the entry. Shift
 * the other ATX headings together to fit the brief's outline while preserving their relative
 * depth up to level six. The shallowest lands at `level`. Keep fenced code and setext headings.
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

/** Zero keeps non-headings, fence markers and fenced examples out of the heading shift. */
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

function fenceAfter(open: string | undefined, marker: string): string | undefined {
  if (open === undefined) return marker;
  return closes(marker, open) ? undefined : open;
}

/** A marker closes a fence when it uses the same character and is at least as long. */
function closes(marker: string, open: string): boolean {
  return marker[0] === open[0] && marker.length >= open.length;
}

function shiftedHeading(line: string, depth: number, shift: number): string {
  const indent = line.length - line.trimStart().length;
  const next = Math.min(6, Math.max(1, depth + shift));
  return `${"#".repeat(next)}${line.slice(indent + depth)}`;
}

/** Preserve source line numbers for heading and wording findings while skipping fenced examples. */
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
