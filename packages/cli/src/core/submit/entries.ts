/**
 * Resolves submission arguments as user registry ids or entry directories. Path arguments use
 * `resolveTarget` to match validation.
 */
import { Kebab, type Kind } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path, Schema } from "effect";
import { AppConfig } from "../../config";
import { BadInput, NotFound } from "../../errors";
import { Host } from "../../services/host";
import { closest } from "../suggest";
import { resolveTarget, type Target } from "../validate/target";

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

/** Require kebab-case before id lookup so paths and malformed names cannot act as ids. */
const checkId = (id: string) =>
  Schema.is(Kebab)(id)
    ? Effect.void
    : Effect.fail(new BadInput({ details: { id, flag: "submit_id" } }));

/**
 * An argument is a path when it has a path separator or starts with `.` or `~`; anything else is
 * a user registry id, even when the working directory has a folder by that name.
 */
const isPath = (value: string) => /[/\\]/.test(value) || /^[.~]/.test(value);

/** The `NotFound` for an id in neither kind, with a did-you-mean over every user registry id. */
const unknownId = Effect.fn("submit.unknownId")(function* (
  id: string,
  known: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // A folder by that name in the working directory was probably meant as a path.
  const local = yield* isDirectory(fs, path.resolve((yield* Host).cwd, id));
  return yield* new NotFound({
    details: {
      id,
      suggestions: closest(id, [...new Set(known)]),
      ...(local ? { directory: `./${id}` } : {}),
    },
  });
});

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
  if (only === undefined) return yield* unknownId(id, known);
  if (more.length) return yield* new BadInput({ details: { id, flag: "submit_entry" } });
  return only;
});

/** `~` and `~/...` name the home directory, for a caller that passed the path unexpanded. */
const expandHome = Effect.fn("submit.expandHome")(function* (value: string) {
  if (value !== "~" && !value.startsWith("~/")) return value;
  const path = yield* Path.Path;
  return path.join((yield* (yield* AppConfig).paths).home, value.slice(1));
});

/** A path argument: it must name exactly one entry directory, not a whole registry. */
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

/**
 * Require an entry directory or an unambiguous kebab-case id. Deduplicate repeated references to
 * one entry.
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
