/**
 * Checks, before `stacks verify` runs anything, that the project's verify steps are still the
 * ones that were recorded when the project was made (Trust model, point 5).
 *
 * The steps live in `.stacks/manifest.json`, inside the project, where an agent could edit a
 * failing check into `true`. So the CLI keeps two digests (sha256 fingerprints) of them: one in
 * the manifest itself (`verifyDigest`) and one in the state record, a file outside the project
 * under `Paths.state` that the agent's edits to the project don't reach. `checkTamper` digests the
 * steps again and compares in this order: with the manifest's own digest, then with the state
 * record for the manifest's `projectId`. With no record under that id, it looks for a record
 * holding this manifest's real path (a copied project, or an edited `projectId`), and finding
 * one counts as a change. With no record at all, the check is `manifest-only`, which still runs
 * but can't count as a full check.
 *
 * `commands/verify.ts` calls `checkTamper` right after reading the manifest. A change stops the
 * run (`changedResult` builds its report) until a person at a terminal runs `--accept-changes`,
 * which `acceptChanges` carries out; the command refuses it under an agent (Trust model, point 4).
 */
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
import { skippedStep, type VerifyPlan } from "./plan";
import { secondsSinceCreated } from "./run";

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

const CHANGED = "not run: the verify steps changed since they were recorded";

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
        .map(([name]) => name),
    ),
    settings: digestSettings(manifest) !== state.settingsDigest,
  };
}
/** With no state record there is nothing to name the change from. */
const NOT_ITEMIZED = { removed: [], added: [], edited: [], settings: false };

type RecordCheck = {
  manifest: Manifest;
  manifestPath: string;
  /** The steps' digest as they are now. */
  digest: string;
  record: FoundState;
};

/**
 * Compared with the record for this `projectId`. `against` names the first copy that disagreed:
 * the manifest's own digest, else the record's. The change is itemized from the record either way.
 */
function checkAgainstRecord({ manifest, manifestPath, digest, record }: RecordCheck): Tamper {
  const manifestOk = digest === manifest.verifyDigest;
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
  };
}

/** A record holds this manifest's path under another id: always a change, whatever the digests. */
function staleRecordChange(manifest: Manifest, manifestPath: string, stale: FoundState): Tamper {
  return {
    tamperCheck: "full",
    stale,
    manifestPath,
    changed: { against: "state-record", reason: "project-id", ...itemize(manifest, stale.state) },
  };
}

/** No state record on this machine: only the manifest's own digest can be compared. */
function manifestOnly(manifestPath: string, manifestOk: boolean): Tamper {
  return {
    tamperCheck: "manifest-only",
    manifestPath,
    ...(manifestOk ? {} : { changed: { against: "manifest", reason: "digest", ...NOT_ITEMIZED } }),
  };
}

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
    const record = yield* findProjectState(manifest.projectId);
    if (record) return checkAgainstRecord({ manifest, manifestPath, digest, record });
    const stale = yield* findProjectStateByPath(manifestPath);
    if (stale) return staleRecordChange(manifest, manifestPath, stale);
    return manifestOnly(manifestPath, digest === manifest.verifyDigest);
  });

/**
 * The state record that accepts the steps as they are now. It keeps `createdAt` and the timing
 * fields of whichever record the check found, so accepting a change doesn't reset them.
 */
function acceptedState(accepted: Manifest, original: Manifest, tamper: Tamper): ProjectState {
  const kept = tamper.record?.state ?? tamper.stale?.state;
  return {
    ...projectStateFor(accepted, tamper.manifestPath),
    createdAt: kept?.createdAt ?? original.createdAt,
    firstGreenAt: kept?.firstGreenAt ?? null,
    firstTestPassAt: kept?.firstTestPassAt ?? null,
  };
}

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
    const state = acceptedState(accepted, manifest, tamper);
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
          // Best effort: the record under the old id no longer matches any project.
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
    const result: VerifyResult = {
      outcome: "changed",
      ...(plan.steps.some((step) => step.tags.includes("app"))
        ? { stages: { base: "changed", app: null } }
        : {}),
      scope: plan.scope,
      steps: plan.steps.map((step) => skippedStep(step, CHANGED)),
      totals: { passed: 0, failed: 0, skipped: plan.steps.length },
      durationMs: ended - started,
      secondsSinceCreated: secondsSinceCreated(createdAtOf(manifest, tamper), ended),
      tamperCheck: tamper.tamperCheck,
      changed: tamper.changed,
      firstGreen: false,
      stateRecord: tamper.record !== undefined,
    };
    return result;
  });
