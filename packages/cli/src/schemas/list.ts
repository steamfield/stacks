/** Defines the `list --json` catalog and the row contract shared by `ShowReport`. */
import { Category, GitHubLogin, Kind, StatsDay, StatsWindow } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { LedgerLastRun } from "./ledger";
import { NoticeFields } from "./notice";
import { Origin } from "./origin";

/**
 * One entry in `list`: what it is, where it was found (`origin`, and the lower-priority copies it
 * `shadows`), whether that origin is trusted, and its evidence (`lastRun` from the bundled ledger,
 * `stats` from the hosted API). `show` reuses these fields as the top of its report.
 */
export const ListRow = Schema.Struct({
  id: Schema.String,
  kind: Kind,
  name: Schema.String,
  description: Schema.String,
  tags: Schema.Array(Schema.String),
  /** Fragments only; "app" for an app. */
  category: Schema.optionalKey(Category),
  /** Fragments only. */
  appliesTo: Schema.optionalKey(Schema.Array(Schema.String)),
  origin: Origin,
  trusted: Schema.Boolean,
  shadows: Schema.Array(Origin),
  /** The creator's GitHub login, for bundled and index entries submitted by one. */
  author: Schema.optionalKey(GitHubLogin),
  /** Latest bundled default-composition run, over every preset and agent. */
  lastRun: Schema.NullOr(LedgerLastRun),
  stats: Schema.optionalKey(
    Schema.Struct({
      window: StatsWindow,
      through: StatsDay,
      population: Schema.Literals(["stacks projects", "seeded development data"]),
      projects: Schema.NullOr(Schema.Number),
      greenRate: Schema.NullOr(Schema.Number),
      greenRateLower: Schema.NullOr(Schema.Number),
      greenRateUpper: Schema.NullOr(Schema.Number),
      sample: Schema.NullOr(Schema.Number),
      noVerifyShare: Schema.NullOr(Schema.Number),
      medianMinutesToGreen: Schema.NullOr(Schema.Number),
    }),
  ),
});
export type ListRow = typeof ListRow.Type;

/** `list --json`. `project` is present when a project manifest was found from the directory. */
export const ListResult = Schema.Struct({
  ...NoticeFields,
  project: Schema.optionalKey(
    Schema.Struct({
      stack: Schema.NullOr(Schema.String),
      applied: Schema.Array(Schema.String),
      addable: Schema.Array(Schema.String),
    }),
  ),
  /** Stacks first, then fragments; each group sorted by id. */
  entries: Schema.Array(ListRow),
  /** Entries that failed to load; an agent iterating `entries` never meets one. */
  rejected: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Kind,
      origin: Origin,
      dir: Schema.String,
      error: Schema.String,
    }),
  ),
}).annotate({
  title: "List result",
  description: "Stacks and fragments an agent can choose from, and entries that failed to load",
});
export type ListResult = typeof ListResult.Type;
