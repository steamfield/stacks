/**
 * Reads the project context for `stacks add`. It uses `checkTamper` (trust point 5) so adding steps
 * cannot hide an unaccepted change.
 */
import type { AgentId, Manifest } from "@steamfield/stacks-format";
import { Effect, Path } from "effect";
import { AppConfig } from "../../config";
import { BadInput, VerifyChanged } from "../../errors";
import type { AddResult } from "../../schemas/add";
import type { Settings } from "../../schemas/config";
import { MANIFEST_PATH, readManifest } from "../project/manifest";
import type { Entry } from "../registry/entry";
import { Registry } from "../registry/registry";
import { checkTamper, type Tamper } from "../verify/tamper";
import { checkAddRoot } from "./plan";
import type { AddOptions } from "./types";

export type AddProject = {
  previous: Manifest | undefined;
  tamper: Tamper | undefined;
  settings: Settings;
  stack: Entry | undefined;
  warnings: AddResult["warnings"];
  existing: AddResult["alreadyApplied"];
};

export const readAddProject = (options: AddOptions) =>
  Effect.gen(function* () {
    const settings = yield* (yield* AppConfig).settings;
    const path = yield* Path.Path;
    yield* checkAddRoot(options.root);
    const previous = yield* readManifest(path.join(options.root, MANIFEST_PATH)).pipe(
      Effect.catchTag("NotFound", () => Effect.succeed(undefined)),
    );
    const tamper = previous
      ? yield* checkTamper(previous, path.join(options.root, MANIFEST_PATH))
      : undefined;
    if (tamper?.changed) return yield* new VerifyChanged({ details: tamper.changed });
    if (previous) yield* checkFlagsMatch(options, previous);
    const registry = yield* Registry;
    const stack = yield* projectStack(registry, previous?.stack?.id);
    const warnings: Array<AddResult["warnings"][number]> =
      previous?.stack && !stack ? [{ code: "stack_unknown", id: previous.stack.id }] : [];
    const project: AddProject = {
      previous,
      tamper,
      settings,
      stack,
      warnings,
      existing: previous?.fragments.map((entry) => entry.id) ?? [],
    };
    return project;
  });

/** Refuse conflicting `--sandbox` or `--agents` flags because add extends the recorded configuration. */
const checkFlagsMatch = (options: AddOptions, previous: Manifest) =>
  Effect.gen(function* () {
    if (options.sandbox && previous.preset !== "sandbox")
      return yield* new BadInput({ details: { id: "sandbox", flag: "sandbox" } });
    if (options.agents && !sameAgents(options.agents, previous.agents))
      return yield* new BadInput({ details: { id: options.agents.join(","), flag: "agents" } });
  });

/** Whether two agent lists name the same agents, ignoring order and duplicates in `requested`. */
const sameAgents = (requested: ReadonlyArray<AgentId>, recorded: ReadonlyArray<AgentId>) =>
  [...new Set(requested)].sort().join(",") === [...recorded].sort().join(",");

function projectStack(registry: Registry["Service"], id: string | undefined) {
  if (id === undefined) return Effect.succeed(undefined);
  return registry.get("stack", id).pipe(Effect.orElseSucceed(() => undefined));
}
