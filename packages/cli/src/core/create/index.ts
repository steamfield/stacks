/**
 * Creates editable entries in the user registry through `openProject`. Copying elevates an
 * untrusted source to a trusted destination, so it requires `confirmUntrustedCopy` (trust points
 * 3 and 4). `readSnapshot` gathers the full file tree as data before writes (trust point 1).
 */
import type { Category, Kind } from "@steamfield/stacks-format";
import { Effect, FileSystem, Option, Path, Schema, Terminal } from "effect";
import { AppConfig } from "../../config";
import { BadInput, Interrupted, NotFound, PermissionDenied } from "../../errors";
import type { CreateResult } from "../../schemas/create";
import type { Origin } from "../../schemas/origin";
import { Host } from "../../services/host";
import { Output } from "../../services/output";
import { type Entry, isRejected, markdownFile } from "../registry/entry";
import { Registry } from "../registry/registry";
import { defaultRoots, type RegistryRoots } from "../registry/roots";
import { openProject } from "../scaffold/write";
import { sidecarPath } from "../search/sidecar";
import { showReport } from "../show/index";
import { renderShow } from "../show/report";
import { closest } from "../text/suggest";
import { skeleton, starterFiles, trustQuestion } from "./text";

const EntryId = Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/));

export type CreateOptions = {
  kind: Kind;
  id: string;
  from: Origin | undefined;
  category: Category;
  yes: boolean;
};

/** The files of a new entry, gathered in full before anything is written. */
type Snapshot = {
  /** The entry's search sidecar, written beside the entry tree in the user registry. */
  search?: Uint8Array;
  directories: ReadonlyArray<string>;
  files: ReadonlyArray<{ source: string; bytes: Uint8Array; permissions: boolean | number }>;
};

/** A skeleton cannot shadow an existing entry of the same id, as enforced by `refuseShadow`. */
export const createEntry = (options: CreateOptions) =>
  Effect.gen(function* () {
    const { kind, id, from, category, yes } = options;
    if (!Schema.is(EntryId)(id)) return yield* new BadInput({ details: { id, flag: "create_id" } });
    // A copy into the user registry from the user registry would copy an entry onto itself.
    if (from === "user") return yield* new BadInput({ details: { id: from, flag: "from" } });
    const paths = yield* (yield* AppConfig).paths;
    const path = yield* Path.Path;
    const host = yield* Host;
    const userRoot = path.resolve(host.cwd, paths.user);
    const target = path.resolve(userRoot, kind === "stack" ? "stacks" : "fragments", id);
    yield* refuseExistingTarget(target);
    if (!from) yield* refuseShadow(kind, id);
    const snapshot = from
      ? yield* copySnapshot({ kind, id, from, yes })
      : skeletonSnapshot(kind, id, category);
    yield* writeSnapshot({ target, userRoot, entry: { kind, id }, snapshot });
    return { kind, id, path: target, guide: host.authoring } satisfies CreateResult;
  });

const occupied = (target: string) =>
  new BadInput({ details: { id: target, flag: "create_target" } });

/**
 * Fails when anything, even a dangling symlink, is at `target`. A missing path or a non-directory
 * on the way counts as free; any other read failure means the CLI couldn't look.
 */
const refuseExistingTarget = (target: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const existing = yield* fs.lstat(target).pipe(
      Effect.map(Option.some),
      Effect.catch((error) =>
        error.reason._tag === "NotFound" || error.reason._tag === "BadResource"
          ? Effect.succeed(Option.none())
          : Effect.fail(new PermissionDenied({ details: { reason: "read", path: target } })),
      ),
    );
    if (Option.isSome(existing)) return yield* occupied(target);
  });

/** A new skeleton may not reuse the id of an entry any registry root already has. */
const refuseShadow = (kind: Kind, id: string) =>
  Effect.gen(function* () {
    const roots = yield* defaultRoots;
    const existing = yield* Registry.pipe(
      Effect.flatMap((registry) => registry.get(kind, id)),
      Effect.map(Option.some),
      Effect.catchTag("NotFound", () => Effect.succeed(Option.none())),
      Effect.provide(Registry.layer(roots)),
    );
    if (Option.isSome(existing))
      return yield* new BadInput({
        details: {
          id,
          flag: "create_shadows",
          origins: [existing.value.origin, ...existing.value.shadows],
        },
      });
  });

/**
 * Writes the entry tree with an exclusive writer, so an existing target is refused rather than
 * merged, then the search sidecar into the user registry. Rollback is `openProject`'s.
 */
