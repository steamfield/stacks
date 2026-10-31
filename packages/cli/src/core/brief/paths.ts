/** A written file, or a directory standing for `files` of them. */
type Line = { path: string; files: number; dir: boolean };

/**
 * Written paths for a person or an agent to read: a directory holding more than three of the
 * listed lines is shown once as `dir/ (N files)`, deepest directories first, so a collapsed
 * subdirectory counts as one line of its parent. Sorted by path. The one implementation;
 * `new --json` keeps every path.
 */
export function collapsePaths(paths: ReadonlyArray<string>): string[] {
  let lines: Line[] = [...new Set(paths)].map((path) => ({ path, files: 1, dir: false }));
  const dirs = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth++)
      dirs.add(`${parts.slice(0, depth).join("/")}/`);
  }
  const deepestFirst = [...dirs].sort(
    (a, b) => b.split("/").length - a.split("/").length || (a < b ? -1 : 1),
  );
  for (const dir of deepestFirst) {
    const inside = lines.filter((line) => line.path.startsWith(dir) && line.path !== dir);
    if (inside.length <= 3) continue;
    const files = inside.reduce((sum, line) => sum + line.files, 0);
    lines = [...lines.filter((line) => !inside.includes(line)), { path: dir, files, dir: true }];
  }
  return lines
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((line) => (line.dir ? `${line.path} (${line.files} files)` : line.path));
}
