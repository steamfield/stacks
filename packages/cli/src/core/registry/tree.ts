/**
 * Reads the files inside one entry directory without ever following a symlink.
 *
 * An entry is a directory of text and files that `stacks new` and `stacks add` copy into a
 * project, and a registry root may come from a checkout the user doesn't control. A symlink inside
 * an entry could point anywhere on the machine (the user's SSH keys, `/`), so every name here is
 * `lstat`ed before anything reads or descends into it, and the first symlink stops the read with
 * an `EntryInvalid` failure.
 *
 * `load.ts` uses `walkEntry` for the per-entry deep check that `get`, `files`, `tree`, `read`,
 * `bytes` and `all` run. `registry.ts` uses `entryTree` for `Registry.tree` and `Registry.files`,
 * and `readEntryFile` for `Registry.read` and `Registry.bytes`.
 */
import { shippedPath } from "@steamfield/stacks-format";
import { Effect, type PlatformError } from "effect";
import { EntryInvalid, PermissionDenied } from "../../errors";
import type { Entry, EntryFile } from "./entry";
import type { FileAccess, Walked } from "./types";

/**
 * Whether a filesystem failure means "nothing there". `BadResource` (ENOTDIR, a file where a
 * directory was expected) counts too; any other reason means the CLI couldn't look.
 */
export const isAbsent = (error: PlatformError.PlatformError) =>
  error.reason._tag === "NotFound" || error.reason._tag === "BadResource";

/** One name inside an entry: a symlink stops the walk, a directory is walked in turn. */
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
 * Regular files and directories under `dir` (or under `dir/rel`), depth first by sorted name,
 * stopping at the first symlink. Each name is lstat'ed before anything descends into it, so a link
 * is never followed.
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

/**
 * The files an entry ships into a project, sorted by `source`: each tree file that maps to a
 * project path. Stack overlays belong only to fragments and payloads only to stacks, so a
 * misplaced one is left out here; validate reports it.
 */
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
 * Reads one file of an entry by its entry-relative `source`. It `lstat`s the entry directory and
 * every prefix of `source` down to the file first, so a symlink anywhere is `EntryInvalid`
 * (`symlink`) and nothing behind it is read. An empty, `.` or `..` segment, or a missing file, is
 * `EntryInvalid` (`missing`); any other failure is `PermissionDenied` naming the path.
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
