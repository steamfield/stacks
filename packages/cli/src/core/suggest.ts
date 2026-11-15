/**
 * Finds the "did you mean" suggestions for a mistyped command, flag, id or name.
 *
 * Every suggestion the CLI prints comes from `closest`: `main.ts` for unknown subcommands and
 * flags, and `list`, `show`, `create`, `guide`, `skill`, `schema`, `submit`, `validate` and
 * composition for unknown ids and names (`.claude/rules/cli/cli.md` forbids a second edit-distance function). The result
 * appears in error `details` and text output, so the threshold, the limit of three and the
 * tie-breaking order below are all user-visible.
 */

/** Optimal string alignment distance: Levenshtein plus adjacent transpositions as one edit. */
function distance(a: string, b: string): number {
  // rows[i][j] is the distance between a's first i and b's first j characters.
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => {
      if (i === 0) return j;
      return j === 0 ? i : 0;
    }),
  );
  const at = (i: number, j: number) => rows[i]?.[j] ?? Number.POSITIVE_INFINITY;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        best = Math.min(best, at(i - 2, j - 2) + 1);
      const row = rows[i];
      if (row) row[j] = best;
    }
  return at(a.length, b.length);
}

/** Orders strings by UTF-16 code units, the default `sort` order, independent of locale. */
function byCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * Up to three known names within an edit distance of 2 of `name`, nearest first, ties broken
 * alphabetically ignoring case, then by raw spelling. Case is ignored when measuring. The one
 * "did you mean" helper for the CLI.
 */
export function closest(name: string, known: readonly string[]): string[] {
  const target = name.toLowerCase();
  return known
    .map((candidate) => {
      const lower = candidate.toLowerCase();
      return { candidate, lower, d: distance(target, lower) };
    })
    .filter(({ d }) => d <= 2)
    .sort(
      (x, y) => x.d - y.d || byCodeUnits(x.lower, y.lower) || byCodeUnits(x.candidate, y.candidate),
    )
    .slice(0, 3)
    .map(({ candidate }) => candidate);
}
