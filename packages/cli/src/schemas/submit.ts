import { Kind } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { NoticeFields } from "./notice";
import { Finding } from "./validate";

export const SubmitResult = Schema.Struct({
  ...NoticeFields,
  /** The upstream repository, `owner/name`. */
  repo: Schema.String,
  /** In the order given. `update` is true when the upstream registry already has the entry. */
  entries: Schema.Array(Schema.Struct({ kind: Kind, id: Schema.String, update: Schema.Boolean })),
  /** The GitHub login `gh` is logged in as, recorded in `authors.json`. */
  author: Schema.String,
  /** `entry/<kind>-<id>`, named after the first entry. */
  branch: Schema.String,
  /** The draft pull request; null for `--dry-run`. */
  prUrl: Schema.NullOr(Schema.String),
  /** True when an open pull request for the branch already existed and the push updated it. */
  reused: Schema.Boolean,
  dryRun: Schema.Boolean,
  /** The submitted entries' findings, checked against the upstream registry. */
  findings: Schema.Array(Finding),
  /** Repository paths the pull request adds or changes, sorted. */
  files: Schema.Array(Schema.String),
  /** `--dry-run` only: the pull request body that would be sent. */
  body: Schema.optionalKey(Schema.String),
}).annotate({
  title: "Submit result",
  description: "The entries submitted to the public registry and the draft pull request",
});
export type SubmitResult = typeof SubmitResult.Type;
