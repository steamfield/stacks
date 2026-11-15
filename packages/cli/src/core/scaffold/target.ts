/**
 * The empty-target rule for `new`: which directories it may scaffold into, and what an earlier
 * scaffold left in one it refuses.
 */
import { Effect, FileSystem, Option, Path } from "effect";
import { PermissionDenied, TargetNotEmpty } from "../../errors";
import { METADATA_DIR } from "../../project-layout";
import { MANIFEST_PATH, readManifest } from "../manifest";
import { readProjectState } from "../project-state";

/** Files an OS drops into any directory a person opened: treated as absent, left alone. */
const isLitter = (name: string) =>
  name === ".DS_Store" || name === "Thumbs.db" || name === "desktop.ini" || name.startsWith("._");

/** At most this many names are listed when a target isn't empty. */
const LISTED_ENTRIES = 10;

export type Target = {
  /** Absolute. */
  path: string;
  exists: boolean;
  /** It holds a `.git` (a directory or a gitfile), and nothing else but litter. */
  git: boolean;
  /** The target if it exists, else its nearest existing parent: where git is asked about it. */
  nearest: string;
};

/**
 * What an earlier `new` left at `manifestPath`: nothing (no manifest), `green` when the state
 * record for its project id has `firstGreenAt`, else `unfinished` (no record, or a manifest that
 * can't be read or decoded).
 */
const scaffoldOf = (manifestPath: string) =>
  readManifest(manifestPath).pipe(
    Effect.flatMap((manifest) => readProjectState(manifest.projectId)),
    Effect.map((state) => (state?.firstGreenAt ? ("green" as const) : ("unfinished" as const))),
    Effect.catchTag("NotFound", () => Effect.succeed(undefined)),
    Effect.orElseSucceed(() => "unfinished" as const),
  );

const notEmpty = (dir: string, entries: ReadonlyArray<string>, scaffold?: "unfinished" | "green") =>
  new TargetNotEmpty({
    details: { path: dir, entries: [...entries], ...(scaffold ? { scaffold } : {}) },
  });

/** A target that doesn't exist yet: usable when its nearest existing ancestor is a directory. */
const inspectMissingTarget = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const exists = (at: string) => Effect.map(Effect.option(fs.lstat(at)), Option.isSome);
    let nearest = path.dirname(dir);
    while (!(yield* exists(nearest)) && path.dirname(nearest) !== nearest)
      nearest = path.dirname(nearest);
    // Stop at links too: a dangling link cannot become a parent directory for the writer.
    const ancestor = yield* Effect.option(fs.stat(nearest));
    if (ancestor._tag === "None" || ancestor.value.type !== "Directory")
      return yield* notEmpty(dir, []);
    return { path: dir, exists: false, git: false, nearest } satisfies Target;
  });

/**
 * Checks `dir` before anything is written: missing, empty, `.git`-only and litter-only are usable;
 * anything else is `TargetNotEmpty` with up to ten names (sorted, litter excluded). A path that
 * exists but isn't a directory (including a dangling symlink), or has a non-directory ancestor,
 * is `TargetNotEmpty` with no names.
 */
export const inspectTarget = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const present = yield* Effect.option(fs.lstat(dir));
    if (present._tag === "None") return yield* inspectMissingTarget(dir);
    const info = yield* Effect.option(fs.stat(dir));
    if (info._tag === "None" || info.value.type !== "Directory") return yield* notEmpty(dir, []);
    const names = yield* fs
      .readDirectory(dir)
      .pipe(
        Effect.mapError(() => new PermissionDenied({ details: { reason: "read", path: dir } })),
      );
    const other = names.filter((name) => name !== ".git" && !isLitter(name)).sort();
    if (other.length) {
      // A `.stacks/` among them means an earlier scaffold; say how far it got.
      const scaffold = other.includes(METADATA_DIR)
        ? yield* scaffoldOf(path.join(dir, MANIFEST_PATH))
        : undefined;
      return yield* notEmpty(dir, other.slice(0, LISTED_ENTRIES), scaffold);
    }
    return { path: dir, exists: true, git: names.includes(".git"), nearest: dir } satisfies Target;
  });
