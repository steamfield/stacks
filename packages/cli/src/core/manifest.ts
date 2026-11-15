/**
 * Builds, reads and finds a project's manifest, and computes the digests that let `stacks verify`
 * notice when its steps were edited.
 *
 * The manifest is `.stacks/manifest.json`, the committed record of what a project was composed
 * from (its stack and fragments, origins and trust) and of its verify steps, the commands that
 * define done. `stacks new` and `stacks add` build one with `buildManifest` and write it with
 * `encodeManifest`. `verify`, `runs` and telemetry find the nearest one with `locateManifest`, and
 * every reader (`add` and `list` too) decodes it with `readManifest`.
 *
 * Because the manifest lives inside the project, anyone (an agent included) can edit its steps.
 * So `verifyDigest` is a sha256 over the steps, `env` and `preset`, and a second copy is kept in
 * the state record outside the project (`project-state.ts`). `verify/tamper.ts` compares the two
 * before running anything (Trust model, point 5). The digests hash `canonical-json.ts` output and
 * are pinned by `tests/digest-golden.test.ts`, so their input must not change shape.
 */
import { createHash } from "node:crypto";
import { Manifest, type ManifestStep, withStepDefaults } from "@steamfield/stacks-format";
import { Clock, Effect, FileSystem, Path, Random, Schema } from "effect";
import { InvalidConfig, NotFound, PermissionDenied } from "../errors";
import { MANIFEST_PATH } from "../project-layout";
import { VERSION } from "../version";
import { isAbsent } from "./absent";
import { canonicalJson } from "./canonical-json";
import type { Composition } from "./compose/types";
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

const manifestEntryRef = (entry: Entry) => ({
  id: entry.id,
  origin: entry.origin,
  trusted: entry.trusted,
});

/** Formats 16 bytes as a UUID string, after setting the version 4 and variant bits. */
function formatUuid(bytes: Array<number>): string {
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A random version 4 UUID from Effect's `Random`, so a seeded test gets a fixed id. */
const projectId = Effect.gen(function* () {
  const bytes: number[] = [];
  for (let i = 0; i < 16; i++) bytes.push(yield* Random.nextIntBetween(0, 255));
  return formatUuid(bytes);
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
      stack: composition.stack ? manifestEntryRef(composition.stack) : null,
      fragments: composition.fragments.map(manifestEntryRef),
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

/** The `schemaVersion` field of a parsed JSON object, whatever its type, if it has one. */
export const versionOf = (value: unknown) =>
  value !== null && typeof value === "object" && "schemaVersion" in value
    ? value.schemaVersion
    : undefined;

/**
 * The `schemaVersion` of a parsed record when a newer stacks wrote it (a finite number above 1),
 * else `undefined`. The manifest and the state record both refuse such a file rather than guess.
 */
export function newerSchemaVersion(value: unknown): number | undefined {
  const version = versionOf(value);
  return typeof version === "number" && Number.isFinite(version) && version > 1
    ? version
    : undefined;
}

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
          isAbsent(error)
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
    const newer = newerSchemaVersion(unknown);
    if (newer !== undefined) return yield* invalid(newer);
    return yield* Schema.decodeUnknownEffect(Manifest)(unknown, {
      onExcessProperty: "error",
    }).pipe(Effect.mapError(() => invalid()));
  });

/**
 * Whether `candidate` is a regular file. Absent (including a path through a file) is false; any
 * other failure means the CLI couldn't look, which is `PermissionDenied` rather than "no project".
 */
const isManifestFile = (candidate: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const info = yield* fs
      .stat(candidate)
      .pipe(
        Effect.catch((error) =>
          isAbsent(error)
            ? Effect.succeed(undefined)
            : Effect.fail(new PermissionDenied({ details: { reason: "read", path: candidate } })),
        ),
      );
    return info?.type === "File";
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
    const path = yield* Path.Path;
    const from = path.resolve(start);
    let dir = from;
    while (true) {
      const candidate = path.join(dir, MANIFEST_PATH);
      if (yield* isManifestFile(candidate)) return { root: dir, path: candidate };
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return yield* new NotFound({ details: { suggestions: [], kind: "project", looked: from } });
  });
