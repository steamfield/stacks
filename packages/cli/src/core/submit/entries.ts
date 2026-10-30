import type { Kind } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path } from "effect";
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

/** An id in the user registry: the one kind that has it, or a did-you-mean over both. */
const userEntry = Effect.fn("submit.userEntry")(function* (id: string) {
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
  if (only === undefined)
    return yield* new NotFound({ details: { id, suggestions: closest(id, [...new Set(known)]) } });
  if (more.length) return yield* new BadInput({ details: { id, flag: "submit_entry" } });
  return only;
});

/**
 * The entries `submit` was given: each an entry directory (`<root>/stacks/<id>`), or an id in
 * the user registry. A path that names a whole registry, or an id both kinds use, is refused;
 * the same entry given twice is submitted once.
 */
export const resolveEntries = Effect.fn("submit.resolveEntries")(function* (
  given: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const host = yield* Host;
  const entries: SubmittedEntry[] = [];
  for (const value of given) {
    const entry = (yield* isDirectory(fs, path.resolve(host.cwd, value)))
      ? yield* directoryEntry(value)
      : yield* userEntry(value);
    if (!entries.some((seen) => seen.kind === entry.kind && seen.id === entry.id))
      entries.push(entry);
  }
  return entries;
});

const directoryEntry = Effect.fn("submit.directoryEntry")(function* (value: string) {
  const path = yield* Path.Path;
  const target: Target = yield* resolveTarget(value);
  if (target.only === undefined)
    return yield* new BadInput({ details: { id: value, flag: "submit_entry" } });
  const { kind, id } = target.only;
  return {
    kind,
    id,
    root: target.root,
    dir: path.join(target.root, kindDir(kind), id),
  } satisfies SubmittedEntry;
});
