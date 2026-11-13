import { Effect, Option } from "effect";
import { Processes } from "../../services/processes";
import type { Entry } from "../registry/entry";
import { missingTools } from "./compose";
import type { Composition } from "./types";

/** The single PATH lookup for a composition's tools; it never starts one. */
export const missingToolsOnPath = (composition: Composition<Entry | null>) =>
  Effect.gen(function* () {
    const processes = yield* Processes;
    const found = new Set<string>();
    for (const { tool } of composition.tools)
      if (Option.isSome(yield* processes.which(tool))) found.add(tool);
    return missingTools(composition, (tool) => found.has(tool));
  });
