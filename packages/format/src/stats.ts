import { Schema } from "effect";
import { DetectedAgent } from "./agent.js";
import { Ecosystem } from "./allowlist.js";
import { Columnar } from "./columnar.js";
import { Kebab, Kind } from "./entry.js";
import { Digest, LastRun } from "./index-schema.js";

const NonNegative = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Share = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }));

export const StatsDay = Schema.String.check(
  Schema.isPattern(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/),
  Schema.makeFilter(
    (day) => new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day || "invalid UTC day",
  ),
);
export type StatsDay = typeof StatsDay.Type;
export const StatsWindow = Schema.Literals([7, 28]);
export type StatsWindow = typeof StatsWindow.Type;

/** Suppression never carries the underlying value. */
const Suppressed = Schema.Struct({ value: Schema.Null, suppressed: Schema.Literal(true) });

export const CountCell = Schema.Union([
  Schema.Struct({ value: Count, suppressed: Schema.Literal(false) }),
  Suppressed,
]);
export type CountCell = typeof CountCell.Type;

/** Timings and medians need not be integer counts. */
export const ValueCell = Schema.Union([
  Schema.Struct({ value: NonNegative, suppressed: Schema.Literal(false) }),
  Suppressed,
]);
export type ValueCell = typeof ValueCell.Type;

/** A share without a Wilson interval, such as the no-verify share. */
export const ShareCell = Schema.Union([
  Schema.Struct({ value: Share, suppressed: Schema.Literal(false) }),
  Suppressed,
]);
export type ShareCell = typeof ShareCell.Type;

export const RateCell = Schema.Union([
  Schema.Struct({
    value: Share,
    lower: Share,
    upper: Share,
    sample: Count,
    suppressed: Schema.Literal(false),
  }).check(
    Schema.makeFilter(
      (cell) => (cell.lower <= cell.value && cell.value <= cell.upper) || "invalid rate interval",
    ),
  ),
  Schema.Struct({
    value: Schema.Null,
    lower: Schema.Null,
    upper: Schema.Null,
    sample: Schema.Null,
    suppressed: Schema.Literal(true),
  }),
]);
export type RateCell = typeof RateCell.Type;

export const StatsChange = Schema.Struct({ day: StatsDay, digest: Digest });
export type StatsChange = typeof StatsChange.Type;

/** Projects and green rate for the requested window ending on this stride day. */
export const SeriesPoint = Schema.Struct({
  day: StatsDay,
  projects: CountCell,
  greenRate: RateCell,
  changes: Schema.Array(StatsChange),
});
export type SeriesPoint = typeof SeriesPoint.Type;

/** Preset and per-stack fragment series always describe 7-day project counts. */
export const ProjectsPoint = Schema.Struct({ day: StatsDay, projects: CountCell });
export type ProjectsPoint = typeof ProjectsPoint.Type;

export const Trending = Schema.Union([
  Schema.Struct({
    value: Schema.Boolean,
    score: NonNegative,
    suppressed: Schema.Literal(false),
    last7: Schema.Struct({ value: Count, suppressed: Schema.Literal(false) }),
    prior28: Schema.Struct({ value: Count, suppressed: Schema.Literal(false) }),
  }),
  Schema.Struct({
    ...Suppressed.fields,
    score: Schema.optionalKey(Schema.Never),
    last7: Schema.optionalKey(Schema.Never),
    prior28: Schema.optionalKey(Schema.Never),
  }),
]);
export type Trending = typeof Trending.Type;

/** The route example uses plain published shares; suppressed categories are omitted. */
export const EntryPoints = Schema.Struct({
  handoff: Schema.Record(Schema.String, Share),
  source: Schema.Record(Schema.String, Share),
});
export type EntryPoints = typeof EntryPoints.Type;

const Identity = Schema.Struct({
  id: Kebab,
  kind: Kind,
  lastRun: Schema.optionalKey(LastRun),
});
const Metrics = Schema.Struct({ projects: CountCell, greenRate: RateCell });
const SummaryMetrics = Schema.Struct({
  ...Metrics.fields,
  noVerifyShare: ShareCell,
  medianMinutesToGreen: ValueCell,
  previous: Metrics,
  trending: Schema.optionalKey(Trending),
});
export const StatsSummaryItem = Schema.Struct({ ...Identity.fields, ...SummaryMetrics.fields });
export type StatsSummaryItem = typeof StatsSummaryItem.Type;

