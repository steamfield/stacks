/**
 * Keeps each project's state record: a small JSON file outside the project that `stacks verify`
 * trusts more than anything inside it.
 *
 * The manifest (`.stacks/manifest.json`) sits in the project, where an agent can edit it. So when
 * `stacks new` writes a manifest, `writeProjectState` also writes a second copy of its verify
 * digest to `<state dir>/projects/<projectId>.json` (the state directory is `Paths.state`, under
 * `XDG_STATE_HOME`). Before running any step, `verify/tamper.ts` looks the record up, by project
 * id with `findProjectState` and then by manifest path with `findProjectStateByPath`, and refuses
 * to run steps whose digest no longer matches (Trust model, point 5). The record also stores when
 * the project first went green, which `verify/record.ts` fills in and `runs.ts` reports.
 *
 * Writes go through `replace-file.ts::replaceFile`, so a symlink planted at the record is replaced
 * rather than followed. Callers decide whether a failed write matters: `new` and verify's timing
 * fields only warn, since some agent sandboxes allow writes only inside the project, while
 * `verify --accept-changes` and `add` use `replaceProjectState`, which puts the old bytes back if
 * the rest of their work fails.
 */
import { type Manifest, ProjectId } from "@steamfield/stacks-format";
import { Effect, Exit, FileSystem, Option, Path, type PlatformError, Schema } from "effect";
import { AppConfig } from "../config";
import { InvalidConfig, PermissionDenied } from "../errors";
import { Invocation } from "../services/invocation";
import { digestSettings, digestStep, newerSchemaVersion } from "./manifest";
import { replaceFile } from "./replace-file";
import { printable } from "./text";

/**
 * The second copy of a project's verify digest, outside the project. `stepDigests` and
 * `settingsDigest` only explain which part changed when `verifyDigest` differs (verify's
 * `VerifyChanged` report); the whole-set digest decides.
 */
export const ProjectState = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  projectId: Schema.String,
  /** Real path of `.stacks/manifest.json`, so a lookup by path matches however it was reached. */
  manifestPath: Schema.String,
  verifyDigest: Schema.String,
  /** Step name to `digestStep` of that step. */
  stepDigests: Schema.Record(Schema.String, Schema.String),
  /** `digestSettings` over the manifest's `env` and `preset`. */
  settingsDigest: Schema.String,
  createdAt: Schema.String,
  /** When verify first finished green; filled by `verify/record.ts`. */
  firstGreenAt: Schema.NullOr(Schema.String),
  /** When a test step first passed; filled by `verify/record.ts`. */
  firstTestPassAt: Schema.NullOr(Schema.String),
});
export type ProjectState = typeof ProjectState.Type;

/** Whether the record was written, and where: `new` reports `stateRecord` and rolls back `path`. */
type StateWrite = { written: true; path: string } | { written: false };

/** The record a manifest gets; `manifestPath` must already be a real path. */
export function projectStateFor(manifest: Manifest, manifestPath: string): ProjectState {
  return {
    schemaVersion: 1,
    projectId: manifest.projectId,
    manifestPath,
    verifyDigest: manifest.verifyDigest,
    stepDigests: Object.fromEntries(manifest.verify.map((step) => [step.name, digestStep(step)])),
    settingsDigest: digestSettings(manifest),
    createdAt: manifest.createdAt,
    firstGreenAt: null,
    firstTestPassAt: null,
  };
}

/**
 * Where a project's record lives, or `undefined` for an id `ProjectId` refuses (letters, digits
 * and `-` only), so no caller can turn an arbitrary string into a path outside `projects/`.
 */
export const projectStatePath = (projectId: string) =>
  Effect.gen(function* () {
    if (!Schema.is(ProjectId)(projectId)) return undefined;
    const path = yield* Path.Path;
    const paths = yield* (yield* AppConfig).paths;
    return path.join(paths.state, "projects", `${projectId}.json`);
  });

/** The filesystem reason a write failed, for warning text. */
export const reasonOf = (error: PlatformError.PlatformError) => error.reason._tag;

/**
 * Writes the state record for a manifest that is already on disk at `manifestPath`. The record
 * holds that file's real path. A manifest that can't be resolved is `PermissionDenied` (`read`).
 * The state directory being unwritable is not an error: the result is `{ written: false }` and a
 * warning is logged, since some agent sandboxes allow writes only inside the project.
 *
 * The record is written through `replaceFile` (an exclusive create in a fresh temporary
 * directory, renamed over `<projectId>.json`), which replaces a link rather than writing through
 * it. `removeProjectState` undoes it.
 */
export const writeProjectState = (
  manifest: Manifest,
  manifestPath: string,
): Effect.Effect<StateWrite, PermissionDenied, FileSystem.FileSystem | Path.Path | AppConfig> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const real = yield* fs
      .realPath(manifestPath)
      .pipe(
        Effect.mapError(
          () => new PermissionDenied({ details: { reason: "read", path: manifestPath } }),
        ),
      );
    const target = yield* projectStatePath(manifest.projectId);
    if (target === undefined) return { written: false } as const;
    return yield* saveProjectState(projectStateFor(manifest, real), target).pipe(
      Effect.as({ written: true, path: target } as const),
      Effect.catchTag("PlatformError", (error) =>
        warnUnwritten(error, target).pipe(Effect.as({ written: false } as const)),
      ),
    );
  });

/** The one warning a state record write that failed logs. */
export const warnUnwritten = (error: PlatformError.PlatformError, target: string) =>
  Effect.logWarning(`Project state record not written (${reasonOf(error)}): ${printable(target)}`);

