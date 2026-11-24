/**
 * Save format. To change it: bump SAVE_VERSION, add migrations[old] that upgrades old to old+1, and
 * commit tests/fixtures/save-v<old>.json captured from the old code. tests/save.test.ts proves
 * every old save still loads.
 */
import { z } from "zod";
import type { Migrations } from "../kit/core/index.ts";

export const SAVE_VERSION = 1;

export const SaveSchema = z.object({
  /** Orb layout seed, so a resumed game has the same field. */
  seed: z.number().int(),
  /** Indices into world.orbs. */
  collected: z.array(z.number().int().nonnegative()),
});

export type SaveData = z.infer<typeof SaveSchema>;

export const migrations: Migrations = {};
