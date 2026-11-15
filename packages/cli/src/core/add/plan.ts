/**
 * Plans an `add` without writing: which rendered files go straight into the project, which are
 * already there, and which are parked under `.stacks/incoming/` because a live file differs.
 */
import { Effect, FileSystem, Option, Path, type PlatformError } from "effect";
import { ComposeConflict, PermissionDenied } from "../../errors";
import { INCOMING, METADATA_DIR } from "../../project-layout";
import type { AddResult } from "../../schemas/add";
import { deepMerge } from "../compose/merge";
import type { Composition, PlannedFile } from "../compose/types";
import type { Entry } from "../registry/entry";
import { gitToplevel } from "../scaffold/git";
import { within } from "../scaffold/write";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const denied = (path: string) => new PermissionDenied({ details: { reason: "write", path } });
const absent = (error: PlatformError.PlatformError) => error.reason._tag === "NotFound";

export type AddPlan = {
  readonly write: ReadonlyArray<PlannedFile & { readonly bytes: Uint8Array }>;
  readonly park: ReadonlyArray<{
    file: PlannedFile;
    bytes: Uint8Array;
    incoming: string;
    action: "new" | "merge" | "copy";
  }>;
  readonly skipped: ReadonlyArray<string>;
  readonly incoming: ReadonlyArray<string>;
};

type ParkedFile = AddPlan["park"][number];
type RenderedFile = { file: PlannedFile; bytes: Uint8Array };
/** A rendered file with the bytes of the live project file at its path, if one exists. */
type Candidate = RenderedFile & { live: Uint8Array | undefined };
/** Where one rendered file goes: into the project, nowhere (identical), or under incoming. */
type Placement =
  | { readonly kind: "write" }
  | { readonly kind: "skip" }
  | { readonly kind: "park"; readonly parked: ParkedFile };

const writePlacement: Placement = { kind: "write" };
const skipPlacement: Placement = { kind: "skip" };
const parkPlacement = (parked: ParkedFile): Placement => ({ kind: "park", parked });

/** Refuse metadata links before reading the manifest or traversing incoming files. */
export const checkAddRoot = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const info = yield* fs.stat(root).pipe(Effect.mapError(() => denied(root)));
    if (info.type !== "Directory") return yield* denied(root);
    for (const rel of [METADATA_DIR, INCOMING]) {
      const at = path.join(root, rel);
      const type = yield* fs.lstat(at).pipe(
        Effect.map((value) => value.type),
        Effect.catch((error) =>
          absent(error) ? Effect.succeed("Missing") : Effect.fail(denied(at)),
        ),
      );
      if (type !== "Missing" && type !== "Directory") return yield* denied(at);
    }
  });

/** Fail when a fragment that needs its own repository would land inside a parent repository. */
const checkOwnRepo = (root: string, needsOwnRepo: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (needsOwnRepo.length === 0) return;
    const toplevel = yield* gitToplevel(root);
    if (!toplevel) return;
    const fs = yield* FileSystem.FileSystem;
    const top = yield* fs.realPath(toplevel).pipe(Effect.mapError(() => denied(root)));
    if (top === root) return;
    return yield* new ComposeConflict({
      details: { reason: "needs_own_repo", ids: [...needsOwnRepo], path: top },
    });
  });

/**
 * Read the live file at `rel`, or `undefined` when nothing is there. Every existing ancestor is
 * checked first, so a symbolic link anywhere on the path can't lead the read outside the project.
 */
const readLive = (root: string, rel: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const target = path.join(root, rel);
    const checkLink = (at: string) =>
      Effect.gen(function* () {
        const real = yield* fs.realPath(at).pipe(Effect.mapError(() => denied(at)));
        if (!within(root, real, path.sep)) return yield* denied(at);
      });
    // BadResource is a file where a directory was expected, so nothing can exist below it.
    const liveType = (at: string) =>
      fs.lstat(at).pipe(
        Effect.map((value) => value.type),
        Effect.catch((error) =>
          absent(error) || error.reason._tag === "BadResource"
            ? Effect.succeed("Missing")
            : Effect.fail(denied(at)),
        ),
      );
    let at = root;
    for (const part of rel.split("/")) {
      at = path.join(at, part);
      const type = yield* liveType(at);
      if (type === "Missing") return undefined;
      if (at === target && type === "Directory")
        return yield* new PermissionDenied({ details: { reason: "blocked", path: at } });
      if (type === "SymbolicLink") yield* checkLink(at);
    }
    return yield* fs.readFile(target).pipe(Effect.mapError(() => denied(target)));
  });

/** List every file already parked under incoming, depth first in sorted name order. */
const listParked = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const listDirectory = (rel: string): Effect.Effect<ReadonlyArray<string>, PermissionDenied> =>
      Effect.gen(function* () {
        const at = path.join(root, rel);
        const names = yield* fs
          .readDirectory(at)
          .pipe(
            Effect.catch((error) => (absent(error) ? Effect.succeed([]) : Effect.fail(denied(at)))),
          );
        const files: string[] = [];
        for (const name of [...names].sort()) {
          const child = `${rel}/${name}`;
          const info = yield* fs
            .lstat(path.join(root, child))
            .pipe(Effect.mapError(() => denied(child)));
          if (info.type === "Directory") files.push(...(yield* listDirectory(child)));
          else if (info.type === "File") files.push(child);
          else return yield* denied(path.join(root, child));
        }
        return files;
      });
    return yield* listDirectory(INCOMING);
  });

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/** Add `rel` and each of its parent directories to the reserved set. */
function reserve(reserved: Set<string>, rel: string) {
  const parts = rel.split("/");
  for (let depth = 1; depth <= parts.length; depth++) reserved.add(parts.slice(0, depth).join("/"));
}

