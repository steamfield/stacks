import type { Manifest } from "@steamfield/stacks-format";
import type { MissingTool } from "../compose/types";

/**
 * The project root's git state, probed before anything is written: `fresh` gets its own
 * repository, `parent` is inside another work tree, `none` means git isn't installed.
 */
export type GitState = { kind: "fresh" } | { kind: "parent"; toplevel: string } | { kind: "none" };
export type BriefContext = {
  add?: {
    applied: ReadonlyArray<string>;
    createAgentsMd?: boolean;
    stack: string | null;
    mergeNeeded: ReadonlyArray<{ path: string; incoming: ReadonlyArray<string> }>;
    missingRequired: ReadonlyArray<{ id: string; command: string }>;
    digestRecorded: boolean;
    manifest: Manifest;
  };
  project: string;
  git: GitState;
  /** Paths stacks wrote, relative to the project root. */
  written: ReadonlyArray<string>;
  missing: ReadonlyArray<MissingTool>;
  /** Canonical previews do not inspect PATH. */
  toolsUnchecked?: boolean;
  /** `--yes` or `--sandbox`: take every decision's default. */
  yes: boolean;
  /** `Host.invocation`. */
  invocation: string;
};
export type Brief = { text: string; briefWords: number; fixedWords: number };
