import { TamperCheck } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { BRIEF_PATH } from "../project-layout";
import { NewResult } from "./new";
import { NoticeFields } from "./notice";

/** The files and manifest changes made by `add`, and the agent's next task. */
export const AddResult = Schema.Struct({
  ...NoticeFields,
  project: Schema.String,
  stack: Schema.NullOr(Schema.String),
  added: Schema.Array(Schema.String),
  alreadyApplied: Schema.Array(Schema.String),
  written: Schema.Array(Schema.String),
  skipped: Schema.Array(Schema.String),
  mergeNeeded: Schema.Array(
    Schema.Struct({ path: Schema.String, incoming: Schema.Array(Schema.String) }),
  ),
  missingRequired: Schema.Array(Schema.Struct({ id: Schema.String, command: Schema.String })),
  commandsKept: Schema.Array(Schema.String),
  warnings: Schema.Array(Schema.Struct({ code: Schema.String, id: Schema.String })),
  missingTools: NewResult.fields.missingTools,
  name: Schema.Struct({ value: Schema.String, source: Schema.String }),
  createdManifest: Schema.Boolean,
  tamperCheck: Schema.NullOr(TamperCheck),
  stateRecord: Schema.Boolean,
  digestRecorded: Schema.Boolean,
  brief: Schema.Literal(BRIEF_PATH),
  briefWords: Schema.Number,
  inferredTags: Schema.optionalKey(Schema.Array(Schema.String)),
  untrusted: NewResult.fields.untrusted,
  handoff: NewResult.fields.handoff,
});
export type AddResult = typeof AddResult.Type;
