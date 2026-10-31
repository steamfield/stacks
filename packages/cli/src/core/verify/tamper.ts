import type { Manifest, TamperCheck } from "@steamfield/stacks-format";
import { Clock, Effect, FileSystem, Path } from "effect";
import type { AppConfig } from "../../config";
import { type InvalidConfig, PermissionDenied } from "../../errors";
import { MANIFEST_PATH } from "../../project-layout";
import type { VerifyChange, VerifyResult } from "../../schemas/verify";
import { digestSettings, digestStep, digestSteps, encodeManifest } from "../manifest";
import {
  type FoundState,
  findProjectState,
  findProjectStateByPath,
  type ProjectState,
  projectStateFor,
  projectStatePath,
  replaceProjectState,
} from "../project-state";
import { openProject } from "../scaffold/write";
import type { VerifyPlan } from "./plan";

/**
 * The tamper check's finding. `record` is the state record for the manifest's `projectId`, the one
 * a run updates; `stale` is a record found only by the manifest's real path, under another id.
 */
export type Tamper = {
  tamperCheck: TamperCheck;
  changed?: VerifyChange;
  record?: FoundState;
  stale?: FoundState;
  /** The manifest's real path, as a state record holds it. */
  manifestPath: string;
};

const sorted = (names: Iterable<string>) => [...names].sort();

/** Which steps and settings differ from a state record, by its per-step and settings digests. */
function itemize(manifest: Manifest, state: ProjectState) {
  const now = new Map(manifest.verify.map((step) => [step.name, digestStep(step)]));
  const was = new Map(Object.entries(state.stepDigests));
  return {
    removed: sorted([...was.keys()].filter((name) => !now.has(name))),
    added: sorted([...now.keys()].filter((name) => !was.has(name))),
    edited: sorted(
      [...now]
        .filter(([name, digest]) => was.has(name) && was.get(name) !== digest)
        .map(([n]) => n),
    ),
    settings: digestSettings(manifest) !== state.settingsDigest,
  };
}
const NOT_ITEMIZED = { removed: [], added: [], edited: [], settings: false };

/**
 * The tamper check, before any step runs (Trust model, point 5). The manifest's steps are
 * digested again and compared with its own `verifyDigest`, then with the state record for its
 * `projectId`; with no record for that id, a record holding this manifest's real path is looked
 * for, and finding one is a change (`reason: "project-id"`). No record at all is `manifest-only`.
 * A record a newer stacks wrote fails `InvalidConfig`. What changed is named from the record's per-step
 * digests whenever there is a record, whichever copy disagreed.
 */
export const checkTamper = (
  manifest: Manifest,
  manifestFile: string,
): Effect.Effect<Tamper, InvalidConfig, FileSystem.FileSystem | Path.Path | AppConfig> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const manifestPath = yield* fs
      .realPath(manifestFile)
      .pipe(Effect.orElseSucceed(() => manifestFile));
    const digest = digestSteps(manifest);
    const manifestOk = digest === manifest.verifyDigest;
    const record = yield* findProjectState(manifest.projectId);
    if (record) {
      const ok = manifestOk && record.state.verifyDigest === digest;
      return {
        tamperCheck: "full",
        record,
        manifestPath,
        ...(ok
          ? {}
          : {
              changed: {
                against: manifestOk ? "state-record" : "manifest",
                reason: "digest",
                ...itemize(manifest, record.state),
              },
            }),
      } satisfies Tamper;
    }
    const stale = yield* findProjectStateByPath(manifestPath);
    if (stale)
      return {
        tamperCheck: "full",
        stale,
        manifestPath,
        changed: {
          against: "state-record",
          reason: "project-id",
          ...itemize(manifest, stale.state),
        },
      } satisfies Tamper;
    return {
      tamperCheck: "manifest-only",
      manifestPath,
      ...(manifestOk
        ? {}
        : { changed: { against: "manifest", reason: "digest", ...NOT_ITEMIZED } }),
    } satisfies Tamper;
  });

