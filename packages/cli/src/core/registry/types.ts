/** Owns the loading and tree-walk types to keep registry dependencies one-way. */
import type { Kind } from "@steamfield/stacks-format";
import type { FileSystem, Path } from "effect";
import type { Entry, Origin, RejectedEntry } from "./entry";

export type FileAccess = { fs: FileSystem.FileSystem; path: Path.Path };

/**
 * `overridden` marks a bundled root supplied by `STACKS_REGISTRY_DIR` for `trustOf`. `remote`
 * opts into index resolution.
 */
export type RegistryRoot = { origin: Origin; path: string; overridden?: boolean; remote?: boolean };

/**
 * What loading passed over without an entry or a rejection: an entry whose `schema_version` is
 * newer than this CLI reads (a lower origin's copy may win instead), or a project root or its
 * `stacks/` or `fragments/` that is a symlink, with everything under it.
 */
export type Skipped =
  | { reason: "newer"; origin: Origin; kind: Kind; id: string; dir: string; version: number }
  | { reason: "symlink"; origin: Origin; dir: string };

/**
 * Why a directory was rejected. `unreadable` becomes `PermissionDenied` when the entry is asked
 * for; every other reason becomes `EntryInvalid` with that reason in its details.
 */
export type Reason = "decode" | "symlink" | "id_mismatch" | "missing" | "unreadable";

export type Rejection = { rejected: RejectedEntry; reason: Reason; path?: string };

/** An entry as read from one root, before precedence decides its shadows and trust. */
export type Found = Omit<Entry, "shadows" | "trusted">;

export type Candidate =
  | { _tag: "Entry"; entry: Found }
  | { _tag: "Rejected"; rejection: Rejection };

export type RootCandidate = { root: RegistryRoot; candidate: Candidate };

export type Walked =
  | {
      _tag: "Files";
      files: ReadonlyArray<{ rel: string; mode: number }>;
      directories: ReadonlyArray<string>;
    }
  | { _tag: "Link"; rel: string };
