/**
 * Loads one registry root from disk. Defer deep checks to keep an ordinary catalog read cheap.
 * See `loadedCandidate` for the newer-schema exception.
 */
import type { Kind } from "@steamfield/stacks-format";
import { Effect, type PlatformError } from "effect";
import { PermissionDenied } from "../../errors";
import { isAbsent } from "../fs/absent";
import { printable } from "../text/text";
import {
  decodeEntry,
  entryKey,
  markdownFile,
  type RegistryEntry,
  type RejectedEntry,
} from "./entry";
import { walkEntry } from "./tree";
import type { FileAccess, LocalRegistryRoot, Skipped } from "./types";

type CandidateInput = Pick<LocalRegistryRoot, "origin" | "trusted"> & {
  kind: Kind;
  dir: string;
  id: string;
};

export type LoadState = {
  io: FileAccess;
  skipped: Skipped[];
  /** Cache the outcome of `walkEntry` by entry directory. */
  treeChecks: Map<string, Effect.Effect<RejectedEntry | undefined>>;
};

const kinds = [
  { kind: "stack", dir: "stacks" },
  { kind: "fragment", dir: "fragments" },
] as const satisfies ReadonlyArray<{ kind: Kind; dir: string }>;

/** The supplied error is user-visible in command output and validation findings. */
const rejectCandidate = (
  { origin, kind, dir, id }: CandidateInput,
  reason: RejectedEntry["reason"],
  error: string,
  at?: string,
): RejectedEntry => ({
  _tag: "Rejected",
  id,
  kind,
  origin,
  dir,
  error,
  reason,
  ...(at === undefined ? {} : { path: at }),
});

type NewerEntry = { _tag: "Newer"; version: number };

/** The frontmatter id must match the directory name. */
const decodeCandidate = Effect.fnUntraced(function* (
  input: CandidateInput,
  text: string,
): Effect.fn.Return<RegistryEntry | NewerEntry> {
  const { origin, kind, dir, id, trusted } = input;
  const file = markdownFile(kind);
  const decoded = yield* decodeEntry(kind, text);
  switch (decoded._tag) {
    case "Newer":
      return { _tag: "Newer", version: decoded.version };
    case "Invalid":
      return rejectCandidate(input, "decode", decoded.error, file);
    case "Meta":
      if (decoded.meta.id !== id)
        return rejectCandidate(
          input,
          "id_mismatch",
          `id: ${JSON.stringify(decoded.meta.id)} must equal the directory name ${JSON.stringify(id)}`,
          file,
        );
      return {
        id,
        kind,
        origin,
        dir,
        meta: decoded.meta,
        body: decoded.body,
        shadows: [],
        trusted,
      };
  }
});

/** Reads the entry's `STACK.md` or `FRAGMENT.md`, refusing a symlink or anything but a file. */
const readCandidate = (input: CandidateInput, io: FileAccess) =>
  Effect.gen(function* () {
    const file = markdownFile(input.kind);
    const at = io.path.join(input.dir, file);
    const failed = (error: PlatformError.PlatformError) =>
      isAbsent(error)
        ? rejectCandidate(input, "missing", `${file} is missing`, file)
        : rejectCandidate(input, "unreadable", `${file} is unreadable`, file);
    const markdown = yield* Effect.result(io.fs.lstat(at));
    if (markdown._tag === "Failure") return failed(markdown.failure);
    if (markdown.success.type === "SymbolicLink")
      return rejectCandidate(input, "symlink", `symlink: ${file}`, file);
    if (markdown.success.type !== "File")
      return rejectCandidate(input, "unreadable", `${file} is unreadable`, file);
    const text = yield* Effect.result(io.fs.readFileString(at));
    if (text._tag === "Failure") return failed(text.failure);
    return yield* decodeCandidate(input, text.success);
  });

const checkCandidateTree = Effect.fnUntraced(function* (input: CandidateInput, io: FileAccess) {
  const walked = yield* Effect.result(walkEntry(io, input.dir));
  if (walked._tag === "Failure")
    return rejectCandidate(input, "unreadable", "the entry directory is unreadable", ".");
  if (walked.success._tag === "Link")
    return rejectCandidate(input, "symlink", `symlink: ${walked.success.rel}`, walked.success.rel);
  return undefined;
});

