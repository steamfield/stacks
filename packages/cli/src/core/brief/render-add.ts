/**
 * Renders the add brief with new guidance and matching recipe notes, avoiding repetition of work
 * already present in the project.
 * The definition of done covers the whole manifest because verify runs the project as a whole.
 */
import { APP_TAG, withStepDefaults } from "@steamfield/stacks-format";
import type { ComposedStep, Composition } from "../compose/types";
import type { Entry } from "../registry/entry";
import {
  dependencyLines,
  oneLine,
  runOrder,
  toolLines,
  writeCommandTable,
  writeDecisions,
  writeEnvironment,
  writeStepTable,
  writeUntrustedList,
} from "./blocks";
import { nest } from "./headings";
import * as T from "./text";
import type { AddBriefContext, Brief, BriefContext } from "./types";
import { type BriefWriter, briefWriter } from "./writer";

export function renderAddBrief(
  composition: Composition<Entry | null>,
  context: BriefContext,
  add: AddBriefContext,
): Brief {
  const out = briefWriter();
  const cli = context.invocation;
  out.fixed(
    T.add.title(
      composition.fragments.map((entry) => entry.id),
      oneLine(context.project),
    ),
    "",
  );
  writeUntrusted(out, composition, add, cli);
  writeFacts(out, composition, context, add);
  writeJobAndGroundRules(out, context, add, cli);
  writePendingWork(out, add);
  writeDecisions(out, composition.decisions, context.yes);
  writeDependencies(out, composition, context);
  writeGuidance(out, composition);
  out.fixed("", T.done.heading, "", T.add.done(cli));
  writeDefinitionOfDone(out, add.manifest, cli);
  out.fixed(
    "",
    T.done.rule.run(cli),
    T.done.rule.create,
    T.done.rule.weaken,
    T.done.rule.changed(cli),
    "",
    ...T.done.qa,
  );
  if (composition.preset === "sandbox") out.fixed("", ...T.sandbox);
  return out.brief();
}

/**
 * List untrusted entries through `writeUntrustedList` (trust point 3). Use the digest decision
 * from `mergeAddManifest` (trust point 4).
 */
function writeUntrusted(
  out: BriefWriter,
  composition: Composition<Entry | null>,
  add: AddBriefContext,
  cli: string,
): void {
  if (composition.untrusted.length === 0) return;
  writeUntrustedList(out, composition.untrusted);
  out.fixed("", T.untrusted.ask);
  if (!add.digestRecorded) out.fixed("", T.add.accept(cli));
  out.fixed("");
}

/** The facts list, with every written path in full (an add writes few files). */
function writeFacts(
  out: BriefWriter,
  composition: Composition<Entry | null>,
  context: BriefContext,
  add: AddBriefContext,
): void {
  out.fixed(
    T.add.stack(add.stack),
    ...(composition.inferredTags !== undefined
      ? [T.add.inferredTags(composition.inferredTags)]
      : []),
    T.add.applied(add.applied),
    T.facts.fragments(composition.fragments.map((entry) => entry.id)),
    T.facts.preset(composition.preset),
    T.facts.agents(composition.agents),
    composition.parts ? T.facts.workspaceRoot : T.facts.root,
  );
  if (context.written.length) {
    out.fixed(T.facts.written);
    out.data(...context.written.map((path) => `  - ${T.code(path)}`));
  }
  if (context.invocation !== "stacks") out.fixed(T.facts.invocation(context.invocation));
}

function writeJobAndGroundRules(
  out: BriefWriter,
  context: BriefContext,
  add: AddBriefContext,
  cli: string,
): void {
  out.fixed(
    "",
    T.job(cli)[0] ?? "",
    "",
    T.add.job(cli),
    "",
    ...T.versions,
    "",
    T.ground.heading,
    "",
    T.add.git,
    T.add.ignore,
    T.ground.agentsMd,
    T.ground.telemetry,
    ...T.ground.notes,
  );
  if (context.missing.length) out.fixed(T.ground.missing);
  if (add.createAgentsMd) out.fixed(T.add.createAgentsMd);
}

function writePendingWork(out: BriefWriter, add: AddBriefContext): void {
  if (add.mergeNeeded.length) {
    out.fixed("", T.add.merge, "", T.add.mergeTask, "");
    out.data(
      ...add.mergeNeeded.flatMap((item) =>
        item.incoming.map((incoming) => `- ${T.code(item.path)}: ${T.code(incoming)}`),
      ),
    );
  }
  if (add.missingRequired.length) {
    out.fixed("", T.add.required, "");
    out.data(...add.missingRequired.map((item) => `- ${T.code(item.id)}: ${T.code(item.command)}`));
  }
}

/** Packages by role, then tool status, without the new brief's install shortcut. */
function writeDependencies(
  out: BriefWriter,
  composition: Composition<Entry | null>,
  context: BriefContext,
): void {
  if (composition.deps.length === 0 && composition.tools.length === 0) return;
  out.fixed("", T.dependencies.heading, "");
  out.data(...dependencyLines(composition.deps));
  out.data(...toolLines(composition.tools, context));
}

/** Keep each added fragment's recipe notes next to its guidance so their context is clear. */
function writeGuidance(out: BriefWriter, composition: Composition<Entry | null>): void {
  for (const entry of composition.fragments) {
    out.fixed("", T.sections.fragment(oneLine(entry.meta.name), entry.id));
    if (entry.mount) out.fixed("", T.sections.placed(entry.mount.name));
    // Retain a fragment's title: in add mode it may carry guidance beyond its registry name.
    out.data("", nest(entry.body.replace(/^(\s*)#(?=[ \t])/, "$1##")).trim());
    for (const note of composition.addNotes ?? [])
      if (note.fragment === entry.id) {
        out.fixed("", T.add.recipeNote(note.entry.id), "");
        out.data(nest(note.entry.body, 4).trim());
      }
  }
}

/** The whole manifest's steps, commands and environment, as verify will run them. */
function writeDefinitionOfDone(
  out: BriefWriter,
  manifest: AddBriefContext["manifest"],
  cli: string,
): void {
  const steps: ComposedStep[] = manifest.verify.map((step) => ({
    ...withStepDefaults(step),
    skipByDefault: step.skipByDefault,
    owner: { kind: "fragment", id: step.owner },
  }));
  if (steps.length) {
    // Match planVerify: finish the base stage before starting any app phase.
    const ordered = [false, true].flatMap((app) =>
      runOrder(steps.filter((step) => step.tags.includes(APP_TAG) === app)),
    );
    out.data("");
    writeStepTable(out, ordered);
  }
  writeCommandTable(out, T.done.commands, manifest.commands);
  writeEnvironment(out, cli, manifest.env);
}