/**
 * The incoming paths a numbered copy must not claim: every conflict's primary destination and
 * every file already parked, with their directories.
 */
function reservedPaths(candidates: ReadonlyArray<Candidate>, parked: ReadonlyArray<string>) {
  const reserved = new Set<string>();
  for (const { file, bytes, live } of candidates)
    if (live !== undefined && !sameBytes(live, bytes))
      reserve(reserved, `${INCOMING}/${file.path}`);
  for (const file of parked) reserve(reserved, file);
  return reserved;
}

/** Deep-merge two JSON documents as pretty JSON, or `None` when either isn't JSON. */
const mergedJson = (parked: Uint8Array, incoming: Uint8Array) =>
  Effect.option(
    Effect.try(() => {
      const previous: unknown = JSON.parse(decoder.decode(parked));
      const next: unknown = JSON.parse(decoder.decode(incoming));
      return `${JSON.stringify(deepMerge(previous, next), null, 2)}\n`;
    }),
  );

/** The first `destination.N` (from 2) that is neither reserved nor present on disk. */
const numberedCopyPath = (root: string, destination: string, reserved: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    let suffix = 2;
    while (
      reserved.has(`${destination}.${suffix}`) ||
      (yield* fs.exists(path.join(root, `${destination}.${suffix}`)))
    )
      suffix++;
    return `${destination}.${suffix}`;
  });

/**
 * Park a file that differs from its live copy. A file already parked at the same destination is
 * skipped when identical, merged with it when both are JSON, and otherwise kept as a numbered copy.
 */
const parkConflict = (root: string, rendered: RenderedFile, reserved: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const { file, bytes } = rendered;
    const destination = `${INCOMING}/${file.path}`;
    const parked = yield* readLive(root, destination);
    if (parked === undefined)
      return parkPlacement({ file, bytes, incoming: destination, action: "new" });
    if (sameBytes(parked, bytes)) return skipPlacement;
    const merged = yield* mergedJson(parked, bytes);
    if (Option.isSome(merged))
      return parkPlacement({
        file: { ...file, kind: "merge", content: merged.value },
        bytes: encoder.encode(merged.value),
        incoming: destination,
        action: "merge",
      });
    const copy = yield* numberedCopyPath(root, destination, reserved);
    return parkPlacement({ file, bytes, incoming: copy, action: "copy" });
  });

/** Write a file with no live copy, skip one whose live copy is identical, park the rest. */
const placeFile = (root: string, candidate: Candidate, reserved: ReadonlySet<string>) => {
  if (candidate.live === undefined) return Effect.succeed(writePlacement);
  if (sameBytes(candidate.live, candidate.bytes)) return Effect.succeed(skipPlacement);
  return parkConflict(root, candidate, reserved);
};

/**
 * Plan an add without writing anything. A live project file is never overwritten or merged into,
 * because add leaves existing files as they are: a differing file is parked under incoming for
 * the agent to merge, and only a file already parked there can receive a JSON merge.
 */
export const planAdd = (input: {
  readonly root: string;
  readonly composition: Composition<Entry | null>;
  readonly rendered: ReadonlyArray<{ file: PlannedFile; bytes: Uint8Array }>;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* checkAddRoot(input.root);
    const root = yield* fs.realPath(input.root).pipe(Effect.mapError(() => denied(input.root)));
    yield* checkOwnRepo(root, input.composition.needsOwnRepo);
    const incoming = [...(yield* listParked(root))];
    const candidates = yield* Effect.forEach(input.rendered, (item) =>
      readLive(root, item.file.path).pipe(Effect.map((live): Candidate => ({ ...item, live }))),
    );
    const reserved = reservedPaths(candidates, incoming);
    const write: Array<PlannedFile & { readonly bytes: Uint8Array }> = [];
    const park: ParkedFile[] = [];
    const skipped: string[] = [];
    for (const candidate of candidates) {
      const placement = yield* placeFile(root, candidate, reserved);
      if (placement.kind === "write") write.push({ ...candidate.file, bytes: candidate.bytes });
      else if (placement.kind === "skip") skipped.push(candidate.file.path);
      else {
        park.push(placement.parked);
        // A merge rewrites a file already listed; a new or copied file joins incoming, reserved
        // so a later numbered copy can't take its path.
        if (placement.parked.action !== "merge") {
          incoming.push(placement.parked.incoming);
          reserve(reserved, placement.parked.incoming);
        }
      }
    }
    return {
      write,
      park,
      skipped: skipped.sort(),
      incoming: [...new Set(incoming)].sort(),
    } satisfies AddPlan;
  });

/** Group numbered parked copies with their original destination, including earlier runs. */
export function mergeNeeded(incoming: ReadonlyArray<string>): AddResult["mergeNeeded"] {
  const groups = new Map<string, string[]>();
  for (const file of incoming) {
    const base = file.replace(/\.(?:[2-9]|[1-9]\d+)$/, "");
    const destination = incoming.includes(base) ? base : file;
    const rel = destination.slice(INCOMING.length + 1);
    groups.set(rel, [...(groups.get(rel) ?? []), file]);
  }
  return [...groups]
    .sort(([a], [b]) => {
      if (a < b) return -1;
      return a > b ? 1 : 0;
    })
    .map(([path, incoming]) => ({ path, incoming }));
}
