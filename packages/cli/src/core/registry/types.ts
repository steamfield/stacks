/**
 * The shapes the registry's loading modules pass between each other while they read entry
 * directories from disk. Nothing outside `core/registry/` needs these, except `Skipped`, which
 * `registry.ts` re-exports for `validate`.
 *
 * A candidate is what one entry directory turned into after loading: a usable entry or a
 * rejection (the directory is there but broken, with the reason). `registry.ts` collects every
 * root's candidates per kind and id, and the first root's candidate wins. Keeping the types here
 * lets `load.ts`, `tree.ts` and `registry.ts` import in one direction.
 */
import type { Kind } from "@steamfield/stacks-format";
import type { FileSystem, Path } from "effect";
import type { Entry, Origin, RejectedEntry } from "./entry";

/** The filesystem and path services, passed together to the module-level loading steps. */
export type FileAccess = { fs: FileSystem.FileSystem; path: Path.Path };

/**
 * One registry root. `overridden` marks a bundled root set by STACKS_REGISTRY_DIR instead of
 * the one shipped with the CLI, whose entries are untrusted. `remote` turns on the signed index.
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

/** A rejected entry plus what `get` needs to report it: the reason and the entry-relative path. */
export type Rejection = { rejected: RejectedEntry; reason: Reason; path?: string };

/** An entry as read from one root, before precedence decides its shadows and trust. */
export type Found = Omit<Entry, "shadows" | "trusted">;

export type Candidate =
  | { _tag: "Entry"; entry: Found }
  | { _tag: "Rejected"; rejection: Rejection };

/** A candidate and the root it was read from, kept in root order per kind and id. */
export type RootCandidate = { root: RegistryRoot; candidate: Candidate };

/** Every regular file and directory under an entry, or the first symlink met. */
export type Walked =
  | {
      _tag: "Files";
      files: ReadonlyArray<{ rel: string; mode: number }>;
      directories: ReadonlyArray<string>;
    }
  | { _tag: "Link"; rel: string };
