/**
 * Turns published stats into the flat fields and the one `Stats:` line `list` and `show` print.
 *
 * `core/stats.ts` fetches stats as cells (a value plus its bounds, or a suppressed marker when too
 * few projects reported). `core/list.ts` flattens them with `statsFields` into the shape a
 * `list --json` row carries, and `core/show-report.ts` does the same for one entry's detail;
 * `core/list-report.ts` and `core/show-report.ts` print `statsLine`. A suppressed cell becomes `null` and prints as
 * "unavailable" or is left out. Seeded development data says so next to its sample size.
 */
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

function greenField(stats: StatsFields, seeded: boolean): string {
  if (stats.greenRate === null) return `green unavailable${seeded ? " (seeded)" : ""}`;
  return `green ${percent(stats.greenRate)} (n=${stats.sample}${seeded ? ", seeded" : ""})`;
}

function medianField(minutes: number): string {
  return `median to green ${minutes.toLocaleString("en-US", { maximumFractionDigits: 1 })} min`;
}

/** The one `Stats:` line `list` and `show` print; seeded data says so beside its sample. */
export function statsLine(stats: StatsFields): string {
  const seeded = stats.population === "seeded development data";
  const fields = [
    stats.projects === null ? "projects unavailable" : `${stats.projects} projects`,
    greenField(stats, seeded),
    ...(stats.noVerifyShare === null ? [] : [`no verify ${percent(stats.noVerifyShare)}`]),
    ...(stats.medianMinutesToGreen === null ? [] : [medianField(stats.medianMinutesToGreen)]),
    `through ${stats.through}`,
  ];
  return `Stats: ${fields.join("; ")}`;
}
