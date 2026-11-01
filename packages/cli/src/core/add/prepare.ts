import { Effect, FileSystem, Path } from "effect";
import { ComposeConflict, PermissionDenied } from "../../errors";
import { Host } from "../../services/host";
import { Output } from "../../services/output";
import type { AddOptions } from "../add";
import { targetAgents } from "../compose/agents";
import { type Composition, compose } from "../compose/compose";
import { composeFiles } from "../compose/files";
import { missingToolsOnPath } from "../compose/tools";
import { buildManifest } from "../manifest";
import type { Entry } from "../registry/entry";
import { gitInstalled } from "../scaffold/git";
import { templateOverrides, templateValues } from "../scaffold/values";
import { printable } from "../text";
import { inferName } from "./name";
import { type AddPlan, planAdd } from "./plan";
import type { AddProject } from "./project";
import { inferTags } from "./tags";

/** Compose only the requested delta, then render and classify its files before opening a writer. */
export const prepareAdd = (options: AddOptions, project: AddProject) =>
  Effect.gen(function* () {
    const { previous, settings, stack, existing } = project;
    const host = yield* Host;
    const composition = yield* compose({
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
    const warnings = [...project.warnings, ...composition.warnings];
    const missing = yield* missingToolsOnPath(composition);
    const output = yield* Output;
    for (const item of missing) {
      warnings.push({ code: "missing_tool", id: item.tool });
      yield* output.progress(
        `Warning: ${printable(item.tool)} is not on PATH (needed by ${item.owners.map((owner) => printable(owner.id)).join(", ")}).`,
      );
    }
    const inferred =
      previous?.name !== undefined
        ? { name: { value: previous.name, source: "manifest" }, warnings: [] }
        : yield* inferName(options.root);
    warnings.push(...inferred.warnings);
    const name = inferred.name;
    yield* templateOverrides({ name: name.value });
    const values = yield* templateValues({
      name: name.value,
      settings,
      git: { cwd: options.root, installed: yield* gitInstalled },
    });
    const rendered = yield* composeFiles(composition, values);
    const files = yield* Effect.forEach(composition.files, (file) => {
      const renderedFile = rendered.find((item) => item.path === file.path);
      return renderedFile
        ? Effect.succeed({ file, bytes: renderedFile.bytes })
        : Effect.die(new Error("A planned add file has no rendered bytes"));
    });
    const plan = yield* planAdd({ root: options.root, composition, rendered: files });
    const built = yield* buildManifest(composition, { briefWords: 0, mode: "add" });
    const conflicting = built.verify.find((step) =>
      previous?.verify.some((old) => old.name === step.name),
    );
    if (conflicting)
      return yield* new ComposeConflict({
        details: { reason: "step_name", ids: [conflicting.owner], step: conflicting.name },
      });
    const added = composition.fragments.map((entry) => entry.id);
    const present = new Set([...existing, ...added]);
    const missingRequired =
      stack?.meta.kind === "stack"
        ? stack.meta.fragments.required
            .filter((id) => !present.has(id))
            .map((id) => ({ id, command: `${host.invocation} add ${id}` }))
        : [];
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
