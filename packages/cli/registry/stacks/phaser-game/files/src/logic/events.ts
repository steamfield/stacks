/** Everything observable that happens in a run. Tests, scenarios and `bun run see` read these. */
export type GameEvent =
  | { type: "player.jumped" }
  | { type: "player.landed" }
  | { type: "player.respawned" }
  | { type: "coin.collected"; index: number; total: number }
  | { type: "level.completed"; coins: number; ticks: number };
