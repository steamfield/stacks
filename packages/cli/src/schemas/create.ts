/**
 * The shape of what `stacks create --json` prints: where the new personal stack or fragment was
 * written in the user registry, and the authoring guide to read next. `core/create.ts` builds it.
 */
import { Kind } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { NoticeFields } from "./notice";

/** The entry written in the user registry, and its companion guide; both paths are absolute. */
export const CreateResult = Schema.Struct({
  ...NoticeFields,
  kind: Kind,
  id: Schema.String,
  path: Schema.String,
  guide: Schema.String,
});
export type CreateResult = typeof CreateResult.Type;