/**
 * Writes `state` to `target` (a `projectStatePath`), creating its directory, through
 * `replaceFile`: nothing planted there is followed, and a link at the record is replaced rather
 * than written through. Fails with the platform error; callers decide
 * whether that is a warning (`new`, verify's timing fields) or a refusal (`--accept-changes`).
 */
export const saveProjectState = (
  state: ProjectState,
  target: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const text = `${JSON.stringify(Schema.encodeSync(ProjectState)(state), null, 2)}\n`;
    yield* fs.makeDirectory(path.dirname(target), { recursive: true });
    yield* replaceFile(target, text);
  });

/** The record's current bytes, or `undefined` when there is none yet; other failures fail. */
const readOldBytes = (target: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs
      .readFile(target)
      .pipe(
        Effect.catch((error) =>
          error.reason._tag === "NotFound" ? Effect.succeed(undefined) : Effect.fail(error),
        ),
      );
  });

/**
 * Puts back what `replaceProjectState` replaced: the old bytes, or no file when there were none.
 * A restore that fails is recorded with `Invocation.rollbackIncomplete` (when an invocation is
 * running) and never replaces the original failure.
 */
const restoreOldBytes = (options: {
  target: string;
  old: Uint8Array | undefined;
  invocation: Option.Option<Invocation["Service"]>;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { target, old, invocation } = options;
    const restore = old === undefined ? fs.remove(target) : replaceFile(target, old);
    const restored = yield* Effect.exit(restore);
    if (Exit.isFailure(restored) && Option.isSome(invocation))
      yield* invocation.value.rollbackIncomplete(target);
  });

/**
 * Replace a record within the caller's transaction. Acquisition finishes the save before it can
 * be interrupted; failure or interruption of the scope restores the exact old bytes, or removes
 * a newly created record. The caller decides whether an unavailable state directory is fatal.
 */
export const replaceProjectState = (state: ProjectState, target: string) =>
  Effect.gen(function* () {
    const invocation = yield* Effect.serviceOption(Invocation);
    yield* Effect.acquireRelease(
      Effect.gen(function* () {
        const old = yield* readOldBytes(target);
        yield* saveProjectState(state, target);
        return old;
      }),
      (old, exit) =>
        Exit.isSuccess(exit) ? Effect.void : restoreOldBytes({ target, old, invocation }),
    );
  });

/** A state record and the file it was read from. */
export type FoundState = { state: ProjectState; path: string };

/**
 * Reads one record file: `undefined` when it is missing, unreadable, not JSON or doesn't decode
 * (treated as missing), and `{ newer }` when a newer stacks wrote it.
 */
const readStateFile = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* Effect.option(fs.readFileString(file));
    if (text._tag === "None") return undefined;
    const parsed = yield* Effect.option(
      Effect.try({ try: () => JSON.parse(text.value) as unknown, catch: () => undefined }),
    );
    if (parsed._tag === "None") return undefined;
    const newer = newerSchemaVersion(parsed.value);
    if (newer !== undefined) return { newer } as const;
    return yield* Schema.decodeUnknownEffect(ProjectState)(parsed.value, {
      onExcessProperty: "error",
    }).pipe(
      Effect.map((state) => ({ state })),
      Effect.orElseSucceed(() => undefined),
    );
  });

/**
 * The tamper check's lookup by id: the record for `projectId` and its path, or `undefined` when
 * there is none or it is unreadable. A record a newer stacks wrote is `InvalidConfig` with its
 * path and version, never a silent fall back to checking the manifest alone.
 */
export const findProjectState = (
  projectId: string,
): Effect.Effect<
  FoundState | undefined,
  InvalidConfig,
  FileSystem.FileSystem | Path.Path | AppConfig
> =>
  Effect.gen(function* () {
    const target = yield* projectStatePath(projectId);
    if (target === undefined) return undefined;
    const read = yield* readStateFile(target);
    if (read === undefined) return undefined;
    if ("newer" in read)
      return yield* new InvalidConfig({ details: { path: target, schemaVersion: read.newer } });
    return { state: read.state, path: target };
  });

/**
 * The tamper check's lookup by path, for a manifest whose project id was edited: the first
 * record, by file name, whose `manifestPath` is `realManifestPath`. Records that can't be read,
 * decoded or are newer are passed over. Linear in the number of records.
 */
export const findProjectStateByPath = (
  realManifestPath: string,
): Effect.Effect<FoundState | undefined, never, FileSystem.FileSystem | Path.Path | AppConfig> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = path.join((yield* (yield* AppConfig).paths).state, "projects");
    const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => []));
    for (const name of [...names].sort()) {
      if (!name.endsWith(".json")) continue;
      const file = path.join(dir, name);
      const read = yield* readStateFile(file);
      if (read && "state" in read && read.state.manifestPath === realManifestPath)
        return { state: read.state, path: file };
    }
    return undefined;
  });

/** Rollback for `writeProjectState`: removes the record if it is there; never fails. */
export const removeProjectState = (
  write: StateWrite,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  write.written
    ? Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* Effect.ignore(fs.remove(write.path));
      })
    : Effect.void;

/**
 * The record for a project id, or `undefined` when there is none or it can't be read or decoded.
 * Unlike `findProjectState`, a record a newer stacks wrote also reads as `undefined`.
 */
export const readProjectState = (
  projectId: string,
): Effect.Effect<ProjectState | undefined, never, FileSystem.FileSystem | Path.Path | AppConfig> =>
  Effect.gen(function* () {
    const target = yield* projectStatePath(projectId);
    if (target === undefined) return undefined;
    const read = yield* readStateFile(target);
    return read !== undefined && "state" in read ? read.state : undefined;
  });
