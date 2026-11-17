/**
 * Decides whether a scaffold target can be used. For an earlier scaffold, the error reports whether
 * it ever passed verify to help the user decide what to keep.
 */
import { Effect, FileSystem, Option, Path } from "effect";
import { PermissionDenied, TargetNotEmpty } from "../../errors";
import { METADATA_DIR } from "../../project-layout";
import { MANIFEST_PATH, readManifest } from "../manifest";
import { readProjectState } from "../project-state";

/** Files an OS drops into any directory a person opened: treated as absent, left alone. */
const isLitter = (name: string) =>
  name === ".DS_Store" || name === "Thumbs.db" || name === "desktop.ini" || name.startsWith("._");

const LISTED_ENTRIES = 10;

export type Target = {
  path: string;
  exists: boolean;
  /** It holds a `.git` (a directory or a gitfile), and nothing else but litter. */
  git: boolean;
  /** The target if it exists, else its nearest existing parent: where git is asked about it. */
  nearest: string;
};

/**
 * The state record proves whether an earlier scaffold passed verify. A missing manifest gives
 * no scaffold status, while an unreadable manifest or absent proof leaves it unfinished.
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
 * Protect existing work by allowing only missing targets or directories with no contents
 * beyond `.git` and OS litter. A dangling link or non-directory ancestor has no entries to list.
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
      // Keep the failure's list bounded and sorted, with git and litter already filtered out.
      return yield* notEmpty(dir, other.slice(0, LISTED_ENTRIES), scaffold);
    }
    return { path: dir, exists: true, git: names.includes(".git"), nearest: dir } satisfies Target;
  });
