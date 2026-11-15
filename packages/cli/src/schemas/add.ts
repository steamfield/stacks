/**
 * The shape of what `stacks add --json` prints, so an agent can decode it and act on it.
 *
 * `add` applies fragments (reusable pieces such as CI or git hooks) to a project that already
 * exists. The result says which files were written, skipped because an identical copy was there,
 * or parked under `.stacks/incoming/` for the agent to merge (`mergeNeeded`), plus what changed in
 * the manifest (`.stacks/manifest.json`) and the handoff to the agent. The fields `add` shares
 * with `new` (`missingTools`, `untrusted`, `handoff`) are taken from `NewResult` so the two never
 * drift apart.
 *
 * `core/add.ts` builds it, `commands/handoff.ts` adds the handoff, and `stacks schema add` prints
 * it as JSON Schema.
 */
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
