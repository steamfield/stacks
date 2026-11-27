/**
 * Applies fragments while preserving live scaffold files.
 */
import type { Manifest } from "@steamfield/stacks-format";
import { Clock, Effect } from "effect";
import { AppConfig } from "../../config";
import { BRIEF_PATH } from "../../project-layout";
import type { AddResult } from "../../schemas/add";
import { Host } from "../../services/host";
import { renderAddBrief } from "../brief/render-add";
import type { Composition, MissingTool } from "../compose/types";
import { decideHandoff, type HandoffDecision, settleHandoff } from "../handoff/decide";
import { encodeSources, updatedSources } from "../project/sources";
import type { Entry } from "../registry/entry";
import { mergeAddManifest } from "./manifest";
import { mergeNeeded } from "./plan";
import { prepareAdd } from "./prepare";
import { type AddProject, readAddProject } from "./project";
import type { AddOptions } from "./types";
import { applyAdd } from "./write";

export { type AddPlan, checkAddRoot, planAdd } from "./plan";

export type Added = {
  result: Omit<AddResult, "handoff">;
  decision: HandoffDecision;
  manifest: Manifest;
  composition: Composition<Entry | null>;
};

type AddResultInput = Pick<
  Added["result"],
  | "added"
  | "written"
  | "skipped"
  | "mergeNeeded"
  | "missingRequired"
  | "commandsKept"
  | "warnings"
  | "name"
  | "stateRecord"
  | "digestRecorded"
  | "briefWords"
> & {
  root: string;
  project: AddProject;
  manifest: Manifest;
  composition: Added["composition"];
  missing: ReadonlyArray<MissingTool>;
};

function addResult(input: AddResultInput): Added["result"] {
  const { composition, project } = input;
  return {
    project: input.root,
    stack: input.manifest.stack?.id ?? null,
    added: input.added,
    alreadyApplied: project.existing,
    written: input.written,
    skipped: input.skipped,
    mergeNeeded: input.mergeNeeded,
    missingRequired: input.missingRequired,
    commandsKept: input.commandsKept,
    warnings: input.warnings,
    missingTools: input.missing.map((item) => ({
      ...item,
      owners: [...item.owners],
    })),
    name: input.name,
    createdManifest: !project.previous,
    tamperCheck: project.tamper?.tamperCheck ?? null,
    stateRecord: input.stateRecord,
    digestRecorded: input.digestRecorded,
    brief: BRIEF_PATH,
    briefWords: input.briefWords,
    ...(composition.inferredTags !== undefined ? { inferredTags: composition.inferredTags } : {}),
    untrusted: [...composition.untrusted],
  };
}

export const add = (options: AddOptions) =>
  Effect.gen(function* () {
    const project = yield* readAddProject(options);
    const prepared = yield* prepareAdd(options, project);
    const host = yield* Host;
    const { composition, plan, name, added, missing, missingRequired, warnings } = prepared;
    const merged = mergeAddManifest({
      previous: project.previous,
      incoming: prepared.built,
      name: name.value,
      untrusted: composition.untrusted.length > 0,
      agent: yield* (yield* AppConfig).agent,
      stdinIsTTY: host.stdinIsTTY,
    });
    // Composition determines trust for `decideHandoff` (trust point 3). Decide before writing
    // so `applyAdd` commits the handoff record with the manifest.
    const decision = decideHandoff({
      ...options.handoff,
      untrusted: composition.untrusted.map((entry) => entry.id),
    });
    const manifest = settleHandoff(
      merged.manifest,
      decision,
      new Date(yield* Clock.currentTimeMillis).toISOString(),
    );
    const written = plan.write.map((file) => file.path).sort();
    const incoming = mergeNeeded(plan.incoming);
    const brief = renderAddBrief(
      composition,
      {
        project: name.value,
        invocation: host.invocation,
        git: { kind: "parent", toplevel: options.root },
        written,
        missing,
        yes: options.yes || composition.preset === "sandbox",
      },
      {
        applied: project.existing,
        createAgentsMd: prepared.createAgentsMd,
        stack: project.previous?.stack?.id ?? null,
        mergeNeeded: incoming,
        missingRequired,
        digestRecorded: merged.digestRecorded,
        manifest,
      },
    );
    const stateRecord = yield* applyAdd({
      root: options.root,
      plan,
      project,
      manifest: { ...manifest, briefWords: brief.briefWords },
      stateManifest: merged.stateManifest,
      brief,
      sources: encodeSources(
        yield* updatedSources({ root: options.root, composition, provenance: options.provenance }),
      ),
    });
    const result = addResult({
      root: options.root,
      project,
      manifest,
      composition,
      added,
      written,
      skipped: plan.skipped,
      mergeNeeded: incoming,
      missingRequired,
      commandsKept: merged.commandsKept,
      warnings,
      missing,
      name,
      stateRecord,
      digestRecorded: merged.digestRecorded,
      briefWords: brief.briefWords,
    });
    return { result, decision, manifest, composition } satisfies Added;
  });
