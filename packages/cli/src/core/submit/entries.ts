import { Kebab, type Kind } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path, Schema } from "effect";
import { AppConfig } from "../../config";
import { BadInput, NotFound } from "../../errors";
import { Host } from "../../services/host";
import { closest } from "../suggest";
import { resolveTarget, type Target } from "../validate/target";

/** An entry to submit: its registry root and directory where the author keeps it. */
export type SubmittedEntry = { kind: Kind; id: string; root: string; dir: string };

const KIND_DIRS = [
  { kind: "stack", dir: "stacks" },
  { kind: "fragment", dir: "fragments" },
] as const;

export const kindDir = (kind: Kind) => (kind === "stack" ? "stacks" : "fragments");

const isDirectory = (fs: FileSystem.FileSystem, at: string) =>
  fs.stat(at).pipe(
    Effect.map((info) => info.type === "Directory"),
    Effect.orElseSucceed(() => false),
  );

/** An entry id is kebab-case; anything else (`../x`, `Demo_App`) is refused before any lookup. */
const checkId = (id: string) =>
  Schema.is(Kebab)(id)
    ? Effect.void
    : Effect.fail(new BadInput({ details: { id, flag: "submit_id" } }));

/**
 * An argument is a path when it has a path separator or starts with `.` or `~`; anything else is
 * a user registry id, even when the working directory has a folder by that name.
 */
const isPath = (value: string) => /[/\\]/.test(value) || /^[.~]/.test(value);

/** An id in the user registry: the one kind that has it, or a did-you-mean over both. */
const userEntry = Effect.fn("submit.userEntry")(function* (id: string) {
  yield* checkId(id);
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = (yield* (yield* AppConfig).paths).user;
  const found: SubmittedEntry[] = [];
  const known: string[] = [];
  for (const { kind, dir } of KIND_DIRS) {
    const at = path.join(root, dir, id);
    if (yield* isDirectory(fs, at)) found.push({ kind, id, root, dir: at });
    known.push(
      ...(yield* fs.readDirectory(path.join(root, dir)).pipe(Effect.orElseSucceed(() => []))),
    );
  }
  const [only, ...more] = found;
  if (only === undefined) {
    // A folder by that name in the working directory was probably meant as a path.
    const local = yield* isDirectory(fs, path.resolve((yield* Host).cwd, id));
    return yield* new NotFound({
      details: {
        id,
        suggestions: closest(id, [...new Set(known)]),
        ...(local ? { directory: `./${id}` } : {}),
      },
    });
  }
  if (more.length) return yield* new BadInput({ details: { id, flag: "submit_entry" } });
  return only;
});

/**
 * The entries `submit` was given: each an entry directory (`<root>/stacks/<id>`), or an id in
 * the user registry (see `isPath`). A path that names a whole registry, an id both kinds use, or
 * an id that isn't kebab-case is refused; the same entry given twice is submitted once.
 */
export const resolveEntries = Effect.fn("submit.resolveEntries")(function* (
  given: ReadonlyArray<string>,
) {
  const entries: SubmittedEntry[] = [];
  for (const value of given) {
    const entry = isPath(value) ? yield* directoryEntry(value) : yield* userEntry(value);
    if (!entries.some((seen) => seen.kind === entry.kind && seen.id === entry.id))
      entries.push(entry);
  }
  return entries;
});

/** `~` and `~/...` name the home directory, for a caller that passed the path unexpanded. */
const expandHome = Effect.fn("submit.expandHome")(function* (value: string) {
  if (value !== "~" && !value.startsWith("~/")) return value;
  const path = yield* Path.Path;
  return path.join((yield* (yield* AppConfig).paths).home, value.slice(1));
});

const directoryEntry = Effect.fn("submit.directoryEntry")(function* (value: string) {
  const path = yield* Path.Path;
  const target: Target = yield* resolveTarget(yield* expandHome(value));
  if (target.only === undefined)
    return yield* new BadInput({ details: { id: value, flag: "submit_entry" } });
  const { kind, id } = target.only;
  yield* checkId(id);
  return {
    kind,
    id,
    root: target.root,
    dir: path.join(target.root, kindDir(kind), id),
  } satisfies SubmittedEntry;
});
