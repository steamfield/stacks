import type { CountCell, RateCell, ShareCell, ValueCell } from "@steamfield/stacks-format";
import type { ListRow } from "../schemas/list";

/** The flat stats a `list` row carries; `show` renders its detail through the same shape. */
type StatsFields = NonNullable<ListRow["stats"]>;

/** The cells a summary item or a detail carries; a fragment's detail has no verify timings. */
type Metrics = {
  projects: CountCell;
  greenRate: RateCell;
  noVerifyShare?: ShareCell;
  medianMinutesToGreen?: ValueCell;
};

/** Flattens published cells, a suppressed one to `null`, under its response's window. */
export function statsFields(
  context: Pick<StatsFields, "window" | "through" | "population">,
  metrics: Metrics,
): StatsFields {
  return {
    ...context,
    projects: metrics.projects.value,
    greenRate: metrics.greenRate.value,
    greenRateLower: metrics.greenRate.lower,
    greenRateUpper: metrics.greenRate.upper,
    sample: metrics.greenRate.sample,
    noVerifyShare: metrics.noVerifyShare?.value ?? null,
    medianMinutesToGreen: metrics.medianMinutesToGreen?.value ?? null,
  };
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** The one `Stats:` line `list` and `show` print; seeded data says so beside its sample. */
export function statsLine(stats: StatsFields): string {
  const seeded = stats.population === "seeded development data";
  const green =
    stats.greenRate === null
      ? `green unavailable${seeded ? " (seeded)" : ""}`
      : `green ${percent(stats.greenRate)} (n=${stats.sample}${seeded ? ", seeded" : ""})`;
  const fields = [
    stats.projects === null ? "projects unavailable" : `${stats.projects} projects`,
    green,
    ...(stats.noVerifyShare === null ? [] : [`no verify ${percent(stats.noVerifyShare)}`]),
    ...(stats.medianMinutesToGreen === null
      ? []
      : [
          `median to green ${stats.medianMinutesToGreen.toLocaleString("en-US", { maximumFractionDigits: 1 })} min`,
        ]),
    `through ${stats.through}`,
  ];
  return `Stats: ${fields.join("; ")}`;
}
