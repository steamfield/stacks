/** The workspace part shape `new --json` and `show --json` both print. */
import { Schema } from "effect";

/**
 * One part of a workspace stack: the directory it is mounted in (`name`), its role and the id of
 * the stack that fills it.
 */
export const ResultPart = Schema.Struct({
  name: Schema.String,
  role: Schema.String,
  stack: Schema.String,
});
export type ResultPart = typeof ResultPart.Type;
