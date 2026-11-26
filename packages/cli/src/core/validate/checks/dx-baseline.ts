/**
 * Bundled-registry policy: each stack's default composition carries the developer-experience
 * baseline the authoring guide's "Developer experience" section lists (B1 to B5 are checked here).
 */
import { Effect } from "effect";
import type { Finding } from "../../../schemas/validate";
import type { Composition } from "../../compose/types";
import { isStack, type Stack } from "../../registry/entry";
import type { Check, Composed, View } from "../types";
import { entryFile, finding } from "../view";

/** Every bundled stack meets the baseline, so a regression warns (and fails the registry test). */
export const DX_SEVERITY: Finding["severity"] = "warning";

const BASELINE_FRAGMENTS = ["agent-ops", "git-hooks", "ci-github"] as const;

type Gap = Pick<Finding, "check" | "message">;

export const dxBaselineChecks: Check = Effect.fn("validate.dxBaseline")(function* (view) {
  if (!view.asBundled || view.composition) return { findings: [] };
  const pending = new Map(view.entries.filter(isStack).map((stack) => [stack.dir, stack]));
  if (pending.size === 0) return { findings: [] };
  const { snapshots } = yield* view.composed;
  return { findings: baselineFindings(view, pending, snapshots) };
});

function baselineFindings(
  view: View,
  pending: Map<string, Stack>,
  snapshots: ReadonlyArray<Composed>,
): Finding[] {
  const findings: Finding[] = [];
  for (const { composition } of snapshots) {
    const stack = pending.get(composition.stack.dir);
    if (!stack || !isBaseComposition(stack, composition)) continue;
    findings.push(...stackFindings(view, stack, composition));
    // Equivalent plans and adapters can render the same DX inputs.
    pending.delete(stack.dir);
    if (pending.size === 0) break;
  }
  return findings;
}

function isBaseComposition(stack: Stack, composition: Composition): boolean {
  if (composition.preset !== "default") return false;
  // With all defaults present, reselecting a required fragment leaves the base DX inputs intact.
  return (
    !composition.selection.some(({ via }) => via === "with") &&
    stack.meta.fragments.default.every((id) =>
      composition.selection.some((selected) => selected.id === id),
    )
  );
}

function stackFindings(view: View, stack: Stack, composition: Composition): Finding[] {
  const gaps = commandGaps(stack, composition.commands);
  for (const id of BASELINE_FRAGMENTS) {
    if (composition.fragments.some((fragment) => fragment.id === id)) continue;
    gaps.push({
      check: "dx-fragments",
      message: `${id} is not in the default composition; add it to fragments.default`,
    });
  }
  const file = entryFile(view, stack);
  return gaps.map((gap) => finding(stack, { ...gap, severity: DX_SEVERITY, file }));
}

function commandGaps(stack: Stack, commands: Composition["commands"]): Gap[] {
  const { tags, parts } = stack.meta;
  const usesMake = tags.includes("make");
  if (parts || (!usesMake && !tags.includes("scripts"))) return [];

  const gaps: Gap[] = [];
  const aggregate = usesMake ? "ci" : "check";
  if (!Object.hasOwn(commands, aggregate))
    gaps.push({
      check: "dx-aggregate",
      message: `declares no ${aggregate} command; add one that runs everything CI runs`,
    });
  if (!Object.hasOwn(commands, "format") && !Object.hasOwn(commands, "lint-fix"))
    gaps.push({
      check: "dx-format",
      message:
        "declares no format or lint-fix command; add format to run the formatter and the linter's safe fixes, or add a separate lint-fix command",
    });
  if (!Object.hasOwn(commands, "audit") && !Object.hasOwn(commands, "vuln"))
    gaps.push({
      check: "dx-audit",
      message:
        "declares no audit or vuln command; add one that checks dependencies without an account or API key",
    });
  const background = backgroundGap(stack, commands, usesMake);
  if (background) gaps.push(background);
  return gaps;
}

function backgroundGap(stack: Stack, commands: Composition["commands"], usesMake: boolean) {
  if (!usesMake) return undefined;
  const { tags, verify } = stack.meta;
  if (!(tags.includes("web") || tags.includes("api"))) return undefined;
  if (!verify.some(({ phase }) => phase === "serve")) return undefined;

  const missing = [
    {
      name: "dev-bg",
      fix: "a background start that logs to logs/dev.log",
    },
    {
      name: "dev-stop",
      fix: "a stop that signals only its process group",
    },
    {
      name: "dev-status",
      fix: "a status command that exits 0 while the recorded server runs",
    },
  ].filter(({ name }) => !Object.hasOwn(commands, name));
  if (missing.length === 0) return undefined;
  return {
    check: "dx-background",
    message: `has a serve step but no ${missing.map(({ name }) => name).join(" or ")} command; add ${missing.map(({ fix }) => fix).join(" and ")}`,
  };
}
