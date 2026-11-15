/**
 * Does all of `stacks add`'s thinking before a single file is written.
 *
 * `core/add.ts` calls `prepareAdd` with the project `add/project.ts` read. It composes only the
 * requested fragments (the delta) onto what the project already has (`compose/compose.ts` in add
 * mode), renders their files with the project's name and settings, asks `add/plan.ts` where each
 * file goes, and builds the manifest entries for the new verify steps. A composition is the result
 * of combining a stack with fragments: files, verify steps, env and notes.
 *
 * Doing all of this up front means a bad request (a step name that clashes with an existing one, a
 * fragment that needs its own git repository) fails before the writer opens, so nothing needs
 * rolling back. A project with no known stack gets tags guessed from its files (`add/tags.ts`),
 * which only steer `stacks:when` blocks in templates.
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
import type { Composition, MissingTool } from "../compose/types";
import { buildManifest } from "../manifest";
import type { Entry } from "../registry/entry";
import { gitInstalled } from "../scaffold/git";
import { templateOverrides, templateValues } from "../scaffold/values";
import type { TemplateValues } from "../template";
import { printable } from "../text";
import { inferName } from "./name";
import { type AddPlan, planAdd } from "./plan";
import type { AddProject } from "./project";
import { inferTags } from "./tags";
import type { AddOptions } from "./types";

/** Compose only the requested delta, then render and classify its files before opening a writer. */
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
 * Compose the requested fragments in add mode. A project with a manifest keeps its recorded preset
 * and agents; a project with no known stack gets tags inferred from its files for conditionals.
 */
const composeDelta = (options: AddOptions, project: AddProject) =>
  Effect.gen(function* () {
    const { previous, settings, stack, existing } = project;
    return yield* compose({
      stack: stack?.id ?? null,
      with: options.fragments,
      without: [],
      preset: previous?.preset ?? (options.sandbox ? "sandbox" : "default"),
      agents: previous?.agents ?? targetAgents(options.agents, settings),
      always: [],
      mode: "add",
      existing,
      ...(!stack ? { inferredTags: yield* inferTags(options.root) } : {}),
    });
  });

/** Print a progress warning for each tool missing from PATH and return them as result warnings. */
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

/** The manifest's recorded name when it has one, otherwise one inferred from project files. */
const projectName = (root: string, previous: Manifest | undefined) =>
  previous?.name !== undefined
    ? Effect.succeed({ name: { value: previous.name, source: "manifest" }, warnings: [] })
    : inferName(root);

/** Pair each planned file with its rendered bytes, in the composition's file order. */
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

/** Fail when an added verify step reuses the name of a step the project already has. */
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
