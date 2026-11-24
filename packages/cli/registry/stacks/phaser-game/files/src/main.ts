/**
 * The page entry: opens the save store for this game and boots it through the kit shell, which
 * starts Phaser inside its container.
 */
import { startPhaser } from "./engine/game.ts";
import { input } from "./engine/input.ts";
import { GAME } from "./game.ts";
import { createSaveStore } from "./kit/save.ts";
import { bootGame } from "./kit/shell.ts";
import { migrations, SAVE_VERSION, SaveSchema } from "./logic/save.ts";

const saves = await createSaveStore({
  gameId: GAME.id,
  version: SAVE_VERSION,
  schema: SaveSchema,
  migrate: migrations,
});

await bootGame({
  game: GAME,
  input,
  start: (ctx) => startPhaser(ctx, saves),
  onFirstGesture: () => saves.requestPersistence(),
});
