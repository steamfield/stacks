/**
 * Owns the shared composition inputs, plan and result so modules can use them without depending on
 * the implementation.
 */
import type { AgentId, Kind, ResolvedStep } from "@steamfield/stacks-format";
import type { Entry, Origin, Payload, Stack } from "../registry/entry";

/** Where a mounted entry lives: its part's directory and step prefix, role, and the part's stack id (which picks overlays). */
export type PartMount = { readonly name: string; readonly role: string; readonly stack: string };
/** An entry as composed; `mount` is set on a part and on a fragment placed on one. */
export type MountedEntry = Entry & { readonly mount?: PartMount };
/** A part as selection loads it, before mounting; `entry` is null as in `ComposedPart`. */
export type SelectedPart = { readonly mount: PartMount; readonly entry: Stack | null };
/** One part of a workspace composition. `entry` is null only in add mode, for a part stack the registry no longer has. */
export type ComposedPart = { readonly mount: PartMount; readonly entry: MountedEntry | null };
/**
 * The workspace parts are mounted under. `entry` is null only in add mode, for a workspace stack
 * the registry no longer has: placement needs only the id.
 */
export type MountRoot = { readonly id: string; readonly entry: Stack | null };

export type ComposeOptions<M extends "new" | "add" = "new"> = {
  stack: M extends "new" ? string : string | null;
  with: ReadonlyArray<string>;
  without: ReadonlyArray<string>;
  preset: "default" | "sandbox";
  /** Adapter targets, from `targetAgents`. */
  agents: ReadonlyArray<AgentId>;
  always: ReadonlyArray<string>;
  mode: M;
  /** Already applied fragments satisfy requirements but emit nothing. */
  existing?: ReadonlyArray<string>;
  /** Add-only fallback for conditional prose; never used by fragment selection. */
  inferredTags?: ReadonlyArray<string>;
  /** `--preset lean`: select none of the stack's default fragments. */
  lean?: boolean;
  /** `new --payload`: the stack's payload variant; absent is the example. */
  payload?: Payload;
  /** Add mode only: the project's parts from `Manifest.parts` (`stack` is the ref's id). */
  parts?: ReadonlyArray<PartMount>;
  /** Add mode only, with `parts`: the manifest's workspace stack id, which mounts the parts when no registry has that stack. */
  workspace?: string;
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
  fragments: ReadonlyArray<MountedEntry>;
  /** Add mode only: previously applied fragments resolved from the current registry. */
  readonly applied?: ReadonlyArray<MountedEntry>;
  /** The workspace's parts in `parts` order, each mounted; absent for a composition without parts. */
  parts?: ReadonlyArray<ComposedPart>;
  /** The one fragment with category "app", also in `fragments`. */
  app: Entry | null;
  /** Current recipe blocks that specifically name an added fragment; `entry.mount` is its source's. */
  addNotes?: ReadonlyArray<{ fragment: string; entry: MountedEntry }>;
  inferredTags?: ReadonlyArray<string>;
  selection: ReadonlyArray<{ id: string; via: Via }>;
  preset: ComposeOptions["preset"];
  lean?: boolean;
  /** The stack's payload variant; absent is the example. */
  payload?: Payload;
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
  /** Fragment ids that need the project to be its own git repository, not inside another one. */
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
