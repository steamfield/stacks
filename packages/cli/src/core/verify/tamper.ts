/**
 * Owns `checkTamper` (trust point 5) and persists acceptance after `requireConfirmation`
 * (trust point 4). The state record is outside the project so editing the manifest cannot
 * rewrite both digests.
 */
import type { Manifest } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path } from "effect";
import type { AppConfig } from "../../config";
import { type InvalidConfig, PermissionDenied } from "../../errors";
import { MANIFEST_PATH } from "../../project-layout";
import type { VerifyChange } from "../../schemas/verify";
import { digestSettings, digestStep, digestSteps, encodeManifest } from "../project/manifest";
import {
  type FoundState,
  findProjectState,
  findProjectStateByPath,
  type ProjectState,
  projectStateFor,
  projectStatePath,
  replaceProjectState,
} from "../project/state";
import { openProject } from "../project/writer";

/** Only an id match supplies the current record. A path match under an old id proves a change. */
export type Tamper = { manifestPath: string } & (
  | { tamperCheck: "full"; record: FoundState; stale?: never; changed?: VerifyChange }
  | { tamperCheck: "full"; record?: never; stale: FoundState; changed: VerifyChange }
  | { tamperCheck: "manifest-only"; record?: never; stale?: never; changed?: VerifyChange }
);

export type ChangedTamper = Tamper & { changed: VerifyChange };

const sorted = (names: Iterable<string>) => [...names].sort();

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
/** Without a recorded baseline, there are no prior steps or settings to itemize changes from. */
const NOT_ITEMIZED = { removed: [], added: [], edited: [], settings: false };

type RecordCheck = {
  manifest: Manifest;
  manifestPath: string;
  digest: string;
  record: FoundState;
};

/**
 * `against` reports a manifest digest mismatch first. The state record supplies the itemized
 * changes regardless of which digest disagrees.
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
 * Check the manifest digest and the state baseline before steps run (trust point 5). Look up
 * state by id first so moved or copied projects retain their baseline. Without an id match, a
 * record at the same real path signals an id change, including a manifest copied over this one.
 * With no record, an intact manifest digest permits a `manifest-only` run. A newer record fails
 * as `InvalidConfig`.
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

/** Carry creation and timing fields forward so accepting new steps does not reset them. */
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
 * After `requireConfirmation` (trust point 4), write the state baseline first and the manifest
 * digest second, with both scoped for rollback. Remove a record found only under the old id last.
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
 * Prefer the state timestamp because an agent can edit the manifest's undigested timestamp.
 * Use the manifest timestamp only when neither state lookup found a record.
 */
export const createdAtOf = (manifest: Manifest, tamper: Tamper): string =>
  (tamper.record ?? tamper.stale)?.state.createdAt ?? manifest.createdAt;
