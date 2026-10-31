import { createHash } from "node:crypto";
import { Manifest, type ManifestStep, withStepDefaults } from "@steamfield/stacks-format";
import { Clock, Effect, FileSystem, Path, type PlatformError, Random, Schema } from "effect";
import { InvalidConfig, NotFound, PermissionDenied } from "../errors";
import { MANIFEST_PATH } from "../project-layout";
import { VERSION } from "../version";
import { canonicalJson } from "./canonical-json";
import type { Composition } from "./compose/compose";
import type { Entry } from "./registry/entry";

/** Where a project's manifest lives, relative to its root. */
export { MANIFEST_PATH } from "../project-layout";

/** What the digest reads from a manifest; a later optional field can't reach it by accident. */
export type DigestInput = Pick<Manifest, "verify" | "env" | "preset">;

const sha256 = (value: unknown) =>
  `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

/** Every field verify reads from a step, defaults applied; `owner` is left out. */
function digestable(step: ManifestStep) {
  const { owner: _owner, skipByDefault, ...fields } = step;
  return { ...withStepDefaults(fields), skipByDefault };
}

/** One step's digest, for the state record's `stepDigests`. */
export function digestStep(step: ManifestStep): string {
  return sha256(digestable(step));
}
/** The digest of the manifest's `env` and `preset`, for the state record's `settingsDigest`. */
export function digestSettings(input: Pick<Manifest, "env" | "preset">): string {
  return sha256({ env: input.env, preset: input.preset });
}
/**
 * The tamper digest (Trust model, point 5): the steps in order, each with every field verify reads
 * and defaults applied, plus `env` and `preset`. `owner` and every other manifest field are out.
 */
export function digestSteps(input: DigestInput): string {
  return sha256({ verify: input.verify.map(digestable), env: input.env, preset: input.preset });
}

const entryRef = (entry: Entry) => ({
  id: entry.id,
  origin: entry.origin,
  trusted: entry.trusted,
});

/** A random version 4 UUID from Effect's `Random`, so a seeded test gets a fixed id. */
const projectId = Effect.gen(function* () {
  const bytes: number[] = [];
  for (let i = 0; i < 16; i++) bytes.push(yield* Random.nextIntBetween(0, 255));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
});

/**
 * The manifest `new` writes for a composition: a fresh project id and creation time, the entries
 * in composition order, the composed steps with their owner's id, and the digest over them.
 * `briefWords` is `renderBrief`'s count for the brief written beside it.
 */
export const buildManifest = (
  composition: Composition<Entry | null>,
  facts: { briefWords: number; mode?: "new" | "add" },
): Effect.Effect<Manifest> =>
  Effect.gen(function* () {
    const verify = composition.verify.map(
      ({ owner, ...step }): ManifestStep => ({
        ...step,
        owner: owner.id,
      }),
    );
    const body = { verify, env: { ...composition.env }, preset: composition.preset };
    return {
      schemaVersion: 1 as const,
      projectId: yield* projectId,
      createdAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      cli: VERSION,
      mode: facts.mode ?? "new",
      agents: [...composition.agents],
      stack: composition.stack ? entryRef(composition.stack) : null,
      fragments: composition.fragments.map(entryRef),
      commands: { ...composition.commands },
      ...body,
      verifyDigest: digestSteps(body),
      briefWords: facts.briefWords,
    };
  });

/** The manifest's file contents: encoded, two-space JSON, one trailing newline. */
export function encodeManifest(manifest: Manifest): string {
  return `${JSON.stringify(Schema.encodeSync(Manifest)(manifest), null, 2)}\n`;
}

const isMissing = (error: PlatformError.PlatformError) =>
  error.reason._tag === "NotFound" || error.reason._tag === "BadResource";
const versionOf = (value: unknown) =>
  value !== null && typeof value === "object" && "schemaVersion" in value
    ? value.schemaVersion
    : undefined;

/**
 * Reads and decodes a manifest. A missing file is `NotFound`; one that can't be read is
 * `PermissionDenied` (`read`); one that isn't JSON or doesn't decode, excess keys included, is
 * `InvalidConfig` with its path; one a newer stacks wrote (`schemaVersion` above 1) is
 * `InvalidConfig` with that version too.
 */
export const readManifest = (
  path: string,
): Effect.Effect<Manifest, NotFound | PermissionDenied | InvalidConfig, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs
      .readFileString(path)
      .pipe(
        Effect.mapError((error) =>
          isMissing(error)
            ? new NotFound()
            : new PermissionDenied({ details: { reason: "read", path } }),
        ),
      );
    const invalid = (schemaVersion?: number) =>
      new InvalidConfig({
        details: schemaVersion === undefined ? { path } : { path, schemaVersion },
      });
    const unknown = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: () => invalid(),
    });
    const version = versionOf(unknown);
    if (typeof version === "number" && Number.isFinite(version) && version > 1)
      return yield* invalid(version);
    return yield* Schema.decodeUnknownEffect(Manifest)(unknown, {
      onExcessProperty: "error",
    }).pipe(Effect.mapError(() => invalid()));
  });

/**
 * The nearest project at or above `start`: the first directory, walking up, holding
 * `.stacks/manifest.json` as a file. `root` and `path` keep `start`'s spelling (resolved, not
 * real-pathed). None is `NotFound` with `kind: "project"` and `looked: start`.
 */
export const locateManifest = (
  start: string,
): Effect.Effect<
  { root: string; path: string },
  NotFound | PermissionDenied,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const from = path.resolve(start);
    let dir = from;
    while (true) {
      const candidate = path.join(dir, MANIFEST_PATH);
      const info = yield* fs
        .stat(candidate)
        .pipe(
          Effect.catch((error) =>
            isMissing(error)
              ? Effect.succeed(undefined)
              : Effect.fail(new PermissionDenied({ details: { reason: "read", path: candidate } })),
          ),
        );
      if (info?.type === "File") return { root: dir, path: candidate };
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return yield* new NotFound({ details: { suggestions: [], kind: "project", looked: from } });
  });
