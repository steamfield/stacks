/**
 * Everything observable that happens in a run. Tests, scenarios and `bun run see` read these, and
 * engine effects fire from them.
 */
export type GameEvent =
  | { type: "player.jumped" }
  | { type: "player.landed" }
  | { type: "orb.collected"; index: number; total: number }
  | { type: "field.cleared"; ticks: number };
