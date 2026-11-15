/**
 * When someone runs `stacks add <fragment...>`, this module runs the whole addition, start to
 * finish, without changing any file the project already has.
 *
 * A fragment is a reusable addition (CI, git hooks, a database) that a stack can include; `add`
 * applies fragments to a project that already exists. `commands/add.ts` parses the flags and calls
 * `add`, which runs four steps from `core/add/`: read the project (`project.ts`), compose and plan
 * the delta (`prepare.ts`), merge the manifest (`.stacks/manifest.json`, the committed record of
 * what was composed and how to verify it) in `manifest.ts`, and write everything (`write.ts`).
 * Between those it renders the brief (`.stacks/BRIEF.md`, the task text for the coding agent) and
 * stamps the manifest with the handoff record, so the files say where the project went next.
 *
 * The handoff is decided here, before writing, because only composition knows which entries are
 * untrusted (Trust model point 3), and the manifest that records it is written in the same
 * transaction. The result returns to `commands/add.ts`, which prints it and hands off.
 */
import { Clock, Effect } from "effect";
import { AppConfig } from "../config";
import { BRIEF_PATH } from "../project-layout";
import type { AddResult } from "../schemas/add";
import { Host } from "../services/host";
import { mergeAddManifest } from "./add/manifest";
import { mergeNeeded } from "./add/plan";
import { prepareAdd } from "./add/prepare";
import { readAddProject } from "./add/project";
import type { AddOptions } from "./add/types";
import { applyAdd } from "./add/write";
import { renderBrief } from "./brief/render";
import { handoffRecord } from "./handoff";

export { type AddPlan, checkAddRoot, planAdd } from "./add/plan";

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
