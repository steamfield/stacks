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

export type Composed = { composition: Composition; files: ReadonlyArray<RenderedFile> };

export type SourceView = Omit<View, "composed">;

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
  sources: ReadonlyMap<string, EntrySources>;
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
