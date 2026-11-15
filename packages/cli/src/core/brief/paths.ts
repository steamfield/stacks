/**
 * Shortens a list of written files for reading: a directory with many files becomes one line.
 *
 * `render.ts` lists the files `stacks new` wrote in the brief's facts, and
 * `core/scaffold/report.ts` prints the same list after `stacks new` finishes. A stack can write
 * dozens of files, so both show `src/components/ (12 files)` instead of every path. `new --json`
 * is unaffected and keeps every path.
 */

/** A written file, or a directory standing for `files` of them. */
type Line = { path: string; files: number; dir: boolean };

/** How many lines a directory may hold before it collapses to one. */
const MAX_LISTED = 3;

/**
 * Written paths for a person or an agent to read: a directory holding more than three of the
 * listed lines is shown once as `dir/ (N files)`, deepest directories first, so a collapsed
 * subdirectory counts as one line of its parent. Sorted by path. The one implementation;
 * `new --json` keeps every path.
 */
export function collapsePaths(paths: ReadonlyArray<string>): string[] {
  let lines: Line[] = [...new Set(paths)].map((path) => ({ path, files: 1, dir: false }));
  for (const dir of deepestFirst(parentDirs(paths))) lines = collapseInto(lines, dir);
  return lines
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((line) => (line.dir ? `${line.path} (${line.files} files)` : line.path));
}

/** Every directory above a path, each ending in `/`. */
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

/** The lines with `dir`'s contents replaced by one line for `dir`, when it holds more than three. */
function collapseInto(lines: ReadonlyArray<Line>, dir: string): Line[] {
  const inside = lines.filter((line) => line.path.startsWith(dir) && line.path !== dir);
  if (inside.length <= MAX_LISTED) return [...lines];
  const files = inside.reduce((sum, line) => sum + line.files, 0);
  return [...lines.filter((line) => !inside.includes(line)), { path: dir, files, dir: true }];
}
