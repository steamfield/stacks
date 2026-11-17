/**
 * Resolves validation to a registry root or single entry and identifies the bundled target for
 * `validationRoots`.
 */
import type { Kind } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path } from "effect";
import { NotFound } from "../../errors";
import { Host } from "../../services/host";
import { markdownFile } from "../registry/entry";
import { bundledRoot } from "../registry/roots";

/**
 * What `validate` checks: a registry root, and with `only` one entry under it. `asBundled`
 * keeps resolution inside the target, including when `bundledRoot` resolves an override.
 */
export type Target = {
  root: string;
  asBundled: boolean;
  only?: { kind: Kind; id: string };
};

const kinds = [
  { kind: "stack", dir: "stacks" },
  { kind: "fragment", dir: "fragments" },
] as const;

type Probe = { fs: FileSystem.FileSystem; path: Path.Path; bundledReal: string };

const missing = (looked: string) => new NotFound({ details: { suggestions: [], looked } });

/** Whether `at` is a directory, following symlinks; anything unreadable counts as not. */
const isDirectory = (fs: FileSystem.FileSystem, at: string) =>
  fs.stat(at).pipe(
    Effect.map((info) => info.type === "Directory"),
    Effect.orElseSucceed(() => false),
  );

/** Whether anything, even a broken symlink, is at `at`. */
const exists = (fs: FileSystem.FileSystem, at: string) =>
  fs.lstat(at).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );

/** Paths compared by their real location, so a symlinked bundled root still counts. */
const realPath = (fs: FileSystem.FileSystem, at: string) =>
  fs.realPath(at).pipe(Effect.orElseSucceed(() => at));

const isBundled = ({ fs, bundledReal }: Probe, at: string) =>
  realPath(fs, at).pipe(Effect.map((found) => found === bundledReal));

/** `at` as a registry root, when it holds `stacks/`, `fragments/` or `search/`. */
const registryDirectory = (probe: Probe, at: string) =>
  Effect.gen(function* () {
    for (const dir of ["stacks", "fragments", "search"])
      if (yield* isDirectory(probe.fs, probe.path.join(at, dir)))
        return { root: at, asBundled: yield* isBundled(probe, at) } satisfies Target;
    return undefined;
  });

/**
 * `at` as an entry, when it sits directly under `stacks/` or `fragments/`. That holds even with its
 * markdown file missing or the other kind's in its place: the checks report what's wrong.
 */
const entryDirectory = (probe: Probe, at: string) =>
  Effect.gen(function* () {
    const { path } = probe;
    const parent = path.dirname(at);
    for (const { kind, dir } of kinds) {
      if (path.basename(parent) !== dir) continue;
      const root = path.dirname(parent);
      return {
        root,
        asBundled: yield* isBundled(probe, root),
        only: { kind, id: path.basename(at) },
      } satisfies Target;
    }
    return undefined;
  });

const hasEntryFile = (probe: Probe, at: string) =>
  Effect.gen(function* () {
    for (const { kind } of kinds)
      if (yield* exists(probe.fs, probe.path.join(at, markdownFile(kind)))) return true;
    return false;
  });

/**
 * A fragment can hold stacks/ overlays without becoming a registry root itself, and a registry
 * can sit in a directory named stacks/ (node_modules/@steamfield/stacks/registry): when `at` could
 * be either, the entry's own markdown file decides.
 */
const entryOrRegistry = (probe: Probe, at: string) =>
  Effect.gen(function* () {
    const entry = yield* entryDirectory(probe, at);
    if (entry && (yield* hasEntryFile(probe, at))) return entry;
    return (yield* registryDirectory(probe, at)) ?? entry;
  });

const resolveGiven = (probe: Probe, at: string) =>
  Effect.gen(function* () {
    if (!(yield* isDirectory(probe.fs, at))) return yield* missing(at);
    const found = yield* entryOrRegistry(probe, at);
    if (found) return found;
    // An entry outside a `stacks/` or `fragments/` directory belongs to no registry.
    if (yield* hasEntryFile(probe, at)) return yield* missing(at);
    // The bundled registry's own directory is a root even while it holds no entries.
    if (yield* isBundled(probe, at)) return { root: at, asBundled: true } satisfies Target;
    return yield* missing(at);
  });

/**
 * The target for `validate [path]`: no path is the bundled registry; a path is a registry root
 * (it holds `stacks/` or `fragments/`), an entry directory inside one (`<root>/stacks/<id>`), or
 * the bundled registry's own directory, which is a root even while it holds no entries. Anything
 * else, or a path that doesn't exist, is `NotFound` naming the path.
 */
export const resolveTarget = (given: string | undefined) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const host = yield* Host;
    const registryRoot = yield* bundledRoot;
    const probe: Probe = { fs, path, bundledReal: yield* realPath(fs, registryRoot.path) };
    if (given === undefined) {
      if (!registryRoot.found) return yield* missing(registryRoot.path);
      return { root: registryRoot.path, asBundled: true } satisfies Target;
    }
    return yield* resolveGiven(probe, path.resolve(host.cwd, given));
  });