/**
 * Check a newer-schema entry immediately so a broken tree remains a rejection. Skipping a
 * sound newer entry lets a compatible lower-priority copy win.
 */
const loadedCandidate = Effect.fnUntraced(function* (input: CandidateInput, state: LoadState) {
  const check = yield* Effect.cached(checkCandidateTree(input, state.io));
  state.treeChecks.set(input.dir, check);
  const loaded = yield* readCandidate(input, state.io);
  if (loaded._tag !== "Newer") return loaded;
  const problem = yield* check;
  if (problem) return problem;
  const { origin, kind, id, dir } = input;
  yield* Effect.logWarning(
    `Skipped ${origin} ${kind} ${printable(id)}: schema_version ${loaded.version} is newer than this CLI reads`,
  );
  state.skipped.push({ reason: "newer", origin, kind, id, dir, version: loaded.version });
  return undefined;
});

/** Reject an unreadable or symlinked entry directory. A plain file in the collection is ignored. */
const readEntryDirectory = (input: CandidateInput, state: LoadState) =>
  Effect.gen(function* () {
    const self = yield* Effect.result(state.io.fs.lstat(input.dir));
    if (self._tag === "Failure")
      return rejectCandidate(input, "unreadable", "the entry directory is unreadable", ".");
    if (self.success.type === "SymbolicLink")
      return rejectCandidate(input, "symlink", "the entry directory is a symlink", ".");
    if (self.success.type !== "Directory") return undefined;
    return yield* loadedCandidate(input, state);
  });

/** Names in a directory, sorted; a missing directory is empty and an unreadable one is denied. */
const sortedNames = ({ fs }: FileAccess, dir: string) =>
  fs.readDirectory(dir).pipe(
    Effect.map((found) => [...found].sort()),
    Effect.catch((error) =>
      isAbsent(error)
        ? Effect.succeed<Array<string>>([])
        : Effect.fail(new PermissionDenied({ details: { reason: "read", path: dir } })),
    ),
  );

const linkedProjectDir = ({ fs }: FileAccess, dir: string) =>
  fs.lstat(dir).pipe(
    Effect.map((info) => info.type === "SymbolicLink"),
    Effect.orElseSucceed(() => false),
    Effect.tap((link) =>
      link
        ? Effect.logWarning(`Skipped the project registry at ${printable(dir)}: it is a symlink`)
        : Effect.void,
    ),
  );

/**
 * Project roots and their stack and fragment collections are checked because the checkout controls
 * them. User and bundled roots can be symlinked by the user or package manager.
 */
const skippedAsLink = (root: LocalRegistryRoot, dir: string, state: LoadState) =>
  Effect.gen(function* () {
    if (root.origin !== "project" || !(yield* linkedProjectDir(state.io, dir))) return false;
    state.skipped.push({ reason: "symlink", origin: root.origin, dir });
    return true;
  });

type CandidatesByKey = Map<string, RegistryEntry[]>;

const loadKind = Effect.fnUntraced(function* (
  root: LocalRegistryRoot,
  { kind, dir }: (typeof kinds)[number],
  state: LoadState,
  found: CandidatesByKey,
) {
  const { io } = state;
  const parent = io.path.join(root.path, dir);
  if (yield* skippedAsLink(root, parent, state)) return;
  for (const id of yield* sortedNames(io, parent)) {
    const input = {
      origin: root.origin,
      trusted: root.trusted,
      kind,
      dir: io.path.join(parent, id),
      id,
    };
    const loaded = yield* readEntryDirectory(input, state);
    if (!loaded) continue;
    const key = entryKey(kind, id);
    found.set(key, [...(found.get(key) ?? []), loaded]);
  }
});

/**
 * Append candidates after the higher roots, stacks first and then fragments, each sorted by name.
 */
export const loadRoot = (root: LocalRegistryRoot, state: LoadState, found: CandidatesByKey) =>
  Effect.gen(function* () {
    if (yield* skippedAsLink(root, root.path, state)) return;
    for (const kind of kinds) yield* loadKind(root, kind, state, found);
  });
