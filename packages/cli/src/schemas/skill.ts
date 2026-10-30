import { Schema } from "effect";
import { NoticeFields } from "./notice";

/** The bundled skills, each a directory under the skills root. */
export const SkillName = Schema.Literals(["stacks", "stacks-author"]);
export type SkillName = typeof SkillName.Type;

const SkillAction = Schema.Literals(["written", "unchanged", "printed"]);

export const SkillResult = Schema.Struct({
  ...NoticeFields,
  name: SkillName,
  /** The installed SKILL.md; null for --print. */
  path: Schema.NullOr(Schema.String),
  /** written when any file was written, unchanged when every file already matched. */
  action: SkillAction,
  /** Each file of the skill, relative to its directory with `/` separators, sorted. */
  files: Schema.Array(Schema.Struct({ path: Schema.String, action: SkillAction })),
  text: Schema.optionalKey(Schema.String),
});
export type SkillResult = typeof SkillResult.Type;
