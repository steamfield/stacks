/**
 * Renders a search result as the text `stacks search` prints for the human and agent audiences.
 *
 * `commands/search.ts` calls `renderSearch` with the merged result from `run.ts::search`; `--json`
 * prints the result itself instead. The text has three parts: notices (why ranking was local,
 * whether anything fit), one block per hit with the reasons it matched and its evidence, and the
 * `Next:` lines that tell an agent what to run. Every value that came from an entry or the API
 * passes through `text.ts::printable`, so a hit can't send terminal control characters.
 *
 * The `Next:` advice names only a trusted entry, because using an untrusted one needs a person to
 * accept it (`.claude/rules/architecture.md`, "Trust model", point 3), and asks the agent to
 * confirm with the user when nothing matched strongly.
 */
import type { SearchHit, SearchResult } from "@steamfield/stacks-format";
import { printable } from "../text";
import { wrap } from "../wrap";

const localReasons = {
  offline: "offline",
  do_not_track: "DO_NOT_TRACK",
  backoff: "API backoff",
  no_endpoint: "no API endpoint configured",
};

/**
 * Each matched phrase with the fields it matched in, in first-seen order. Body matches are left
 * out when any other field matched, since they add little beside a name or tag match.
 */
function reasons(hit: SearchHit): string {
  const phrases = new Map<string, string[]>();
  const hasOtherField = hit.why.some((reason) => reason.field !== "body");
  for (const reason of hit.why.filter((reason) => !hasOtherField || reason.field !== "body")) {
    const fields = phrases.get(reason.matched) ?? [];
    fields.push(reason.field);
    phrases.set(reason.matched, fields);
  }
  return [...phrases]
    .map(([phrase, fields]) => `${printable(phrase)} (${fields.map(printable).join(", ")})`)
    .join("; ");
}

/** The stats and last-run evidence on one line, or empty when the hit has neither. */
function evidenceText(hit: SearchHit, statsPopulation: SearchResult["statsPopulation"]): string {
  const { stats, lastRun } = hit.evidence;
  const seeded = statsPopulation === "seeded development data" ? ", seeded" : "";
  return [
    stats
      ? `green lower ${stats.greenRateLower}, sample ${stats.sample}${seeded}, ${stats.projects} projects / ${stats.window} days`
      : "",
    lastRun ? `last run ${lastRun.date}: ${lastRun.result}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function penaltiesLine(hit: SearchHit): string {
  const penalties = hit.penalties.map((penalty) => {
    const request = penalty.request ? `${printable(penalty.request)}; ` : "";
    return `${penalty.kind} (${request}entry: ${printable(penalty.entry)})`;
  });
  return `Penalties: ${penalties.join(", ")}`;
}

/** The first line of a hit: kind, id, the display name for humans, its tier and trust. */
function headline(hit: SearchHit, human: boolean): string {
  const name = human ? ` · ${printable(hit.name)}` : "";
  const trust = hit.trusted ? "" : ", untrusted";
  return `${hit.kind} ${hit.id}${name} (${hit.tier}${trust})`;
}

function hitBlock(
  hit: SearchHit,
  human: boolean,
  statsPopulation: SearchResult["statsPopulation"],
): string {
  const evidence = evidenceText(hit, statsPopulation);
  return [
    headline(hit, human),
    printable(hit.summary),
    ...(hit.why.length ? [`Why: ${reasons(hit)}`] : []),
    ...(hit.kind === "fragment" && hit.appliesTo?.length
      ? [`Applies to: ${hit.appliesTo.map(printable).join(", ")}`]
      : []),
    ...(hit.penalties.length ? [penaltiesLine(hit)] : []),
    ...(hit.caveats ?? []).map((caveat) => `Caveat: ${printable(caveat)}`),
    ...(evidence ? [`Evidence: ${printable(evidence)}`] : []),
  ].join("\n");
}

const TIER_ORDER = { strong: 0, partial: 1, weak: 2 } as const;

/** The trusted fragment to add first: no stack is strong and the fragment fits at least as well. */
function fragmentFirst(result: SearchResult): SearchResult["fragments"][number] | undefined {
  const fragment = result.fragments.find((hit) => hit.trusted);
  if (!fragment || result.stacks.some((hit) => hit.tier === "strong")) return undefined;
  if (fragment.tier === "strong") return fragment;
  const top = result.stacks[0];
  if (!top) return fragment.tier === "partial" ? fragment : undefined;
  return top.penalties.length > 0 && TIER_ORDER[fragment.tier] <= TIER_ORDER[top.tier]
    ? fragment
    : undefined;
}

/** The `Next:` lines: add a fragment, start from a stack, ask the user, or search again. */
function next(result: SearchResult, invocation: string): string {
  const recovery = [
    `Next: ${invocation} list stacks`,
    `Next: ${invocation} search "<fewer, broader words>"`,
  ];
  if (!result.stacks.length && !result.fragments.length) return recovery.join("\n");
  const fragment = fragmentFirst(result);
  const confirmation = result.noStrongMatch
    ? "confirm with the user before using a weak match; then "
    : "";
  if (fragment)
    return `Next: ${confirmation}${invocation} show ${fragment.id}, then ${invocation} add ${fragment.id}.`;
  const trusted = result.stacks.find((hit) => hit.trusted);
  return [
    trusted
      ? `Next: ${confirmation}${invocation} show ${trusted.id}, then ${invocation} new ${trusted.id} <dir>.`
      : "Next: ask the user before using any of these matches.",
    ...(result.noStrongMatch ? recovery : []),
  ].join("\n");
}

/** The paragraphs before the hits, each followed by a blank line. */
function notices(result: SearchResult, empty: boolean): string[] {
  const reason = result.remoteReason;
  return [
    ...(result.remote === "unavailable" ? ["Ranked locally: API unavailable.", ""] : []),
    ...(result.remote === "off" && reason && reason !== "local_flag"
      ? [`Ranked locally: ${localReasons[reason]}.`, ""]
      : []),
    ...(empty ? ["Nothing matched.", ""] : []),
    ...(!empty && result.noStrongMatch
      ? ["Nothing fits strongly. Confirm the fit with the user.", ""]
      : []),
    ...(result.understood.unmatched.length
      ? [`Unmatched: ${result.understood.unmatched.map(printable).join(", ")}`, ""]
      : []),
  ];
}

/** The search report, wrapped to `width` as `measure` counts display columns. */
export function renderSearch(
  result: SearchResult,
  options: { invocation: string; human: boolean; width: number; measure: (text: string) => number },
): string {
  const empty = !result.stacks.length && !result.fragments.length;
  const hits = [...result.stacks, ...result.fragments]
    .map((hit) => hitBlock(hit, options.human, result.statsPopulation))
    .join("\n\n");
  const text = [
    ...notices(result, empty),
    ...(empty ? [] : [hits, ""]),
    next(result, options.invocation),
  ].join("\n");
  return wrap(text, options.width, options.measure);
}
