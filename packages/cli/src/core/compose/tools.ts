/**
 * Finds which tools a composition needs that aren't installed, so `stacks new` and `stacks add`
 * can warn before handing the project to an agent.
 *
 * Entries list the tools they rely on (`bun`, `docker`, `go`). `scaffold/new.ts` and
 * `add/prepare.ts` call `missingToolsOnPath`, which asks `Processes.which` (the CLI's one PATH
 * search) for each and hands the answers to `compose.ts::missingTools` for the hint text. A tool is
 * only looked up, never started (Trust model point 1 in `.claude/rules/architecture.md`).
 */
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
