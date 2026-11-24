/**
 * Levels are ASCII so agents can read and write them directly.
 *   #  solid tile    o  coin    P  player spawn    G  goal flag    .  empty
 * Every row must be the same width.
 */
export const TILE = 16;

export interface Level {
  width: number;
  height: number;
  solid: boolean[][];
  coins: { x: number; y: number }[];
  spawn: { x: number; y: number };
  goal: { x: number; y: number };
}

export function parseLevel(ascii: string): Level {
  const rows = ascii
    .trim()
    .split("\n")
    .map((r) => r.trim());
  const width = rows[0]?.length ?? 0;
  const coins: Level["coins"] = [];
  let spawn: Level["spawn"] | undefined;
  let goal: Level["goal"] | undefined;
  const solid = rows.map((row, y) => {
    if (row.length !== width) {
      throw new Error(`Level row ${y} is ${row.length} wide, expected ${width}`);
    }
    return [...row].map((ch, x) => {
      if (ch === "o") coins.push({ x, y });
      else if (ch === "P") spawn = { x, y };
      else if (ch === "G") goal = { x, y };
      else if (ch !== "#" && ch !== ".") {
        throw new Error(`Unknown level character "${ch}" at ${x},${y}`);
      }
      return ch === "#";
    });
  });
  if (!spawn) throw new Error("Level has no spawn point (P)");
  if (!goal) throw new Error("Level has no goal (G)");
  return { width, height: rows.length, solid, coins, spawn, goal };
}

export function isSolid(level: Level, tx: number, ty: number): boolean {
  if (tx < 0 || tx >= level.width) return true;
  if (ty < 0 || ty >= level.height) return false;
  return level.solid[ty]?.[tx] ?? false;
}

export const LEVEL_1 = `
........................................
........................................
........................................
........................................
........................................
..............o.o.......................
.............#####..........o.o.o.......
.....o.o...............#########........
....#####...............................
.P.........o........#..............o..G.
########################################
`;
