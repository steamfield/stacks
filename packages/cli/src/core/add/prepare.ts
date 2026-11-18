/**
 * Prepares an add from the requested fragments only. Resolving conflicts before opening the writer
 * avoids rollback for an invalid request.
 */
import type { Manifest } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path } from "effect";
import { ComposeConflict, PermissionDenied } from "../../errors";
import type { AddResult } from "../../schemas/add";
import { Host } from "../../services/host";
import { Output } from "../../services/output";
import { targetAgents } from "../compose/agents";
import { compose } from "../compose/compose";
import { composeFiles } from "../compose/files";
import { missingToolsOnPath } from "../compose/tools";
import type { ComposeOptions, Composition, MissingTool } from "../compose/types";
import { defined } from "../object";
import { gitInstalled } from "../project/git";
import { buildManifest } from "../project/manifest";
import { addPreset } from "../project/preset";
import { templateOverrides, templateValues } from "../project/template-values";
import type { Entry } from "../registry/entry";
import type { TemplateValues } from "../template";
import { printable } from "../text/text";
import { inferName } from "./name";
import { type AddPlan, planAdd } from "./plan";
import type { AddProject } from "./project";
import { inferTags } from "./tags";
import type { AddOptions } from "./types";

export const prepareAdd = (options: AddOptions, project: AddProject) =>
  Effect.gen(function* () {
    const { previous, settings, stack, existing } = project;
    const host = yield* Host;
    const composition = yield* composeDelta(options, project);
    const missing = yield* missingToolsOnPath(composition);
    const missingWarnings = yield* warnMissingTools(missing);
    const inferred = yield* projectName(options.root, previous);
    const warnings = [
      ...project.warnings,
      ...composition.warnings,
      ...missingWarnings,
      ...inferred.warnings,
    ];
    const name = inferred.name;
    yield* templateOverrides({ name: name.value });
    const values = yield* templateValues({
      name: name.value,
      settings,
      git: { cwd: options.root, installed: yield* gitInstalled },
    });
    const files = yield* renderPlannedFiles(composition, values);
    const plan = yield* planAdd({ root: options.root, composition, rendered: files });
    const built = yield* buildManifest(composition, { briefWords: 0, mode: "add" });
    yield* checkStepNames(built, previous);
    const added = composition.fragments.map((entry) => entry.id);
    const missingRequired = missingRequiredFragments({
      stack,
      present: new Set([...existing, ...added]),
      invocation: host.invocation,
    });
    const createAgentsMd = yield* needsAgentsMd(options.root, composition, plan);
    return {
      composition,
      missing,
      name,
      plan,
      built,
      added,
      missingRequired,
      warnings,
      createAgentsMd,
    };
  });

/**
 * Use the preset and agents preserved by `checkFlagsMatch` so new templates and adapters match
 * the existing project. Infer tags for conditionals only when there is no known stack.
 */
const composeDelta = (options: AddOptions, project: AddProject) =>
  Effect.gen(function* () {
    const { previous, settings, stack, existing } = project;
    return yield* compose({
      stack: stack?.id ?? null,
      with: options.fragments,
      without: [],
      preset: addPreset(previous?.preset, options.sandbox),
      agents: previous?.agents ?? targetAgents(options.agents, settings),
      always: [],
      mode: "add",
      existing,
      ...workspaceParts(project),
      ...(!stack ? { inferredTags: yield* inferTags(options.root) } : {}),
    });
  });

/**
 * A workspace project's parts and its stack id, which mount the parts even when no registry has
 * the stack. An empty list would compose as a single stack, so only a workspace passes it.
 */
function workspaceParts({
  parts,
  previous,
}: AddProject): Partial<Pick<ComposeOptions<"add">, "parts" | "workspace">> {
  if (!parts.length) return {};
  return defined({ parts, workspace: previous?.stack?.id });
}

const warnMissingTools = (missing: ReadonlyArray<MissingTool>) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const warnings: Array<AddResult["warnings"][number]> = [];
    for (const item of missing) {
      warnings.push({ code: "missing_tool", id: item.tool });
      yield* output.progress(
        `Warning: ${printable(item.tool)} is not on PATH (needed by ${item.owners.map((owner) => printable(owner.id)).join(", ")}).`,
      );
    }
    return warnings;
  });

const projectName = (root: string, previous: Manifest | undefined) =>
  previous?.name !== undefined
    ? Effect.succeed({ name: { value: previous.name, source: "manifest" }, warnings: [] })
    : inferName(root);

/** Preserve the composition's file order when pairing planned files with bytes. */
const renderPlannedFiles = (composition: Composition<Entry | null>, values: TemplateValues) =>
  Effect.gen(function* () {
    const rendered = yield* composeFiles(composition, values);
    return yield* Effect.forEach(composition.files, (file) => {
      const renderedFile = rendered.find((item) => item.path === file.path);
      return renderedFile
        ? Effect.succeed({ file, bytes: renderedFile.bytes })
        : Effect.die(new Error("A planned add file has no rendered bytes"));
    });
  });

/** Reject duplicate verify step names before `applyAdd` opens a writer. */
const checkStepNames = (built: Manifest, previous: Manifest | undefined) => {
  const conflicting = built.verify.find((step) =>
    previous?.verify.some((old) => old.name === step.name),
  );
  if (!conflicting) return Effect.void;
  return Effect.fail(
    new ComposeConflict({
      details: { reason: "step_name", ids: [conflicting.owner], step: conflicting.name },
    }),
  );
};

/** The stack's required fragments the project still lacks, each with the command that adds it. */
function missingRequiredFragments(input: {
  stack: AddProject["stack"];
  present: ReadonlySet<string>;
  invocation: string;
}): AddResult["missingRequired"] {
  const { stack, present, invocation } = input;
  if (stack?.meta.kind !== "stack") return [];
  return stack.meta.fragments.required
    .filter((id) => !present.has(id))
    .map((id) => ({ id, command: `${invocation} add ${id}` }));
}

const needsAgentsMd = Effect.fn("add.needsAgentsMd")(function* (
  root: string,
  composition: Composition<Entry | null>,
  plan: AddPlan,
) {
  const entries = [
    ...composition.fragments,
    ...(composition.addNotes ?? []).map((note) => note.entry),
  ];
  // Entries ask for AGENTS.md sections under a heading naming the file (`## AGENTS.md`).
  if (!entries.some((entry) => /^#{1,6}[ \t][^\n]*AGENTS\.md/m.test(entry.body))) return false;
  if (plan.write.some((file) => file.path === "AGENTS.md")) return false;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(root, "AGENTS.md");
  return !(yield* fs
    .exists(file)
    .pipe(
      Effect.mapError(() => new PermissionDenied({ details: { reason: "read", path: file } })),
    ));
});
