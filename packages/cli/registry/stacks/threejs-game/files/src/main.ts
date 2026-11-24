/**
 * The page entry: opens the save store for this game and boots it through the kit shell.
 */

import { startThree } from "./engine/game.ts";
import { input } from "./engine/input.ts";
import { game } from "./game.ts";
import { createSaveStore } from "./kit/save.ts";
import { bootGame } from "./kit/shell.ts";
import { migrations, SAVE_VERSION, SaveSchema } from "./logic/save.ts";

const saves = await createSaveStore({
  gameId: game.id,
  version: SAVE_VERSION,
  schema: SaveSchema,
  migrate: migrations,
});

await bootGame({
  identity: game,
  input,
  start: (ctx) => startThree(ctx, saves),
  onFirstGesture: () => saves.requestPersistence(),
});
