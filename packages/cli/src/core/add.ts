import type { AgentId } from "@steamfield/stacks-format";
import { Clock, Effect } from "effect";
import { AppConfig } from "../config";
import { BRIEF_PATH } from "../project-layout";
import type { AddResult } from "../schemas/add";
import { Host } from "../services/host";
import { mergeAddManifest } from "./add/manifest";
import { mergeNeeded } from "./add/plan";
import { prepareAdd } from "./add/prepare";
import { readAddProject } from "./add/project";
import { applyAdd } from "./add/write";
import { renderBrief } from "./brief/render";
import { type HandoffDecision, handoffRecord } from "./handoff";

export { type AddPlan, checkAddRoot, planAdd } from "./add/plan";

export type AddOptions = {
  root: string;
  fragments: ReadonlyArray<string>;
  agents: ReadonlyArray<AgentId> | undefined;
  sandbox: boolean;
  yes: boolean;
  handoff: (untrusted: ReadonlyArray<string>) => HandoffDecision;
};

/** Read the accepted project, prepare a delta, merge its manifest, then apply it transactionally. */
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
    const decision = options.handoff(composition.untrusted.map((entry) => entry.id));
    const manifest = {
      ...merged.manifest,
      handoff: handoffRecord(decision, new Date(yield* Clock.currentTimeMillis).toISOString()),
    };
    const written = plan.write.map((file) => file.path).sort();
    const incoming = mergeNeeded(plan.incoming);
    const brief = renderBrief(composition, {
      project: name.value,
      invocation: host.invocation,
      git: { kind: "parent", toplevel: options.root },
      written,
      missing,
      yes: options.yes || composition.preset === "sandbox",
      add: {
        applied: project.existing,
        createAgentsMd: prepared.createAgentsMd,
        stack: project.previous?.stack?.id ?? null,
        mergeNeeded: incoming,
        missingRequired,
        digestRecorded: merged.digestRecorded,
        manifest,
      },
    });
    const stateRecord = yield* applyAdd({
      root: options.root,
      plan,
      project,
      manifest: { ...manifest, briefWords: brief.briefWords },
      stateManifest: merged.stateManifest,
      brief,
    });
    const result: Omit<AddResult, "handoff"> = {
      project: options.root,
      stack: manifest.stack?.id ?? null,
      added,
      alreadyApplied: project.existing,
      written,
      skipped: [...plan.skipped],
      mergeNeeded: incoming,
      missingRequired,
      commandsKept: merged.commandsKept,
      warnings,
      missingTools: missing.map((item) => ({
        ...item,
        owners: [...item.owners],
        drop: [...item.drop],
      })),
      name,
      createdManifest: !project.previous,
      tamperCheck: project.tamper?.tamperCheck ?? null,
      stateRecord,
      digestRecorded: merged.digestRecorded,
      brief: BRIEF_PATH,
      briefWords: brief.briefWords,
      ...(composition.inferredTags !== undefined ? { inferredTags: composition.inferredTags } : {}),
      untrusted: [...composition.untrusted],
    };
    return { result, decision, manifest, composition };
  });
