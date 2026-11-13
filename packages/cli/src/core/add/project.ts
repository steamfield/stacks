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
    if (previous && options.sandbox && previous.preset !== "sandbox")
      return yield* new BadInput({ details: { id: "sandbox", flag: "sandbox" } });
    if (
      previous &&
      options.agents &&
      [...new Set(options.agents)].sort().join(",") !== [...previous.agents].sort().join(",")
    )
      return yield* new BadInput({ details: { id: options.agents.join(","), flag: "agents" } });
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

function projectStack(registry: Registry["Service"], id: string | undefined) {
  if (id === undefined) return Effect.succeed(undefined);
  return registry.get("stack", id).pipe(Effect.orElseSucceed(() => undefined));
}
