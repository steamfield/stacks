/**
 * Applies fragments while preserving live scaffold files.
 */
import { Clock, Effect } from "effect";
import { AppConfig } from "../../config";
import { BRIEF_PATH } from "../../project-layout";
import type { AddResult } from "../../schemas/add";
import { Host } from "../../services/host";
import { renderBrief } from "../brief/render";
import { decideHandoff, settleHandoff } from "../handoff/decide";
import { mergeAddManifest } from "./manifest";
import { mergeNeeded } from "./plan";
import { prepareAdd } from "./prepare";
import { readAddProject } from "./project";
import type { AddOptions } from "./types";
import { applyAdd } from "./write";

export { type AddPlan, checkAddRoot, planAdd } from "./plan";

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
