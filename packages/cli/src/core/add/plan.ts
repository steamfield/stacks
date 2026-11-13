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

/** Refuse metadata links before reading the manifest or traversing incoming files. */
export const checkAddRoot = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const info = yield* fs.stat(root).pipe(Effect.mapError(() => denied(root)));
    if (info.type !== "Directory") return yield* denied(root);
    for (const rel of [METADATA_DIR, INCOMING]) {
      const at = path.join(root, rel);
      const info = yield* fs.lstat(at).pipe(
        Effect.map((value) => value.type),
        Effect.catch((error) =>
          absent(error) ? Effect.succeed("Missing") : Effect.fail(denied(at)),
        ),
      );
      if (info !== "Missing" && info !== "Directory") return yield* denied(at);
    }
  });

const checkOwnRepo = (root: string, needsOwnRepo: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (needsOwnRepo.length) {
      const toplevel = yield* gitToplevel(root);
      if (toplevel) {
        const top = yield* fs.realPath(toplevel).pipe(Effect.mapError(() => denied(root)));
        if (top !== root)
          return yield* new ComposeConflict({
            details: {
              reason: "needs_own_repo",
              ids: [...needsOwnRepo],
              path: top,
            },
          });
      }
    }
  });

const readLive = (root: string, rel: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const checkLink = (at: string) =>
      Effect.gen(function* () {
        const real = yield* fs.realPath(at).pipe(Effect.mapError(() => denied(at)));
        if (!within(root, real, path.sep)) return yield* denied(at);
      });
    const liveType = (at: string) =>
      fs.lstat(at).pipe(
        Effect.map((value) => value.type),
        Effect.catch((error) =>
          absent(error) || error.reason._tag === "BadResource"
            ? Effect.succeed("Missing")
            : Effect.fail(denied(at)),
        ),
      );
    // Check every existing prefix before reading: a live ancestor must not escape the project.
    let at = root;
    for (const part of rel.split("/")) {
      at = path.join(at, part);
      const info = yield* liveType(at);
      if (info === "Missing") return undefined;
      if (at === path.join(root, rel) && info === "Directory")
        return yield* new PermissionDenied({ details: { reason: "blocked", path: at } });
      if (info === "SymbolicLink") yield* checkLink(at);
    }
    return yield* fs
      .readFile(path.join(root, rel))
      .pipe(Effect.mapError(() => denied(path.join(root, rel))));
  });

/** Read-only classification. The live tree is never a merge target (D4). */
export const planAdd = (input: {
  readonly root: string;
  readonly composition: Composition<Entry | null>;
  readonly rendered: ReadonlyArray<{ file: PlannedFile; bytes: Uint8Array }>;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* checkAddRoot(input.root);
    const root = yield* fs.realPath(input.root).pipe(Effect.mapError(() => denied(input.root)));
    yield* checkOwnRepo(root, input.composition.needsOwnRepo);
    const incoming: string[] = [];
    const walk = (rel: string): Effect.Effect<void, PermissionDenied> =>
      Effect.gen(function* () {
        const at = path.join(root, rel);
        const names = yield* fs
          .readDirectory(at)
          .pipe(
            Effect.catch((error) => (absent(error) ? Effect.succeed([]) : Effect.fail(denied(at)))),
          );
        for (const name of [...names].sort()) {
          const child = `${rel}/${name}`;
          const info = yield* fs
            .lstat(path.join(root, child))
            .pipe(Effect.mapError(() => denied(child)));
          if (info.type === "Directory") yield* walk(child);
          else if (info.type === "File") incoming.push(child);
          else return yield* denied(path.join(root, child));
        }
      });
    yield* walk(INCOMING);
    const same = (a: Uint8Array, b: Uint8Array) =>
      a.length === b.length && a.every((byte, i) => byte === b[i]);
    const write: Array<PlannedFile & { readonly bytes: Uint8Array }> = [];
    const park: Array<AddPlan["park"][number]> = [];
    const skipped: string[] = [];
    const candidates = yield* Effect.forEach(input.rendered, (item) =>
      readLive(root, item.file.path).pipe(Effect.map((live) => ({ ...item, live }))),
    );
    // A numbered copy must not claim another contribution's primary path or directory.
    const reserved = new Set<string>();
    const reserve = (rel: string) => {
      const parts = rel.split("/");
      for (let depth = 1; depth <= parts.length; depth++)
        reserved.add(parts.slice(0, depth).join("/"));
    };
    for (const { file, bytes, live } of candidates)
      if (live !== undefined && !same(live, bytes)) reserve(`${INCOMING}/${file.path}`);
    for (const file of incoming) reserve(file);
    const mergeParked = (
      file: PlannedFile,
      bytes: Uint8Array,
      destination: string,
      parked: Uint8Array,
    ) =>
      Effect.gen(function* () {
        const merged = yield* Effect.option(
          Effect.try(() => {
            const previous: unknown = JSON.parse(decoder.decode(parked));
            const next: unknown = JSON.parse(decoder.decode(bytes));
            return `${JSON.stringify(deepMerge(previous, next), null, 2)}\n`;
          }),
        );
        if (Option.isSome(merged))
          park.push({
            file: { ...file, kind: "merge", content: merged.value },
            bytes: encoder.encode(merged.value),
            incoming: destination,
            action: "merge",
          });
        else {
          let suffix = 2;
          while (
            reserved.has(`${destination}.${suffix}`) ||
            (yield* fs.exists(path.join(root, `${destination}.${suffix}`)))
          )
            suffix++;
          const copy = `${destination}.${suffix}`;
          reserve(copy);
          park.push({ file, bytes, incoming: copy, action: "copy" });
          incoming.push(copy);
        }
      });
    const parkConflict = (file: PlannedFile, bytes: Uint8Array) =>
      Effect.gen(function* () {
        const destination = `${INCOMING}/${file.path}`;
        const parked = yield* readLive(root, destination);
        if (parked === undefined) {
          park.push({ file, bytes, incoming: destination, action: "new" });
          incoming.push(destination);
          return;
        }
        if (same(parked, bytes)) {
          skipped.push(file.path);
          return;
        }
        yield* mergeParked(file, bytes, destination, parked);
      });
    const classify = ({ file, bytes, live }: (typeof candidates)[number]) =>
      Effect.gen(function* () {
        if (live === undefined) {
          write.push({ ...file, bytes });
          return;
        }
        if (same(live, bytes)) {
          skipped.push(file.path);
          return;
        }
        yield* parkConflict(file, bytes);
      });
    for (const candidate of candidates) yield* classify(candidate);
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
