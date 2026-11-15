/**
 * The shapes of what `stacks guide --json` and `stacks guide author --json` print.
 *
 * The guide is the short text that teaches a coding agent the loop (search, show, new, verify);
 * the author guide is the skill for writing a stack or fragment. The text itself lives in
 * `core/guide.ts`; these schemas only wrap it for `--json` callers.
 */
import { Schema } from "effect";
import { NoticeFields } from "./notice";

/** What `stacks --json` with no subcommand, and `stacks guide --json`, print. */
export const GuideResult = Schema.Struct({
  ...NoticeFields,
  /** The guide's text, as human mode prints it. */
  guide: Schema.String,
  /** The commands the guide's loop uses, each with a command line to run. */
  commands: Schema.Array(
    Schema.Struct({ name: Schema.String, run: Schema.String, purpose: Schema.String }),
  ),
}).annotate({ title: "Guide result", description: "The agent guide and the commands it uses" });
export type GuideResult = typeof GuideResult.Type;

/** What `stacks guide author [topic] --json` prints. */
export const GuideAuthorResult = Schema.Struct({
  ...NoticeFields,
  /** The topic printed; null for the authoring skill itself. */
  topic: Schema.NullOr(Schema.String),
  /** The text, with links to the skill's own files rewritten to guide author commands. */
  text: Schema.String,
  /** Every topic guide author takes. */
  topics: Schema.Array(Schema.String),
}).annotate({
  title: "Guide author result",
  description: "The authoring guide or one of its topics",
});
export type GuideAuthorResult = typeof GuideAuthorResult.Type;