const writeSnapshot = (input: {
  target: string;
  userRoot: string;
  entry: { kind: Kind; id: string };
  snapshot: Snapshot;
}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { snapshot } = input;
      const writer = yield* openProject(input.target, { exclusive: true });
      for (const directory of snapshot.directories) yield* writer.directory(directory);
      for (const file of snapshot.files)
        yield* writer.write(file.source, file.bytes, file.permissions);
      if (snapshot.search !== undefined) {
        const registryWriter = yield* openProject(input.userRoot);
        yield* registryWriter.write(sidecarPath(input.entry), snapshot.search);
      }
    }),
  ).pipe(Effect.catchTag("TargetNotEmpty", () => Effect.fail(occupied(input.target))));

/** The fixed skeleton of a fresh entry. */
function skeletonSnapshot(kind: Kind, id: string, category: Category): Snapshot {
  const encoder = new TextEncoder();
  const texts = [
    { source: markdownFile(kind), text: skeleton(kind, id, category) },
    ...(kind === "stack" ? starterFiles : []),
  ];
  return {
    directories: [],
    files: texts.map((file) => ({
      source: file.source,
      bytes: encoder.encode(file.text),
      permissions: false,
    })),
  };
}

type CopySource = { kind: Kind; id: string; from: Origin; yes: boolean };

/** Reads the tree from the requested origin, with `confirmUntrustedCopy` for untrusted entries. */
const copySnapshot = (source: CopySource) =>
  Effect.gen(function* () {
    const roots = yield* defaultRoots;
    const sourceRoots = roots.filter((root) => root.origin === source.from);
    // Keep the named origin first, while resolving its dependencies through the normal roots.
    const reportRoots = [...sourceRoots, ...roots.filter((root) => root.origin !== source.from)];
    return yield* Effect.gen(function* () {
      const entry = yield* findEntry(source.kind, source.id);
      if (!entry.trusted) yield* confirmUntrustedCopy({ ...source, entry, reportRoots });
      return yield* readSnapshot(entry);
    }).pipe(Effect.provide(Registry.layer(sourceRoots)));
  });

/** The entry from the current registry, or `NotFound` with close ids of the same kind. */
const findEntry = (kind: Kind, id: string) =>
  Effect.gen(function* () {
    const registry = yield* Registry;
    return yield* registry.get(kind, id).pipe(
      Effect.catchTag("NotFound", () =>
        Effect.gen(function* () {
          const usable = (yield* registry.all).filter(
            (entry) => entry.kind === kind && !isRejected(entry),
          );
          return yield* new NotFound({
            details: {
              id,
              kind,
              suggestions: closest(
                id,
                usable.map((entry) => entry.id),
              ),
            },
          });
        }),
      ),
    );
  });

/**
 * Copying an untrusted entry needs a person (trust points 3 and 4): refused under an agent or
 * without a terminal on stdin; otherwise the full report, then a yes unless `--yes` was given.
 */
const confirmUntrustedCopy = (input: CopySource & { entry: Entry; reportRoots: RegistryRoots }) =>
  Effect.gen(function* () {
    const agent = yield* (yield* AppConfig).agent;
    const host = yield* Host;
    if (agent !== "none" || !host.stdinIsTTY)
      return yield* new PermissionDenied({
        details: { reason: agent !== "none" ? "agent" : "no-tty", path: input.entry.dir },
      });
    const output = yield* Output;
    const report = yield* showReport(input.id, input.kind, input.reportRoots);
    yield* output.note(renderShow(report, host.invocation));
    if (!input.yes) yield* askTrust(input.id);
  });

const askTrust = (id: string) =>
  Effect.gen(function* () {
    yield* (yield* Output).note(trustQuestion);
    const answer = yield* (yield* Terminal.Terminal).readLine.pipe(
      Effect.mapError(() => new Interrupted()),
    );
    if (!/^(?:y|yes)$/i.test(answer.trim()))
      return yield* new BadInput({ details: { id, flag: "confirmation" } });
  });

/** Every directory, file (with its mode) and the search sidecar of `entry`. */
const readSnapshot = (entry: Entry) =>
  Effect.gen(function* () {
    const registry = yield* Registry;
    const tree = yield* registry.tree(entry);
    const files = yield* Effect.forEach(tree.files, (file) =>
      registry
        .bytes(entry, file.source)
        .pipe(Effect.map((bytes) => ({ source: file.source, bytes, permissions: file.mode }))),
    );
    const search = yield* registry.search(entry);
    return {
      directories: tree.directories,
      files,
      ...(search === undefined ? {} : { search }),
    } satisfies Snapshot;
  });
