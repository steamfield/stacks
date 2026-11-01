import type { Kind } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path } from "effect";
import { NotFound } from "../../errors";
import { Host } from "../../services/host";
import { markdownFile } from "../registry/entry";
import { bundledRoot } from "../registry/registry";

/**
 * What `validate` checks: a registry root, and with `only` one entry under it. `bundled` is true
 * for the bundled registry (the shipped one, or STACKS_REGISTRY_DIR), which must be
 * self-contained.
 */
export type Target = {
  root: string;
  bundled: boolean;
  only?: { kind: Kind; id: string };
};

const kinds = [
  { kind: "stack", dir: "stacks" },
  { kind: "fragment", dir: "fragments" },
] as const;

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
    const bundled = yield* bundledRoot;
    const missing = (looked: string) => new NotFound({ details: { suggestions: [], looked } });
    const isDirectory = (at: string) =>
      fs.stat(at).pipe(
        Effect.map((info) => info.type === "Directory"),
        Effect.orElseSucceed(() => false),
      );
    const exists = (at: string) =>
      fs.lstat(at).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
    /** Paths compared by their real location, so a symlinked bundled root still counts. */
    const real = (at: string) => fs.realPath(at).pipe(Effect.orElseSucceed(() => at));
    const bundledReal = yield* real(bundled.path);
    const isBundled = (at: string) => real(at).pipe(Effect.map((found) => found === bundledReal));

    const registryDirectory = (at: string) =>
      Effect.gen(function* () {
        for (const dir of ["stacks", "fragments", "search"])
          if (yield* isDirectory(path.join(at, dir)))
            return { root: at, bundled: yield* isBundled(at) } satisfies Target;
        return undefined;
      });
    // A directory directly under `stacks/` or `fragments/` is that kind's entry, even with its
    // markdown file missing or the other kind's in its place: the checks report what's wrong.
    const entryDirectory = (at: string) =>
      Effect.gen(function* () {
        const parent = path.dirname(at);
        for (const { kind, dir } of kinds) {
          if (path.basename(parent) !== dir) continue;
          const root = path.dirname(parent);
          return {
            root,
            bundled: yield* isBundled(root),
            only: { kind, id: path.basename(at) },
          } satisfies Target;
        }
        return undefined;
      });

    const hasEntryFile = (at: string) =>
      Effect.gen(function* () {
        for (const { kind } of kinds)
          if (yield* exists(path.join(at, markdownFile(kind)))) return true;
        return false;
      });

    // A fragment can hold stacks/ overlays without becoming a registry root itself, and a
    // registry can sit in a directory named stacks/ (node_modules/@steamfield/stacks/registry):
    // the entry's own markdown file decides.
    const entryOrRegistry = (at: string) =>
      Effect.gen(function* () {
        const entry = yield* entryDirectory(at);
        if (entry && (yield* hasEntryFile(at))) return entry;
        return (yield* registryDirectory(at)) ?? entry;
      });

    if (given === undefined) {
      if (!bundled.found) return yield* missing(bundled.path);
      return { root: bundled.path, bundled: true } satisfies Target;
    }
    const at = path.resolve(host.cwd, given);
    if (!(yield* isDirectory(at))) return yield* missing(at);
    const found = yield* entryOrRegistry(at);
    if (found) return found;
    // An entry outside a `stacks/` or `fragments/` directory belongs to no registry.
    if (yield* hasEntryFile(at)) return yield* missing(at);
    if (yield* isBundled(at)) return { root: at, bundled: true } satisfies Target;
    return yield* missing(at);
  });
