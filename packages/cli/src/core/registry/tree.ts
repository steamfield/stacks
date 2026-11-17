/**
 * Reads and walks entry trees. Link checks keep a registry checkout from redirecting a read
 * anywhere on the machine.
 */
import { shippedPath } from "@steamfield/stacks-format";
import { Effect, type PlatformError } from "effect";
import { EntryInvalid, PermissionDenied } from "../../errors";
import { isAbsent } from "../absent";
import type { Entry, EntryFile } from "./entry";
import type { FileAccess, Walked } from "./types";

const walkChild = (
  io: FileAccess,
  dir: string,
  at: string,
): Effect.Effect<Walked, PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const info = yield* io.fs.lstat(io.path.join(dir, at));
    if (info.type === "SymbolicLink") return { _tag: "Link", rel: at } as const;
    if (info.type === "Directory") {
      const inner = yield* walkEntry(io, dir, at);
      if (inner._tag === "Link") return inner;
      return { ...inner, directories: [at, ...inner.directories] };
    }
    // Sockets, FIFOs and devices are neither shipped nor refused.
    return {
      _tag: "Files",
      directories: [],
      files: info.type === "File" ? [{ rel: at, mode: info.mode & 0o777 }] : [],
    } as const;
  });

/**
 * Start from an already checked directory and walk its regular files and directories depth
 * first by sorted name. Return the first symlink as a value so loading can report a rejection.
 */
export const walkEntry = (
  io: FileAccess,
  dir: string,
  rel = "",
): Effect.Effect<Walked, PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const files: Array<{ rel: string; mode: number }> = [];
    const directories: string[] = [];
    const names = yield* io.fs.readDirectory(rel ? io.path.join(dir, rel) : dir);
    for (const name of [...names].sort()) {
      const child = yield* walkChild(io, dir, rel ? `${rel}/${name}` : name);
      if (child._tag === "Link") return child;
      directories.push(...child.directories);
      files.push(...child.files);
    }
    return { _tag: "Files", files, directories } as const;
  });

/** The whole entry tree for `Registry.tree`: an unreadable directory is `PermissionDenied`. */
export const entryTree = (io: FileAccess, entry: Entry) =>
  Effect.gen(function* () {
    const walked = yield* walkEntry(io, entry.dir).pipe(
      Effect.mapError(() => new PermissionDenied({ details: { reason: "read", path: entry.dir } })),
    );
    if (walked._tag === "Link")
      return yield* new EntryInvalid({
        details: { id: entry.id, origin: entry.origin, reason: "symlink", path: walked.rel },
      });
    return {
      directories: walked.directories,
      files: walked.files.map(({ rel, mode }) => ({ source: rel, mode })),
    };
  });

/** Exclude overlays on stacks and payloads on fragments, which validation reports. */
export function shippedFiles(
  entry: Pick<Entry, "kind">,
  files: ReadonlyArray<{ source: string; mode: number }>,
): Array<EntryFile> {
  const misplaced = entry.kind === "stack" ? "stack" : "payload";
  return files
    .flatMap(({ source, mode }) => {
      const shipped = shippedPath(source);
      return shipped && shipped.condition?.kind !== misplaced
        ? [{ source, path: shipped.path, mode }]
        : [];
    })
    .sort((a, b) => (a.source < b.source ? -1 : 1));
}

/**
 * Check every path prefix, including the entry directory, without following links. Report
 * `EntryInvalid` with `missing` for absent files and invalid segments, or `symlink` for links.
 * Other failures are `PermissionDenied`.
 */
export const readEntryFile = <A>(
  io: FileAccess,
  entry: Entry,
  source: string,
  read: (file: string) => Effect.Effect<A, PlatformError.PlatformError>,
) =>
  Effect.gen(function* () {
    const invalid = (reason: "symlink" | "missing", at: string) =>
      new EntryInvalid({ details: { id: entry.id, origin: entry.origin, reason, path: at } });
    const denied = (at: string) => new PermissionDenied({ details: { reason: "read", path: at } });
    const segments = source.split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === ".."))
      return yield* invalid("missing", source);
    for (let depth = 0; depth <= segments.length; depth++) {
      const rel = segments.slice(0, depth).join("/") || ".";
      const at = io.path.join(entry.dir, rel);
      const info = yield* io.fs
        .lstat(at)
        .pipe(
          Effect.mapError((error) => (isAbsent(error) ? invalid("missing", source) : denied(at))),
        );
      if (info.type === "SymbolicLink") return yield* invalid("symlink", rel);
    }
    const file = io.path.join(entry.dir, source);
    return yield* read(file).pipe(
      Effect.mapError((error) => (isAbsent(error) ? invalid("missing", source) : denied(file))),
    );
  });