export const StatsPopulation = Schema.Literals(["stacks projects", "seeded development data"]);
export type StatsPopulation = typeof StatsPopulation.Type;

const Header = Schema.Struct({
  generatedAt: Schema.String,
  through: StatsDay,
  population: StatsPopulation,
  window: StatsWindow,
});

/** Provisional until 4.2a: before the publishing gate opens only ledger rows are returned. */
export const StatsSummary = Schema.Union([
  Schema.Struct({
    ...Header.fields,
    published: Schema.Literal(true),
    entryPoints: EntryPoints,
    items: Columnar(StatsSummaryItem),
    nextCursor: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    ...Header.fields,
    published: Schema.Literal(false),
    items: Columnar(Identity),
    nextCursor: Schema.optionalKey(Schema.String),
  }),
]);
export type StatsSummary = typeof StatsSummary.Type;

export const StatsBreakdown = Schema.Struct({
  ...Metrics.fields,
  medianMinutesToGreen: ValueCell,
});
export type StatsBreakdown = typeof StatsBreakdown.Type;

export const CompositionStats = Schema.Struct({
  fingerprint: Digest,
  with: Schema.Array(Kebab),
  without: Schema.Array(Kebab),
  greenRate: RateCell,
  firstSeen: StatsDay,
  lastSeen: StatsDay,
  changes: Schema.Array(StatsChange),
});
export type CompositionStats = typeof CompositionStats.Type;

const WithWithout = Schema.Struct({ with: RateCell, without: RateCell }).check(
  Schema.makeFilter(
    (pair) =>
      pair.with.suppressed === pair.without.suppressed ||
      "both comparison cells must publish together",
  ),
);
const FragmentStackFields = Schema.Struct({
  stack: Kebab,
  projects: CountCell,
  withWithout: WithWithout,
});
export const FragmentStackStats = Schema.Union([
  Schema.Struct({
    ...FragmentStackFields.fields,
    default: Schema.Literal(true),
    keptRate: ShareCell,
    attachRate: Schema.optionalKey(Schema.Never),
  }),
  Schema.Struct({
    ...FragmentStackFields.fields,
    default: Schema.Literal(false),
    attachRate: ShareCell,
    keptRate: Schema.optionalKey(Schema.Never),
  }),
]);
export type FragmentStackStats = typeof FragmentStackStats.Type;

export const OftenUsedWith = Schema.Struct({
  id: Kebab,
  stack: Kebab,
  lift: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(1)),
});
export type OftenUsedWith = typeof OftenUsedWith.Type;

const DetailSelection = Schema.Struct({ interval: StatsWindow, from: StatsDay, to: StatsDay });
const DetailFields = Schema.Struct({
  ...Header.fields,
  ...Identity.fields,
  ...DetailSelection.fields,
});
const DetailMetrics = Schema.Struct({
  ...Metrics.fields,
  windows: Schema.Struct({ "7": Metrics, "28": Metrics }),
});

export const MajorShare = Schema.Struct({ major: Schema.String, share: ShareCell });
export type MajorShare = typeof MajorShare.Type;

export const StackDependency = Schema.Struct({
  ecosystem: Ecosystem,
  name: Schema.String,
  projects: CountCell,
  share: ShareCell,
  majors: Schema.Array(MajorShare),
  withWithout: WithWithout,
});
export type StackDependency = typeof StackDependency.Type;

export const StackStatsDetail = Schema.Struct({
  ...DetailFields.fields,
  kind: Schema.Literal("stack"),
  published: Schema.Literal(true),
  ...SummaryMetrics.fields,
  ...DetailMetrics.fields,
  series: Columnar(SeriesPoint),
  p75MinutesToGreen: ValueCell,
  medianMinutesToFirstTestPass: ValueCell,
  medianVerifyRunsToGreen: ValueCell,
  stepFailureShares: Schema.Record(Schema.String, ShareCell),
  envBlockedShare: ShareCell,
  withoutRates: Columnar(Schema.Struct({ id: Kebab, rate: ShareCell })),
  attachRates: Columnar(Schema.Struct({ id: Kebab, rate: ShareCell })),
  byAgent: Columnar(Schema.Struct({ agent: DetectedAgent, ...StatsBreakdown.fields })),
  byPreset: Columnar(Schema.Struct({ preset: Kebab, ...StatsBreakdown.fields })),
  byComposition: Columnar(CompositionStats),
  seriesByPreset: Columnar(Schema.Struct({ preset: Kebab, series: Columnar(ProjectsPoint) })),
  entryPoints: EntryPoints,
  deps: Schema.optionalKey(Columnar(StackDependency)),
  pickRate: ShareCell,
  scaffoldFailureShares: Schema.Record(Schema.String, ShareCell),
  global: Schema.Struct({
    scaffoldFailureShares: Schema.Record(Schema.String, ShareCell),
    entryPoints: EntryPoints,
  }),
});
export type StackStatsDetail = typeof StackStatsDetail.Type;

