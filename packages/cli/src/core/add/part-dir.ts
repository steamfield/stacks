/**
 * Refuses `add` run inside a workspace part's directory. The brief tells agents a part's commands
 * run there, and without this an `add` from there would find no manifest and start a nested
 * single-stack project inside the part.
 */
import { Effect, FileSystem, Path } from "effect";
import { BadInput } from "../../errors";
import { isAbsent } from "../fs/absent";
import { denied } from "../fs/denied";
import { locateManifest, readManifest } from "../project/manifest";

/**
 * For a `root` with no manifest of its own: the nearest manifest above it, and if that project's
 * `parts` names `root` (compared as real paths, so a symlinked path still matches), `BadInput`
 * `part_dir` naming the part and the workspace root. Anywhere else it succeeds and changes nothing.
 */
export const refusePartDirectory = Effect.fn("add.refusePartDirectory")(function* (root: string) {
  const path = yield* Path.Path;
  // Walk up from the real path, so a symlink to a part directory finds the workspace above it.
  const here = yield* realPath(root);
  if (here === undefined) return;
  const parent = path.dirname(here);
  if (parent === here) return;
  const found = yield* locateManifest(parent).pipe(
    Effect.catchTag("NotFound", () => Effect.succeed(undefined)),
  );
  if (!found) return;
  // A manifest that doesn't decode records no parts this CLI can trust, so it names no part here.
  const manifest = yield* readManifest(found.path).pipe(
    Effect.catchTags({
      NotFound: () => Effect.succeed(undefined),
      InvalidConfig: () => Effect.succeed(undefined),
    }),
  );
  for (const part of manifest?.parts ?? []) {
    const dir = yield* realPath(path.join(found.root, part.name));
    if (dir === here)
      return yield* new BadInput({
        details: { flag: "part_dir", part: part.name, root: found.root },
      });
  }
});

/** The real path, or `undefined` for a path that doesn't exist (a part directory removed since). */
const realPath = (at: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs
      .realPath(at)
      .pipe(
        Effect.catch((error) =>
          isAbsent(error) ? Effect.succeed(undefined) : Effect.fail(denied("read", at)),
        ),
      );
  });
