/**
 * Owns project file writes through `openProject`. The writer is a closure so its operations share
 * the state that its scope finalizer uses to roll back.
 */
import { rmdir } from "node:fs/promises";
import { Effect, Exit, FileSystem, Option, Path, type PlatformError, type Scope } from "effect";
import { PermissionDenied, TargetNotEmpty } from "../../errors";
import { Invocation } from "../../services/invocation";
import { isAbsent } from "../fs/absent";

/**
 * Exclusive creates and resolved-path checks constrain symlink escapes. A concurrent directory
 * swap can still put a file outside the root, and cleanup on detection is best effort. Closing
 * that race requires `openat`-style calls that Effect's filesystem API lacks.
 */
export type ProjectWriter = {
  /** The resolved real path used for containment checks. */
  readonly root: string;
  /** Creates `rel`; true adds execute bits for read bits, a number preserves ordinary mode bits. */
  readonly write: (
    rel: string,
    data: Uint8Array,
    permissions?: boolean | number,
  ) => Effect.Effect<void, PermissionDenied | TargetNotEmpty>;
  /** Replaces a file this writer created, with the same checks. */
  readonly replace: (rel: string, data: Uint8Array) => Effect.Effect<void, PermissionDenied>;
  /**
   * Rewrites an existing regular file, retaining its original bytes and mode for rollback.
   * `backupByRename` backs it up without a read and uses normal permissions for the replacement.
   */
  readonly rewrite: (
    rel: string,
    data: Uint8Array,
    options?: { backupByRename: true },
  ) => Effect.Effect<void, PermissionDenied>;
  readonly directory: (rel: string) => Effect.Effect<void, PermissionDenied | TargetNotEmpty>;
  /**
   * Hands a directory the CLI's own process is about to create (git's `.git`) to the rollback,
   * which removes it whole.
   */
  readonly adopt: (rel: string) => Effect.Effect<void>;
  /**
   * Removes an adopted directory now, with the rollback's checks, and stops tracking it: for a
   * `git init` that failed after creating part of its `.git`.
   */
  readonly discard: (rel: string) => Effect.Effect<void>;
};

type Backup = { bytes: Uint8Array; mode: number } | { movedTo: string };

const unwritable = (at: string) =>
  new PermissionDenied({ details: { reason: "unwritable", path: at } });

const escapes = (at: string) => new PermissionDenied({ details: { reason: "escape", path: at } });

const isAlreadyExists = (error: PlatformError.PlatformError) =>
  error.reason._tag === "AlreadyExists";

const failedAsExisting = (exit: Exit.Exit<void, PlatformError.PlatformError>) =>
  Exit.isFailure(exit) &&
  exit.cause.reasons.some((reason) => reason._tag === "Fail" && isAlreadyExists(reason.error));

/** Reject absolute and traversal paths before resolving links or touching the filesystem. */
function segments(rel: string): ReadonlyArray<string> | undefined {
  if (rel.startsWith("/")) return undefined;
  const parts = rel.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return undefined;
  return parts;
}

/** A mode's permission bits with an execute bit added wherever a read bit is set. */
const withExecuteBits = (mode: number) => (mode & 0o777) | ((mode & 0o444) >> 2);

/** Whether `path` is `root` or under it; both are real paths. */
export function within(root: string, path: string, separator: string): boolean {
  return path === root || path.startsWith(root.endsWith(separator) ? root : root + separator);
}

/**
 * Removes `dir` only if it is an empty directory, in one system call. Effect's FileSystem has no
 * `rmdir` (its `remove` refuses a directory unless it recurses), and checking for emptiness first
 * would leave a window in which a file added to it would be deleted with it.
 */
const removeEmptyDirectory = (dir: string) => Effect.ignore(Effect.tryPromise(() => rmdir(dir)));

/**
 * Track the directory and any missing parents so the scope can undo writes on failure or
 * interruption.
 */
export function openProject(
  dir: string,
): Effect.Effect<ProjectWriter, PermissionDenied, FileSystem.FileSystem | Path.Path | Scope.Scope>;
export function openProject(
  dir: string,
  options: { exclusive: true },
): Effect.Effect<
  ProjectWriter,
  PermissionDenied | TargetNotEmpty,
  FileSystem.FileSystem | Path.Path | Scope.Scope
