/**
 * Makes paths inside the working directory relative for text output. Structured output keeps
 * absolute paths so readers can resolve them independently of their own working directory.
 * Error details also stay absolute because `failureGuide` has no working directory.
 */
import { Effect, FileSystem, Path } from "effect";

/** `to` relative to `from` when it is `from` (`.`) or inside it; otherwise `undefined`. */
function relativeInside(path: Path.Path, from: string, to: string): string | undefined {
  const relative = path.relative(from, to);
  if (relative === "") return ".";
  const outside =
    relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  return outside ? undefined : relative;
}

/**
 * `target` as text output shows it: relative to `cwd` when it is `cwd` (`.`) or inside it,
 * otherwise `target` unchanged. When the given paths don't nest, their real paths are compared
 * too, so a cwd reached through a symlink, or `/var` against `/private/var` on macOS, still gives
 * the short form. A path that can't be resolved is compared as given.
 */
export const shownPath = Effect.fn("shownPath")(function* (cwd: string, target: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const given = relativeInside(path, cwd, target);
  if (given !== undefined) return given;
  const real = (at: string) => fs.realPath(at).pipe(Effect.orElseSucceed(() => at));
  return relativeInside(path, yield* real(cwd), yield* real(target)) ?? target;
});