/**
 * `--accept-changes`, once the caller has checked that a person at a terminal asked: records the
 * manifest's steps as they are now. The state record for the manifest's `projectId` is written
 * first (created when there is none), keeping `createdAt` and the timing fields of whichever
 * record was found; then the manifest's `verifyDigest`. The scope restores both files on failure.
 * A record found only by path, under another id, is removed last. The writes and rollback can't
 * be interrupted part way; an interrupt takes effect once they are done.
 */
export const acceptChanges = (
  manifest: Manifest,
  manifestFile: string,
  tamper: Tamper,
): Effect.Effect<
  { manifest: Manifest; tamper: Tamper },
  PermissionDenied,
  FileSystem.FileSystem | Path.Path | AppConfig
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const accepted = { ...manifest, verifyDigest: digestSteps(manifest) };
    const target = yield* projectStatePath(manifest.projectId);
    if (target === undefined)
      return yield* new PermissionDenied({ details: { reason: "state-unwritable" } });
    const kept = tamper.record?.state ?? tamper.stale?.state;
    const state: ProjectState = {
      ...projectStateFor(accepted, tamper.manifestPath),
      createdAt: kept?.createdAt ?? manifest.createdAt,
      firstGreenAt: kept?.firstGreenAt ?? null,
      firstTestPassAt: kept?.firstTestPassAt ?? null,
    };
    // One uninterruptible region: an interrupt between the two writes would leave them disagreeing.
    yield* Effect.uninterruptible(
      Effect.scoped(
        Effect.gen(function* () {
          yield* replaceProjectState(state, target).pipe(
            Effect.mapError(
              () => new PermissionDenied({ details: { reason: "state-unwritable", path: target } }),
            ),
          );
          if (accepted.verifyDigest !== manifest.verifyDigest) {
            const writer = yield* openProject(path.dirname(path.dirname(manifestFile)));
            yield* writer.rewrite(
              MANIFEST_PATH,
              new TextEncoder().encode(encodeManifest(accepted)),
            );
          }
          if (tamper.stale && tamper.stale.path !== target)
            yield* Effect.ignore(fs.remove(tamper.stale.path));
        }),
      ),
    );
    return {
      manifest: accepted,
      tamper: {
        tamperCheck: "full",
        record: { state, path: target },
        manifestPath: tamper.manifestPath,
        ...(tamper.changed ? { changed: tamper.changed } : {}),
      },
    };
  });

/**
 * When the project was made, for `secondsSinceCreated`: the state record's `createdAt` (the one
 * for this id, else one found by path), since the manifest's is outside the digest and an agent
 * could move it; the manifest's only when there is no record.
 */
export const createdAtOf = (manifest: Manifest, tamper: Tamper): string =>
  (tamper.record ?? tamper.stale)?.state.createdAt ?? manifest.createdAt;

const CHANGED = "not run: the verify steps changed since they were recorded";

/**
 * The result of a run the tamper check stopped: every step skipped, nothing run (not even
 * teardown, since no setup ran). `started` is when the command began, from Clock.
 */
export const changedResult = (
  plan: VerifyPlan,
  manifest: Manifest,
  tamper: Tamper & { changed: VerifyChange },
  started: number,
): Effect.Effect<VerifyResult> =>
  Effect.gen(function* () {
    const ended = yield* Clock.currentTimeMillis;
    const created = Date.parse(createdAtOf(manifest, tamper));
    const result: VerifyResult = {
      outcome: "changed",
      ...(plan.steps.some((step) => step.tags.includes("app"))
        ? { stages: { base: "changed", app: null } }
        : {}),
      scope: plan.scope,
      steps: plan.steps.map((step) => ({
        name: step.name,
        phase: step.phase,
        ...(step.layer ? { layer: step.layer } : {}),
        command: step.run,
        status: "skipped" as const,
        durationMs: 0,
        reason: CHANGED,
      })),
      totals: { passed: 0, failed: 0, skipped: plan.steps.length },
      durationMs: ended - started,
      secondsSinceCreated: Number.isFinite(created)
        ? Math.max(0, Math.floor((ended - created) / 1000))
        : 0,
      tamperCheck: tamper.tamperCheck,
      changed: tamper.changed,
      firstGreen: false,
      stateRecord: tamper.record !== undefined,
    };
    return result;
  });