>;
export function openProject(
  dir: string,
  options?: { exclusive: true },
): Effect.Effect<
  ProjectWriter,
  PermissionDenied | TargetNotEmpty,
  FileSystem.FileSystem | Path.Path | Scope.Scope
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const invocation = yield* Effect.serviceOption(Invocation);
    const exclusive = options?.exclusive === true;

    // What the rollback undoes, each list in creation order. Rollback restores the backups, then
    // removes the files, then the directories git made, then the directories made under the root,
    // then the root and the parents made for it, each list newest first.
    const files: string[] = [];
    const backups = new Map<string, Backup>();
    const adopted: string[] = [];
    const dirs: string[] = [];
    const chain: string[] = [];
    // Empty until the root exists and resolves. A rollback before then finds nothing inside it,
    // so it only removes the root and parents in `chain`.
    let root = "";

    const isInside = (at: string) =>
      fs.realPath(at).pipe(
        Effect.map((real) => root !== "" && within(root, real, path.sep)),
        Effect.orElseSucceed(() => false),
      );
    /** A path is only removed while its parent still resolves inside the project. */
    const inside = (at: string) => isInside(path.dirname(at));
    const isDirectory = (at: string) =>
      fs.lstat(at).pipe(
        Effect.map((info) => info.type === "Directory"),
        Effect.orElseSucceed(() => false),
      );
    const removeAdopted = (adoptedDir: string) =>
      Effect.gen(function* () {
        if ((yield* isDirectory(adoptedDir)) && (yield* inside(adoptedDir)))
          yield* Effect.ignore(fs.remove(adoptedDir, { recursive: true }));
      });

    const stageReplacement = Effect.fnUntraced(function* (
      staged: string,
      bytes: Uint8Array,
      mode: number | undefined,
    ) {
      yield* fs.writeFile(staged, bytes, { flag: "wx" });
      if (mode !== undefined) yield* fs.chmod(staged, mode & 0o777);
    });

    /**
     * Stages `bytes` in a temporary directory beside `file` and renames it over the file.
     * Replacing the directory entry keeps a hard-linked parked file from changing live bytes.
     */
    const atomicReplace = (file: string, bytes: Uint8Array, mode?: number) =>
      Effect.scoped(
        Effect.gen(function* () {
          const temporary = yield* fs.makeTempDirectoryScoped({
            directory: path.dirname(file),
            prefix: ".stacks-",
          });
          if (!(yield* isInside(temporary))) return yield* escapes(file);
          const staged = path.join(temporary, "replacement");
          yield* stageReplacement(staged, bytes, mode);
          if (!(yield* inside(file))) return yield* escapes(file);
          yield* fs.rename(staged, file);
          if (!(yield* inside(file))) return yield* escapes(file);
        }),
      ).pipe(Effect.catchTag("PlatformError", () => Effect.fail(unwritable(file))));

    const restoreMovedBackup = Effect.fn("project.restoreMovedBackup")(function* (
      file: string,
      backup: string,
    ) {
      const type = yield* directoryType(file);
      if (type !== "File" && type !== "Missing") return false;
      if (!(yield* inside(backup))) return false;
      yield* fs.rename(backup, file);
      yield* removeEmptyDirectory(path.dirname(backup));
      return true;
    });

    const restoreBackup = (file: string, backup: Backup) =>
      Effect.gen(function* () {
        if ("movedTo" in backup) {
          if (!(yield* inside(file))) return false;
          return yield* restoreMovedBackup(file, backup.movedTo);
        }
        const info = yield* fs.lstat(file);
        if (info.type !== "File" || !(yield* inside(file))) return false;
        yield* atomicReplace(file, backup.bytes, backup.mode);
        return true;
      });
    // Continue on restore failure and give `Invocation.rollbackIncomplete` the path for the envelope.
    const restoreBackups = Effect.gen(function* () {
      for (const [file, backup] of backups) {
        const restored = yield* Effect.exit(restoreBackup(file, backup));
        if (Exit.isSuccess(restored) && restored.value) continue;
        if (invocation._tag === "Some") yield* invocation.value.rollbackIncomplete(file);
      }
    });
    const removeMovedBackups = Effect.gen(function* () {
      for (const backup of backups.values()) {
        if (!("movedTo" in backup) || !(yield* inside(backup.movedTo))) continue;
        yield* Effect.ignore(fs.remove(backup.movedTo));
        yield* removeEmptyDirectory(path.dirname(backup.movedTo));
      }
    });
    const removeDirectories = Effect.gen(function* () {
      // Only an empty directory goes: anything else in it isn't ours.
      for (const created of [...dirs].reverse())
        if ((yield* isDirectory(created)) && (yield* inside(created)))
          yield* removeEmptyDirectory(created);
      // The root and the parents made for it sit outside the root by definition.
      for (const created of [...chain].reverse())
        if (yield* isDirectory(created)) yield* removeEmptyDirectory(created);
    });
    const rollback = Effect.gen(function* () {
      yield* restoreBackups;
      for (const file of [...files].reverse())
        if (yield* inside(file)) yield* Effect.ignore(fs.remove(file));
      for (const adoptedDir of [...adopted].reverse()) yield* removeAdopted(adoptedDir);
      yield* removeDirectories;
    });
    // Registered before the first write, so every write below is covered.
    yield* Effect.addFinalizer((exit) => (Exit.isSuccess(exit) ? removeMovedBackups : rollback));

    const targetExists = (absolute: string) =>
      new TargetNotEmpty({ details: { path: absolute, entries: [] } });

    /** Return missing parents top down. Exclusive opens refuse an existing root. */
    const missingAncestors = (absolute: string) =>
      Effect.gen(function* () {
        const missing: string[] = [];
        let at = absolute;
        while (Option.isNone(yield* Effect.option(fs.lstat(at)))) {
          missing.unshift(at);
          if (path.dirname(at) === at) return missing;
          at = path.dirname(at);
        }
        if (exclusive && at === absolute) return yield* targetExists(absolute);
        return missing;
      });
    /** Creates one root or parent directory and tracks it in the same uninterruptible step. */
    const createAncestor = (at: string, absolute: string) =>
      Effect.uninterruptible(
        fs.makeDirectory(at).pipe(
          Effect.mapError((error) =>
            exclusive && at === absolute && isAlreadyExists(error)
              ? targetExists(absolute)
              : unwritable(at),
          ),
          Effect.tap(() => Effect.sync(() => chain.push(at))),
        ),
      );

    const absolute = path.resolve(dir);
    for (const at of yield* missingAncestors(absolute)) yield* createAncestor(at, absolute);
    root = yield* fs.realPath(absolute).pipe(Effect.mapError(() => unwritable(absolute)));

    const checkDirectoryInside = (at: string, rel: string) =>
      Effect.gen(function* () {
        if (!(yield* isInside(at))) return yield* escapes(path.join(root, rel));
      });
    const createDirectory = (at: string, rel: string) =>
      Effect.gen(function* () {
        yield* fs
          .makeDirectory(at)
          .pipe(
            Effect.mapError((error) =>
              isAlreadyExists(error)
                ? new TargetNotEmpty({ details: { path: root, entries: [rel] } })
                : unwritable(at),
            ),
          );
        dirs.push(at);
        yield* checkDirectoryInside(at, rel);
      });
    const directoryType = (at: string) =>
      fs.lstat(at).pipe(
        Effect.map((value) => value.type),
        Effect.catch((error) =>
          isAbsent(error) ? Effect.succeed("Missing" as const) : Effect.fail(unwritable(at)),
        ),
      );
    /** Creates `at` if missing; a symlink must resolve inside the root, a file is in the way. */
    const ensureDirectory = (at: string, rel: string) =>
      Effect.gen(function* () {
        const type = yield* directoryType(at);
        if (type === "Missing") return yield* createDirectory(at, rel);
        if (type === "SymbolicLink") return yield* checkDirectoryInside(at, rel);
        if (type !== "Directory")
          return yield* new TargetNotEmpty({
            details: { path: root, entries: [path.relative(root, at)] },
          });
      });

    /**
     * Resolve existing links before descending and check each new directory before writing beneath
     * it.
     */
    const ensure = (parts: ReadonlyArray<string>, rel: string) =>
      Effect.gen(function* () {
        let at = root;
        for (const part of parts) {
          at = path.join(at, part);
          yield* ensureDirectory(at, rel);
        }
        const real = yield* fs.realPath(at).pipe(Effect.mapError(() => unwritable(at)));
        if (!within(root, real, path.sep)) return yield* escapes(path.join(root, rel));
      });

    const writeExclusive = (file: string, rel: string, data: Uint8Array) =>
      // `wx`: never over an existing file, and never through a symlink in the last segment.
      fs.writeFile(file, data, { flag: "wx" }).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            // Even cancelled I/O may already have created bytes. Track it in the finalizer,
            // which also runs when an adapter restores interruption inside the mutation.
            if (!failedAsExisting(exit)) files.push(file);
          }),
        ),
        Effect.mapError((error) =>
          isAlreadyExists(error)
            ? new TargetNotEmpty({ details: { path: root, entries: [rel] } })
            : unwritable(file),
        ),
      );

    /** `false` leaves the mode alone, a number sets it, `true` adds execute bits. */
    const setPermissions = (file: string, permissions: boolean | number) =>
      Effect.gen(function* () {
        if (permissions === false) return;
        let mode: number;
        if (typeof permissions === "number") mode = permissions & 0o777;
        else
          mode = yield* fs.stat(file).pipe(
            Effect.map((info) => withExecuteBits(info.mode)),
            Effect.mapError(() => unwritable(file)),
          );
        yield* fs.chmod(file, mode).pipe(Effect.mapError(() => unwritable(file)));
      });

    // Finish each filesystem mutation and its tracking together. An interrupted async write
    // can otherwise finish after rollback has already run and leave an untracked file behind.
    const create = (rel: string, data: Uint8Array, permissions: boolean | number) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const parts = segments(rel);
          if (!parts) return yield* escapes(rel);
          yield* ensure(parts.slice(0, -1), rel);
          const file = path.join(root, ...parts);
          yield* writeExclusive(file, rel, data);
          // The parent was checked before the write; if it has moved out of the project since, the
          // file landed outside. It is ours (created exclusively), so take it back and refuse.
          if (!(yield* inside(file))) {
            yield* Effect.ignore(fs.remove(file));
            return yield* escapes(path.join(root, rel));
          }
          yield* setPermissions(file, permissions);
        }),
      );

    /** Untrack the removed file before creating its replacement so rollback tracks the new write. */
    const replaceCreated = (rel: string, data: Uint8Array) =>
      Effect.gen(function* () {
        const parts = segments(rel);
        if (!parts) return yield* escapes(rel);
        const file = path.join(root, ...parts);
        if (!files.includes(file)) return yield* escapes(rel);
        yield* fs.remove(file).pipe(Effect.mapError(() => unwritable(file)));
        files.splice(files.indexOf(file), 1);
        yield* create(rel, data, false).pipe(
          Effect.catchTag("TargetNotEmpty", () => Effect.fail(unwritable(file))),
        );
      });

    /** Move within the same filesystem, into a private directory nobody else can already own. */
    const moveBackup = Effect.fn("project.moveBackup")(function* (file: string) {
      const dir = yield* fs
        .makeTempDirectory({
          directory: path.dirname(file),
          prefix: `.${path.basename(file)}.bak-`,
        })
        .pipe(Effect.mapError(() => unwritable(file)));
      const movedTo = path.join(dir, "original");
      if (!(yield* isInside(dir))) return yield* escapes(file);
      yield* fs.rename(file, movedTo).pipe(
        Effect.mapError(() => unwritable(file)),
        Effect.onError(() => removeEmptyDirectory(dir)),
      );
      backups.set(file, { movedTo });
    });

    const backupOriginal = Effect.fnUntraced(function* (
      file: string,
      mode: number,
      options: Parameters<ProjectWriter["rewrite"]>[2],
    ) {
      if (backups.has(file) || files.includes(file)) return;
      if (options?.backupByRename) return yield* moveBackup(file);
      const bytes = yield* fs.readFile(file).pipe(Effect.mapError(() => unwritable(file)));
      backups.set(file, { bytes, mode });
    });

    /** Back up an existing file only on its first rewrite, unless rollback already removes it. */
    const rewriteExisting = (rel: string, data: Uint8Array, options?: { backupByRename: true }) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const parts = segments(rel);
          if (!parts) return yield* escapes(rel);
          yield* ensure(parts.slice(0, -1), rel).pipe(
            Effect.catchTag("TargetNotEmpty", () => Effect.fail(unwritable(rel))),
          );
          const file = path.join(root, ...parts);
          const info = yield* fs.lstat(file).pipe(Effect.mapError(() => unwritable(file)));
          if (info.type !== "File") return yield* escapes(file);
          yield* backupOriginal(file, info.mode, options);
          yield* atomicReplace(file, data, options?.backupByRename ? undefined : info.mode);
        }),
      );

    const createDirectoryPath = (rel: string) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const parts = segments(rel);
          if (!parts) return yield* escapes(rel);
          yield* ensure(parts, rel);
        }),
      );

    const adopt = (rel: string) =>
      Effect.sync(() => {
        adopted.push(path.join(root, rel));
      });

    const discard = (rel: string) =>
      Effect.gen(function* () {
        const adoptedDir = path.join(root, rel);
        if (!adopted.includes(adoptedDir)) return;
        adopted.splice(adopted.indexOf(adoptedDir), 1);
        yield* removeAdopted(adoptedDir);
      });

    return {
      root,
      write: (rel, data, permissions = false) => create(rel, data, permissions),
      replace: replaceCreated,
      rewrite: rewriteExisting,
      directory: createDirectoryPath,
      adopt,
      discard,
    } satisfies ProjectWriter;
  });
}
