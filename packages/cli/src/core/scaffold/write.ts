import { rmdir } from "node:fs/promises";
import { Effect, Exit, FileSystem, Path, type PlatformError, type Scope } from "effect";
import { PermissionDenied, TargetNotEmpty } from "../../errors";
import { Invocation } from "../../services/invocation";

/**
 * The one way `new` and `add` write into a project. Every file is created exclusively (never over an existing file or through a final
 * symlink). On the way down, every symlinked directory is resolved and every directory created is
 * checked before anything is made beneath it, so nothing is created outside the project root's
 * real path. After each file is written its parent's real path is checked again, and a file whose
 * parent has moved out of the project is removed and refused.
 *
 * That narrows a race but doesn't close it: a process that swaps a directory for a symlink
 * between the last check and the write can still land one exclusive-create file outside the
 * project for as long as it takes to notice and remove it. Without `openat`-style calls (which
 * Effect's FileSystem doesn't offer) no path-based writer can do better.
 *
 * Everything it creates is tracked, and a scope finalizer removes it when the scope closes with a
 * failure or an interruption, so a failed `new` leaves no half project.
 */
export type ProjectWriter = {
  /** The project root's real path. */
  readonly root: string;
  /** Creates `rel`; true adds execute bits for read bits, a number preserves ordinary mode bits. */
  readonly write: (
    rel: string,
    data: Uint8Array,
    permissions?: boolean | number,
  ) => Effect.Effect<void, PermissionDenied | TargetNotEmpty>;
  /** Replaces a file this writer created, with the same checks. */
  readonly replace: (rel: string, data: Uint8Array) => Effect.Effect<void, PermissionDenied>;
  /** Rewrites an existing regular file, retaining its original bytes for rollback. */
  readonly rewrite: (rel: string, data: Uint8Array) => Effect.Effect<void, PermissionDenied>;
  /** Creates a directory (and its parents) under the root. */
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

const missing = (error: PlatformError.PlatformError) =>
  error.reason._tag === "NotFound" || error.reason._tag === "BadResource";

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
 * Opens `dir` for writing, creating it and any missing parents (tracked for rollback), and
 * resolves its real path. The finalizer it adds to the current scope undoes every tracked write
 * unless the scope closes successfully.
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
    const unwritable = (at: string) =>
      new PermissionDenied({ details: { reason: "unwritable", path: at } });
    const escapes = (at: string) =>
      new PermissionDenied({ details: { reason: "escape", path: at } });

    /**
     * Files, then whole directories git made, then directories under the root, then the root and
     * the parents created for it, each in creation order.
     */
    const files: string[] = [];
    const backups = new Map<string, { bytes: Uint8Array; mode: number }>();
    const adopted: string[] = [];
    const dirs: string[] = [];
    const chain: string[] = [];
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
    const removeAdopted = (dir: string) =>
      Effect.gen(function* () {
        if ((yield* isDirectory(dir)) && (yield* inside(dir)))
          yield* Effect.ignore(fs.remove(dir, { recursive: true }));
      });

    // Replacing the directory entry keeps a hard-linked parked file from changing live bytes.
    const atomicReplace = (file: string, bytes: Uint8Array, mode: number) =>
      Effect.scoped(
        Effect.gen(function* () {
          const temporary = yield* fs.makeTempDirectoryScoped({
            directory: path.dirname(file),
            prefix: ".stacks-",
          });
          if (!(yield* isInside(temporary))) return yield* escapes(file);
          const staged = path.join(temporary, "replacement");
          yield* fs.writeFile(staged, bytes, { flag: "wx" });
          yield* fs.chmod(staged, mode & 0o777);
          if (!(yield* inside(file))) return yield* escapes(file);
          yield* fs.rename(staged, file);
          if (!(yield* inside(file))) return yield* escapes(file);
        }),
      ).pipe(Effect.catchTag("PlatformError", () => Effect.fail(unwritable(file))));

    const restoreBackups = Effect.gen(function* () {
      for (const [file, backup] of backups) {
        const restored = yield* Effect.exit(
          Effect.gen(function* () {
            const info = yield* fs.lstat(file);
            if (info.type !== "File" || !(yield* inside(file))) return false;
            yield* atomicReplace(file, backup.bytes, backup.mode);
            return true;
          }),
        );
        if ((Exit.isFailure(restored) || !restored.value) && invocation._tag === "Some")
          yield* invocation.value.rollbackIncomplete(file);
      }
    });
    const removeDirectories = Effect.gen(function* () {
      // Only an empty directory goes: anything else in it isn't ours.
      for (const dir of [...dirs].reverse())
        if ((yield* isDirectory(dir)) && (yield* inside(dir))) yield* removeEmptyDirectory(dir);
      // The root and the parents made for it sit outside the root by definition.
      for (const dir of [...chain].reverse())
        if (yield* isDirectory(dir)) yield* removeEmptyDirectory(dir);
    });
    const rollback = Effect.gen(function* () {
      yield* restoreBackups;
      for (const file of [...files].reverse())
        if (yield* inside(file)) yield* Effect.ignore(fs.remove(file));
      for (const dir of [...adopted].reverse()) yield* removeAdopted(dir);
      yield* removeDirectories;
    });
    yield* Effect.addFinalizer((exit) => (Exit.isSuccess(exit) ? Effect.void : rollback));

    // The root and its missing parents, top down, so each one created is tracked.
    const absolute = path.resolve(dir);
    const missingParents: string[] = [];
    for (let at = absolute; ; at = path.dirname(at)) {
      const info = yield* Effect.option(fs.lstat(at));
      if (info._tag === "Some") {
        if (options?.exclusive && at === absolute)
          return yield* new TargetNotEmpty({ details: { path: absolute, entries: [] } });
        break;
      }
      missingParents.unshift(at);
      if (path.dirname(at) === at) break;
    }
    for (const at of missingParents) {
      yield* Effect.uninterruptible(
        fs.makeDirectory(at).pipe(
          Effect.mapError((error) =>
            options?.exclusive && at === absolute && error.reason._tag === "AlreadyExists"
              ? new TargetNotEmpty({ details: { path: absolute, entries: [] } })
              : unwritable(at),
          ),
          Effect.tap(() => Effect.sync(() => chain.push(at))),
        ),
      );
    }
    root = yield* fs.realPath(absolute).pipe(Effect.mapError(() => unwritable(absolute)));

    /** Splits a project-relative path, refusing anything that could leave the root by name. */
    const segments = (rel: string) => {
      const parts = rel.split("/");
      return rel.startsWith("/") ||
        parts.some((part) => part === "" || part === "." || part === "..")
        ? undefined
        : parts;
    };
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
              error.reason._tag === "AlreadyExists"
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
          missing(error) ? Effect.succeed("Missing" as const) : Effect.fail(unwritable(at)),
        ),
      );
    const ensureDirectory = (at: string, rel: string) =>
      Effect.gen(function* () {
        const info = yield* directoryType(at);
        if (info === "Missing") return yield* createDirectory(at, rel);
        if (info === "SymbolicLink") {
          yield* checkDirectoryInside(at, rel);
          return;
        }
        if (info !== "Directory")
          return yield* new TargetNotEmpty({
            details: { path: root, entries: [path.relative(root, at)] },
          });
      });

    /**
     * Creates the directories down to `parts`. A symlink on the way is resolved before anything
     * is made beneath it, and each directory made is checked right after, so no directory is ever
     * created outside the root.
     */
    const ensure = (parts: ReadonlyArray<string>, rel: string) =>
      Effect.gen(function* () {
        const escaped = escapes(path.join(root, rel));
        let at = root;
        for (const part of parts) {
          at = path.join(at, part);
          yield* ensureDirectory(at, rel);
        }
        const real = yield* fs.realPath(at).pipe(Effect.mapError(() => unwritable(at)));
        if (!within(root, real, path.sep)) return yield* escaped;
      });

    const writeExclusive = (file: string, rel: string, data: Uint8Array) =>
      Effect.gen(function* () {
        // `wx`: never over an existing file, and never through a symlink in the last segment.
        yield* fs.writeFile(file, data, { flag: "wx" }).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              const exists =
                Exit.isFailure(exit) &&
                exit.cause.reasons.some(
                  (reason) =>
                    reason._tag === "Fail" && reason.error.reason._tag === "AlreadyExists",
                );
              // Even cancelled I/O may already have created bytes. Track it in the finalizer,
              // which also runs when an adapter restores interruption inside the mutation.
              if (!exists) files.push(file);
            }),
          ),
          Effect.mapError((error) =>
            error.reason._tag === "AlreadyExists"
              ? new TargetNotEmpty({ details: { path: root, entries: [rel] } })
              : unwritable(file),
          ),
        );
      });

    const setPermissions = (file: string, permissions: boolean | number) =>
      Effect.gen(function* () {
        if (permissions !== false) {
          const mode =
            typeof permissions === "number"
              ? permissions & 0o777
              : yield* fs.stat(file).pipe(
                  Effect.map((info) => (info.mode & 0o777) | ((info.mode & 0o444) >> 2)),
                  Effect.mapError(() => unwritable(file)),
                );
          yield* fs.chmod(file, mode).pipe(Effect.mapError(() => unwritable(file)));
        }
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

    return {
      root,
      write: (rel, data, permissions = false) => create(rel, data, permissions),
      replace: (rel, data) =>
        Effect.gen(function* () {
          const parts = segments(rel);
          const file = parts ? path.join(root, ...parts) : "";
          if (!parts || !files.includes(file)) return yield* escapes(rel);
          yield* fs.remove(file).pipe(Effect.mapError(() => unwritable(file)));
          files.splice(files.indexOf(file), 1);
          yield* create(rel, data, false).pipe(
            Effect.catchTag("TargetNotEmpty", () => Effect.fail(unwritable(file))),
          );
        }),
      rewrite: (rel, data) =>
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
            if (!backups.has(file) && !files.includes(file)) {
              const bytes = yield* fs.readFile(file).pipe(Effect.mapError(() => unwritable(file)));
              backups.set(file, { bytes, mode: info.mode });
            }
            yield* atomicReplace(file, data, info.mode);
          }),
        ),
      directory: (rel) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            const parts = segments(rel);
            if (!parts) return yield* escapes(rel);
            yield* ensure(parts, rel);
          }),
        ),
      adopt: (rel) =>
        Effect.sync(() => {
          adopted.push(path.join(root, rel));
        }),
      discard: (rel) =>
        Effect.gen(function* () {
          const dir = path.join(root, rel);
          if (!adopted.includes(dir)) return;
          adopted.splice(adopted.indexOf(dir), 1);
          yield* removeAdopted(dir);
        }),
    } satisfies ProjectWriter;
  });
}
