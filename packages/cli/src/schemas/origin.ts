/** Defines the registry origin values used by `trustOf` (trust point 2). */
import { Schema } from "effect";

/** Where an entry was found, from the highest-priority root to the lowest. */
export const Origin = Schema.Literals(["project", "user", "index", "bundled"]);
export type Origin = typeof Origin.Type;
