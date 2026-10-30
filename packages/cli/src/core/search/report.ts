import type { SearchHit, SearchResult } from "@steamfield/stacks-format";
import { printable } from "../text";
import { wrap } from "../wrap";

const localReasons = {
  offline: "offline",
  do_not_track: "DO_NOT_TRACK",
  backoff: "API backoff",
  no_endpoint: "no API endpoint configured",
};

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
function hitBlock(
  hit: SearchHit,
  human: boolean,
  statsPopulation: SearchResult["statsPopulation"],
): string {
  const stats = hit.evidence.stats;
  const lastRun = hit.evidence.lastRun;
  const evidence = [
    stats
      ? `green lower ${stats.greenRateLower}, sample ${stats.sample}${statsPopulation === "seeded development data" ? ", seeded" : ""}, ${stats.projects} projects / ${stats.window} days`
      : "",
    lastRun ? `last run ${lastRun.date}: ${lastRun.result}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  return [
    `${hit.kind} ${hit.id}${human ? ` · ${printable(hit.name)}` : ""} (${hit.tier}${hit.trusted ? "" : ", untrusted"})`,
    printable(hit.summary),
    ...(hit.why.length ? [`Why: ${reasons(hit)}`] : []),
    ...(hit.kind === "fragment" && hit.appliesTo?.length
      ? [`Applies to: ${hit.appliesTo.map(printable).join(", ")}`]
      : []),
    ...(hit.penalties.length
      ? [
          `Penalties: ${hit.penalties
            .map(
              (penalty) =>
                `${penalty.kind} (${penalty.request ? `${printable(penalty.request)}; ` : ""}entry: ${printable(penalty.entry)})`,
            )
            .join(", ")}`,
        ]
      : []),
    ...(hit.caveats ?? []).map((caveat) => `Caveat: ${printable(caveat)}`),
    ...(evidence ? [`Evidence: ${printable(evidence)}`] : []),
  ].join("\n");
}
function next(result: SearchResult, invocation: string): string {
  const recovery = [
    `Next: ${invocation} list stacks`,
    `Next: ${invocation} search "<fewer, broader words>"`,
  ];
  if (!result.stacks.length && !result.fragments.length) return recovery.join("\n");
  const fragment = result.fragments.find((hit) => hit.trusted && hit.tier === "strong");
  if (fragment && !result.stacks.some((hit) => hit.tier === "strong"))
    return `Next: ${invocation} show ${fragment.id}, then ${invocation} add ${fragment.id}.`;
  const trusted = result.stacks.find((hit) => hit.trusted);
  const confirmation = result.noStrongMatch
    ? "confirm with the user before using a weak match; then "
    : "";
  return [
    trusted
      ? `Next: ${confirmation}${invocation} show ${trusted.id}, then ${invocation} new ${trusted.id} <dir>.`
      : "Next: ask the user before using any of these matches.",
    ...(result.noStrongMatch ? recovery : []),
  ].join("\n");
}
export function renderSearch(
  result: SearchResult,
  options: { invocation: string; human: boolean; width: number; measure: (text: string) => number },
): string {
  const empty = !result.stacks.length && !result.fragments.length;
  const text = [
    ...(result.remote === "unavailable" ? ["Ranked locally: API unavailable.", ""] : []),
    ...(result.remote === "off" && result.remoteReason && result.remoteReason !== "local_flag"
      ? [`Ranked locally: ${localReasons[result.remoteReason]}.`, ""]
      : []),
    ...(empty ? ["Nothing matched.", ""] : []),
    ...(!empty && result.noStrongMatch
      ? ["Nothing fits strongly. Confirm the fit with the user.", ""]
      : []),
    ...(result.understood.unmatched.length
      ? [`Unmatched: ${result.understood.unmatched.map(printable).join(", ")}`, ""]
      : []),
    ...(empty
      ? []
      : [
          [...result.stacks, ...result.fragments]
            .map((hit) => hitBlock(hit, options.human, result.statsPopulation))
            .join("\n\n"),
          "",
        ]),
    next(result, options.invocation),
  ].join("\n");
  return wrap(text, options.width, options.measure);
}
