/**
 * Owns entry and composed-brief word budgets. `canonicalContext` keeps counts independent of the
 * machine running validation.
 */
import { projectFiles } from "../../../project-layout";
import { VERSION } from "../../../version";
import { renderBrief } from "../../brief/render";
import type { Brief, BriefContext } from "../../brief/types";
import type { Composition } from "../../compose/types";
import type { Entry } from "../../registry/entry";

/**
 * Word budgets keep guidance short enough for an agent to read in one pass. `fixedWords` shows
 * authors how much of the total is CLI text, so they can see how much they can cut.
 */
export const BUDGET = {
  stackBody: 2_000,
  fragmentBody: 1_000,
  appBody: 3_000,
  composed: 6_000,
  composedWithApp: 9_000,
} as const;

export function bodyLimit(entry: Entry): number {
  if (entry.meta.kind === "stack") return BUDGET.stackBody;
  return entry.meta.category === "app" ? BUDGET.appBody : BUDGET.fragmentBody;
}

/** The composed limit: higher when the composition holds an app. */
export const composedLimit = (composition: Composition<Entry | null>) =>
  composition.app ? BUDGET.composedWithApp : BUDGET.composed;

/**
 * The one render context every budgeted size uses, so a registry passes or fails the same way
 * on every machine: no missing tools, a fresh repository, the longest invocation an agent sees,
 * and the composition's own planned paths as the written list. `yes` follows the preset.
 */
export function canonicalContext(composition: Composition<Entry | null>): BriefContext {
  return {
    project: "project",
    git: { kind: "fresh" },
    written: projectFiles(composition.files),
    missing: [],
    toolsUnchecked: true,
    yes: composition.preset === "sandbox",
    invocation: `npx -y @steamfield/stacks@${VERSION}`,
  };
}

/**
 * The brief as budgeted. Untrusted entries are left out of the render: their stop-and-confirm
 * section is fixed text only some origins get, and it isn't the author's to cut.
 */
export function canonicalBrief(composition: Composition): Brief {
  return renderBrief({ ...composition, untrusted: [] }, canonicalContext(composition));
}
