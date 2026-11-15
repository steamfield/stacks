/**
 * Shortens a path for text output: a file inside the directory the user ran the command from is
 * printed relative to it, so a project made in the current directory prints as `my-app` rather
 * than its full absolute path.
 *
 * Commands that print a path in their human or agent text (`commands/list.ts`, `show.ts`,
 * `create.ts`, `skill.ts`, `validate.ts` and the handoff in `handoff.ts`) pass it through
 * `shownPath`. `--json` output and error details keep absolute paths, since a program reading
 * them has no working directory to resolve against (`.claude/rules/cli/cli.md`, "Three
 * audiences").
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
