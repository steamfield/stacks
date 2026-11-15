/**
 * Reads the project `stacks add` is about to extend: its manifest, whether that manifest was
 * changed behind the CLI's back, the stack it was made from and the user's settings.
 *
 * `core/add.ts` calls `readAddProject` first. A project without `.stacks/manifest.json` is fine;
 * `add` creates one. When a manifest exists, `verify/tamper.ts::checkTamper` compares its verify
 * steps with the state record (the per-project file outside the project holding digests), and
 * changed steps stop the add as `VerifyChanged` (Trust model point 5): adding to a definition of
 * done nobody accepted would hide the change. `--sandbox` and `--agents` must match what the
 * manifest recorded, since `add` extends the project as it was created.
 */
import type { AgentId, Manifest } from "@steamfield/stacks-format";
import { Effect, Path } from "effect";
import { AppConfig } from "../../config";
import { BadInput, VerifyChanged } from "../../errors";
import type { AddResult } from "../../schemas/add";
import { MANIFEST_PATH, readManifest } from "../manifest";
import { Registry } from "../registry/registry";
import { checkTamper } from "../verify/tamper";
import { checkAddRoot } from "./plan";
import type { AddOptions } from "./types";

/** Read the project's accepted definition of done before planning any contribution. */
export const readAddProject = (options: AddOptions) =>
  Effect.gen(function* () {
    const settings = yield* (yield* AppConfig).get;
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
    return {
      previous,
      tamper,
      settings,
      stack,
      warnings,
      existing: previous?.fragments.map((entry) => entry.id) ?? [],
    };
  });
export type AddProject = Effect.Success<ReturnType<typeof readAddProject>>;

/**
 * Reject `--sandbox` or `--agents` when they disagree with the manifest, since add extends the
 * project as it was created rather than changing its preset or agents.
 */
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

/** The project's recorded stack from the registry, or `undefined` when it can't be found. */
function projectStack(registry: Registry["Service"], id: string | undefined) {
  if (id === undefined) return Effect.succeed(undefined);
  return registry.get("stack", id).pipe(Effect.orElseSucceed(() => undefined));
}