export const FragmentStatsDetail = Schema.Struct({
  ...DetailFields.fields,
  kind: Schema.Literal("fragment"),
  published: Schema.Literal(true),
  ...DetailMetrics.fields,
  series: Columnar(ProjectsPoint),
  byStack: Columnar(FragmentStackStats),
  seriesByStack: Columnar(Schema.Struct({ stack: Kebab, series: Columnar(ProjectsPoint) })),
  oftenUsedWith: Schema.optionalKey(Columnar(OftenUsedWith)),
});
export type FragmentStatsDetail = typeof FragmentStatsDetail.Type;

/** Stack and fragment payloads share one route decoder and discriminate on kind. */
export const StatsDetail = Schema.Union([
  StackStatsDetail,
  FragmentStatsDetail,
  Schema.Struct({ ...DetailFields.fields, published: Schema.Literal(false) }),
]);
export type StatsDetail = typeof StatsDetail.Type;

const Transition = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  projects: CountCell,
});

export const DependencySummary = Schema.Struct({
  name: Schema.String,
  projects: CountCell,
  majors: Schema.Array(MajorShare),
});
export type DependencySummary = typeof DependencySummary.Type;

const DependencyHeader = Schema.Struct({
  ...Header.fields,
  window: Schema.Literal(28),
  ecosystem: Ecosystem,
});
const DependencySelection = Schema.Struct({
  ...DependencyHeader.fields,
  name: Schema.String,
  interval: StatsWindow,
  from: StatsDay,
  to: StatsDay,
});
const DependencyMetrics = Schema.Struct({
  projects: CountCell,
  adoptions: CountCell,
  drops: CountCell,
  majors: Columnar(MajorShare),
  series: Columnar(Schema.Struct({ day: StatsDay, majors: Schema.Array(MajorShare) })),
  transitions: Columnar(Transition),
  oftenUsedWith: Columnar(
    Schema.Struct({
      ecosystem: Ecosystem,
      name: Schema.String,
      lift: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(1)),
    }),
  ),
  byStack: Columnar(
    Schema.Struct({
      stack: Kebab,
      projects: CountCell,
      share: ShareCell,
      majors: Schema.Array(MajorShare),
      withWithout: WithWithout,
    }),
  ),
});
export const StatsDep = Schema.Union([
  Schema.Struct({
    ...DependencySelection.fields,
    published: Schema.Literal(true),
    ...DependencyMetrics.fields,
  }),
  Schema.Struct({
    ...DependencySelection.fields,
    published: Schema.Literal(false),
    projects: Schema.optionalKey(Schema.Never),
    adoptions: Schema.optionalKey(Schema.Never),
    drops: Schema.optionalKey(Schema.Never),
    majors: Schema.optionalKey(Schema.Never),
    series: Schema.optionalKey(Schema.Never),
    transitions: Schema.optionalKey(Schema.Never),
    oftenUsedWith: Schema.optionalKey(Schema.Never),
    byStack: Schema.optionalKey(Schema.Never),
  }),
]);
export type StatsDep = typeof StatsDep.Type;

export const StatsDeps = Schema.Union([
  Schema.Struct({
    ...DependencyHeader.fields,
    published: Schema.Literal(true),
    projects: CountCell,
    items: Columnar(DependencySummary),
    transitions: Columnar(Schema.Struct({ name: Schema.String, ...Transition.fields })),
  }),
  Schema.Struct({
    ...DependencyHeader.fields,
    published: Schema.Literal(false),
    projects: Schema.optionalKey(Schema.Never),
    items: Schema.optionalKey(Schema.Never),
    transitions: Schema.optionalKey(Schema.Never),
  }),
]);
export type StatsDeps = typeof StatsDeps.Type;
