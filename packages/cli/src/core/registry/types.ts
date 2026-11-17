/** Owns the loading and tree-walk types to keep registry dependencies one-way. */
import type { Kind } from "@steamfield/stacks-format";
import type { FileSystem, Path } from "effect";
import type { Origin } from "./entry";

export type FileAccess = { fs: FileSystem.FileSystem; path: Path.Path };

export type RegistryRoot =
  | { origin: Exclude<Origin, "index">; path: string; trusted: boolean }
  | IndexRegistryRoot;

export type IndexRegistryRoot = {
  readonly origin: "index";
  readonly url: string;
  readonly trusted: boolean;
};

export type LocalRegistryRoot = Exclude<RegistryRoot, IndexRegistryRoot>;

/**
 * What loading passed over without an entry or a rejection: an entry whose `schema_version` is
 * newer than this CLI reads (a lower origin's copy may win instead), or a project root or its
 * `stacks/` or `fragments/` that is a symlink, with everything under it.
 */
export type Skipped =
  | { reason: "newer"; origin: Origin; kind: Kind; id: string; dir: string; version: number }
  | { reason: "symlink"; origin: Origin; dir: string };

export type Walked =
  | {
      _tag: "Files";
      files: ReadonlyArray<{ rel: string; mode: number }>;
      directories: ReadonlyArray<string>;
    }
  | { _tag: "Link"; rel: string };
