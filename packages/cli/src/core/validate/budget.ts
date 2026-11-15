/**
 * The word budgets that keep guidance short enough for a coding agent to read in one pass.
 *
 * Every entry (a stack or a fragment) carries a markdown body that ends up in the brief, the task
 * text `stacks new` writes to `.stacks/BRIEF.md`. This file holds the limits for one entry's body
 * and for a whole composed brief, and the one render context those briefs are counted in.
 * `validate`'s checks (`compositions.ts`, `compose-each.ts`, `add-compositions.ts`), the
 * `validate --brief` preview (`preview.ts`) and `stacks show` all read their numbers from here, so
 * a limit changes in one place.
 *
 * Counts must not depend on the machine running them: `canonicalContext` fixes everything a real
 * render would read from the user's environment (project name, git state, missing tools).
 */
import { projectFiles } from "../../project-layout";
import { VERSION } from "../../version";
import { renderBrief } from "../brief/render";
import type { Brief, BriefContext } from "../brief/types";
import type { Composition } from "../compose/types";
import type { Entry } from "../registry/entry";

/**
 * Size budgets in words. A composed brief counts the CLI's fixed text too, and `fixedWords` is
 * reported beside it so an author can see how much of the total is theirs to cut.
 */
export const BUDGET = {
  stackBody: 2_000,
  fragmentBody: 1_000,
  appBody: 3_000,
  composed: 6_000,
  composedWithApp: 9_000,
} as const;

/** The body limit for one entry: a stack, an app (a `category: app` fragment) or a fragment. */
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
