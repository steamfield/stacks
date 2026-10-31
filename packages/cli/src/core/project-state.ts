import { type Manifest, ProjectId } from "@steamfield/stacks-format";
import { Effect, Exit, FileSystem, Path, type PlatformError, Schema } from "effect";
import { AppConfig } from "../config";
import { InvalidConfig, PermissionDenied } from "../errors";
import { digestSettings, digestStep } from "./manifest";
import { replaceFile } from "./replace-file";
import { printable } from "./text";

/**
 * The second copy of a project's verify digest, outside the project, at
 * `$XDG_STATE_HOME/stacks/projects/<projectId>.json`. `stepDigests` and `settingsDigest`
 * only explain a changed `verifyDigest` (1.3b's `VerifyChanged`); the whole-set digest decides.
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
  /** Filled by 1.3b. */
  firstGreenAt: Schema.NullOr(Schema.String),
  /** Filled by 1.3b. */
  firstTestPassAt: Schema.NullOr(Schema.String),
});
export type ProjectState = typeof ProjectState.Type;

/** Whether the record was written, and where: `new` reports `stateRecord` and rolls back `path`. */
export type StateWrite = { written: true; path: string } | { written: false };

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

const reasonOf = (error: PlatformError.PlatformError) => error.reason._tag;

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

/**
 * Replace a record within the caller's transaction. Acquisition finishes the save before it can
 * be interrupted; failure or interruption of the scope restores the exact old bytes, or removes
 * a newly created record. The caller decides whether an unavailable state directory is fatal.
 */
export const replaceProjectState = (state: ProjectState, target: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* Effect.acquireRelease(
      Effect.gen(function* () {
        const old = yield* fs
          .readFile(target)
          .pipe(
            Effect.catch((error) =>
              error.reason._tag === "NotFound" ? Effect.succeed(undefined) : Effect.fail(error),
            ),
          );
        yield* saveProjectState(state, target);
        return old;
      }),
      (old, exit) =>
        Exit.isSuccess(exit)
          ? Effect.void
          : Effect.ignore(old ? fs.writeFile(target, old) : fs.remove(target)),
    );
  });

/** A state record and the file it was read from. */
export type FoundState = { state: ProjectState; path: string };

const versionOf = (value: unknown) =>
  value !== null && typeof value === "object" && "schemaVersion" in value
    ? value.schemaVersion
    : undefined;

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
    const unknown = parsed.value;
    const version = versionOf(unknown);
    if (typeof version === "number" && Number.isFinite(version) && version > 1)
      return { newer: version } as const;
    return yield* Schema.decodeUnknownEffect(ProjectState)(unknown, {
      onExcessProperty: "error",
    }).pipe(
      Effect.map((state) => ({ state })),
      Effect.orElseSucceed(() => undefined),
    );
  });

/**
 * The tamper check's lookup by id (1.3b): the record for `projectId` and its path, or `undefined`
 * when there is none or it is unreadable. A record a newer stacks wrote is `InvalidConfig`
 * with its path and version (Schema versions), never a silent fall back to manifest-only.
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
 * The tamper check's lookup by path (1.3b): the first record, by file name, whose `manifestPath`
 * is `realManifestPath`. Records that can't be read, decoded or are newer are passed over. Linear
 * in the number of records.
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
 * The record for a project id, or `undefined` when there is none or it can't be read or decoded
 * (Schema versions: an unreadable record is treated as missing).
 */
export const readProjectState = (
  projectId: string,
): Effect.Effect<ProjectState | undefined, never, FileSystem.FileSystem | Path.Path | AppConfig> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const target = yield* projectStatePath(projectId);
    if (target === undefined) return undefined;
    return yield* fs.readFileString(target).pipe(
      Effect.flatMap((text) =>
        Effect.try({ try: () => JSON.parse(text) as unknown, catch: () => undefined }),
      ),
      Effect.flatMap(Schema.decodeUnknownEffect(ProjectState, { onExcessProperty: "error" })),
      Effect.orElseSucceed(() => undefined),
    );
  });
