/**
 * The shapes `renderBrief` takes and returns. They live in their own file so every module in
 * `core/brief/` and its callers (`core/scaffold/`, `core/add/`, `core/validate/`) import them in
 * one direction.
 */
import type { Manifest } from "@steamfield/stacks-format";
import type { MissingTool } from "../compose/types";

/**
 * The project root's git state, probed before anything is written: `fresh` gets its own
 * repository, `parent` is inside another work tree, `none` means git isn't installed.
 */
export type GitState = { kind: "fresh" } | { kind: "parent"; toplevel: string } | { kind: "none" };

/** Facts about this run that the composition doesn't carry. */
export type BriefContext = {
  /** Present for `stacks add`, which renders the add brief instead. */
  add?: {
    /** Fragment ids the manifest already listed. */
    applied: ReadonlyArray<string>;
    /** The new guidance asks for `AGENTS.md` sections and the project has no `AGENTS.md`. */
    createAgentsMd?: boolean;
    /** The recorded stack id, or null for a project stacks didn't create. */
    stack: string | null;
    /** Project paths whose fragment copies were parked under `.stacks/incoming/`. */
    mergeNeeded: ReadonlyArray<{ path: string; incoming: ReadonlyArray<string> }>;
    /** The recorded stack's required fragments the project lacks, each with its `add` command. */
    missingRequired: ReadonlyArray<{ id: string; command: string }>;
    /** Whether the new verify steps were accepted; false asks the user to accept them. */
    digestRecorded: boolean;
    /** The merged manifest, whose steps make up the definition of done. */
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

/** The brief's text and its word counts; `fixedWords` is the share written by `text.ts`. */
export type Brief = { text: string; briefWords: number; fixedWords: number };
