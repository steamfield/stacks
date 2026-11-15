/**
 * The shapes every `stacks validate` check shares: the `View` a check reads and the `Check`
 * signature itself.
 *
 * `index.ts::validate` (and `preview.ts::previewBrief` for `validate --brief`) builds one `View`
 * and hands it to every check module in this folder. The types live here, apart from `index.ts`,
 * so check modules can import them without importing the module that imports them.
 */
import type { Kind } from "@steamfield/stacks-format";
import type { Effect, FileSystem, Path } from "effect";
import type { AppConfig } from "../../config";
import type { PermissionDenied } from "../../errors";
import type { Finding, SizeRow } from "../../schemas/validate";
import type { Processes } from "../../services/processes";
import type { RenderedFile } from "../compose/files";
import type { ComposeOptions, Composition } from "../compose/types";
import type { Entry, RejectedEntry } from "../registry/entry";
import type { Registry } from "../registry/registry";
import type { EntrySources } from "./sources";

/** One composition and the files it renders to, as the rendered-file checks read them. */
export type Composed = { composition: Composition; files: ReadonlyArray<RenderedFile> };

/** A `View` before its compositions are rendered, which is what rendering them reads. */
export type SourceView = Omit<View, "composed">;

/**
 * What rendering every composition under check produced (`composed.ts::composedFiles`): the
 * rendered snapshots, the findings rendering raised, and a key for each composition that failed
 * on a conflict, so `compose-each.ts` doesn't report the same conflict again.
 */
export type RenderState = {
  snapshots: Composed[];
  findings: Finding[];
  failures: Set<string>;
};

/**
 * What every check reads. `entries` and `rejected` are the validated set (under the root, and
 * only the one entry when `validate` was given an entry directory); `all` is the resolution set,
 * every winning entry of every origin, with the root's entries shadowing the rest.
 */
export type View = {
  /** A preview's selection and original options, for recomposing each shipped adapter. */
  composition?: Composition & { options: ComposeOptions };
  root: string;
  bundled: boolean;
  only?: { kind: Kind; id: string };
  entries: ReadonlyArray<Entry>;
  rejected: ReadonlyArray<RejectedEntry>;
  all: ReadonlyArray<Entry | RejectedEntry>;
  /** Each readable entry's markdown text and shipped files, keyed by the entry's directory. */
  sources: ReadonlyMap<string, EntrySources>;
  /** Renders the compositions under check on first use; later runs return the same state. */
  composed: Effect.Effect<RenderState, never, FileSystem.FileSystem | Path.Path | Registry>;
  /** Whether an entry under the root is in the validated set (false for all but `only`). */
  wanted: (item: { kind: Kind; id: string }) => boolean;
  /** Whether an entry of the resolution set lives under the validated root. */
  inRoot: (item: { dir: string }) => boolean;
  /** `stacks/<id>/STACK.md` (or a file inside the entry), relative to the root. */
  file: (item: { kind: Kind; dir: string }, inside?: string) => string;
};

type CheckResult = { findings: ReadonlyArray<Finding>; sizes?: ReadonlyArray<SizeRow> };
type CheckEnv = Registry | FileSystem.FileSystem | Path.Path | Processes | AppConfig;
/** One check group: findings (and size rows) for the validated set. Problems are findings, not failures. */
export type Check = (view: View) => Effect.Effect<CheckResult, PermissionDenied, CheckEnv>;
