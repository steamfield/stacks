/** Builds `.stacks/sources.json`; `new` and `add` write it through the project writer. */
import type { ProjectSources } from "../../schemas/sources";
import type { IndexProvenance } from "./provenance";

/** The `sources.json` document for a composition's resolved entries. */
export const projectSources = (_input: {
  provenance: IndexProvenance;
  entries: ProjectSources["entries"];
}): ProjectSources => ({ formatVersion: 1, index: null, entries: [] });
