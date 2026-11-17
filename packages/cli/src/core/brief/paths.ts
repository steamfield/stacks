/** Condenses long scaffold listings for text readers. JSON results keep every path. */

/** A written file, or a directory standing for `files` of them. */
type Line = { path: string; files: number; dir: boolean };

const MAX_LISTED = 3;

/**
 * Collapse directories with more than three listed lines, deepest first, so a collapsed child
 * counts as one line of its parent. Sort the final listing by path.
 */
export function collapsePaths(paths: ReadonlyArray<string>): string[] {
  let lines: Line[] = [...new Set(paths)].map((path) => ({ path, files: 1, dir: false }));
  for (const dir of deepestFirst(parentDirs(paths))) lines = collapseInto(lines, dir);
  return lines
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((line) => (line.dir ? `${line.path} (${line.files} files)` : line.path));
}

/** Each ancestor is spelled with a trailing slash. */
function parentDirs(paths: ReadonlyArray<string>): Set<string> {
  const dirs = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth++)
      dirs.add(`${parts.slice(0, depth).join("/")}/`);
  }
  return dirs;
}

/** Deepest directories first, then by path. */
function deepestFirst(dirs: Set<string>): string[] {
  return [...dirs].sort((a, b) => b.split("/").length - a.split("/").length || (a < b ? -1 : 1));
}

function collapseInto(lines: ReadonlyArray<Line>, dir: string): Line[] {
  const inside = lines.filter((line) => line.path.startsWith(dir) && line.path !== dir);
  if (inside.length <= MAX_LISTED) return [...lines];
  const files = inside.reduce((sum, line) => sum + line.files, 0);
  return [...lines.filter((line) => !inside.includes(line)), { path: dir, files, dir: true }];
}
