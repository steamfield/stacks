import type { AgentId, Kind, ResolvedStep } from "@steamfield/stacks-format";
import type { Entry, Origin } from "../registry/entry";

export type ComposeOptions<M extends "new" | "add" = "new"> = {
  stack: M extends "new" ? string : string | null;
  with: ReadonlyArray<string>;
  without: ReadonlyArray<string>;
  preset: "default" | "sandbox";
  /** Adapter targets, from `targetAgents`. */
  agents: ReadonlyArray<AgentId>;
  /** `Settings.always`. */
  always: ReadonlyArray<string>;
  mode: M;
  /** Already applied fragments satisfy requirements but emit nothing. */
  existing?: ReadonlyArray<string>;
  /** Add-only fallback for conditional prose; never used by fragment selection. */
  inferredTags?: ReadonlyArray<string>;
};

/** Which entry: a stack and a fragment may share an id, so an id alone is ambiguous. */
export type CompositionEntryRef = { kind: Kind; id: string };

export type PlannedFile = {
  /** Output path, relative to the project root, `.tmpl` dropped. */
  path: string;
  /** The writing entry; for a merge, the first writer. */
  owner: CompositionEntryRef;
  /** Every writer in composition order, including the first. */
  owners: ReadonlyArray<CompositionEntryRef>;
  kind: "copy" | "template" | "merge";
  /** Copy and template: where the bytes come from. */
  source?: { entry: CompositionEntryRef; file: string };
  /** Merge only: the merged JSON, final bytes. */
  content?: string;
  /** Permission bits of the source file (the first writer's, for a merge). */
  mode: number;
};

export type ComposedStep = ResolvedStep & { owner: CompositionEntryRef; skipByDefault: boolean };
export type ComposeWarning = {
  code: "always_not_applicable" | "always_unknown" | "with_not_applicable" | "without_not_selected";
  id: string;
};
/**
 * How a fragment entered the selection: `required` is the stack's required list and everything it
 * requires; `requires` was pulled in only by another fragment's `requires`.
 */
export type Via = "required" | "default" | "always" | "with" | "requires";

export type Composition<S extends Entry | null = Entry> = {
  /** The stack, its body with conditionals resolved. */
  stack: S;
  /** Composition order (requirements first, ties by id, the app last), bodies resolved. */
  fragments: ReadonlyArray<Entry>;
  /** The one fragment with category "app", also in `fragments`. */
  app: Entry | null;
  /** Current recipe blocks that specifically name an added fragment. */
  addNotes?: ReadonlyArray<{ fragment: string; entry: Entry }>;
  inferredTags?: ReadonlyArray<string>;
  /** How each fragment was selected, in composition order. */
  selection: ReadonlyArray<{ id: string; via: Via }>;
  preset: ComposeOptions["preset"];
  agents: ReadonlyArray<AgentId>;
  files: ReadonlyArray<PlannedFile>;
  verify: ReadonlyArray<ComposedStep>;
  commands: Record<string, string>;
  env: Record<string, string>;
  decisions: ReadonlyArray<{ owner: CompositionEntryRef; text: string }>;
  tools: ReadonlyArray<{ tool: string; owners: ReadonlyArray<CompositionEntryRef> }>;
  deps: ReadonlyArray<{
    role: string;
    names: ReadonlyArray<string>;
    owners: ReadonlyArray<CompositionEntryRef>;
  }>;
  /** Fragment ids that refuse an enclosing repository (1.2a). */
  needsOwnRepo: ReadonlyArray<string>;
  untrusted: ReadonlyArray<{ id: string; kind: Kind; origin: Origin; dir: string }>;
  warnings: ReadonlyArray<ComposeWarning>;
};

/** A tool not on PATH: who needs it, and the flags that would have left it out (none if none can). */
export type MissingTool = {
  tool: string;
  owners: ReadonlyArray<CompositionEntryRef>;
  drop: ReadonlyArray<{ id: string; flag: "without" | "with" }>;
};
