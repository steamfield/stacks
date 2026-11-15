/**
 * Reads one registry root from disk into candidates, one per entry directory such as
 * `stacks/bun-api/`: a loaded entry, a rejection that says what is wrong with it, or nothing.
 *
 * `registry.ts` calls `loadRoot` for each root in priority order, then decides which root's
 * candidate wins each kind and id. Loading reads only each entry's directory and its `STACK.md` or
 * `FRAGMENT.md`, so listing a large registry stays cheap. The deep check of everything inside an
 * entry (no symlink anywhere, every directory readable) is set up here as a lazy, cached effect in
 * `LoadState.checks`, keyed by the entry directory. It runs only when a caller asks for that entry
 * (`Registry.get`, `files`, `read` and the rest) or for all of them (`Registry.all`).
 *
 * A rejection message is the text `list` and `validate` print for a broken entry, so its wording
 * is user-visible. An entry whose `schema_version` is newer than this CLI reads is skipped rather
 * than rejected, so a lower root's older copy can win instead. The project root is held to a
 * stricter rule than the others: it, or its `stacks/` or `fragments/`, is skipped whole when it is
 * a symlink, because a checkout controls it.
 */
import type { Kind } from "@steamfield/stacks-format";
import { Effect, type PlatformError } from "effect";
import { PermissionDenied } from "../../errors";
import { isAbsent } from "../absent";
import { printable } from "../text";
import { decodeEntry, markdownFile, type Origin } from "./entry";
import { walkEntry } from "./tree";
import type {
  Candidate,
  FileAccess,
  Reason,
  RegistryRoot,
  Rejection,
  RootCandidate,
  Skipped,
} from "./types";

/** Where a candidate came from: its root's origin, its kind, its directory and directory name. */
type CandidateInput = { origin: Origin; kind: Kind; dir: string; id: string };

type RejectedCandidate = Extract<Candidate, { _tag: "Rejected" }>;

/**
 * The layer's loading state: `skipped` collects what loading passed over, and `checks` holds each
 * entry directory's cached deep check.
 */
export type LoadState = {
  io: FileAccess;
  skipped: Skipped[];
  checks: Map<string, Effect.Effect<Rejection | undefined>>;
};

const kinds = [
  { kind: "stack", dir: "stacks" },
  { kind: "fragment", dir: "fragments" },
] as const satisfies ReadonlyArray<{ kind: Kind; dir: string }>;

/** `at` is the entry-relative path the rejection names, when there is one. */
const rejectCandidate = (
  { origin, kind, dir, id }: CandidateInput,
  reason: Reason,
  error: string,
  at?: string,
): RejectedCandidate => ({
  _tag: "Rejected",
  rejection: {
    rejected: { id, kind, origin, dir, error },
    reason,
    ...(at === undefined ? {} : { path: at }),
  },
});

/** Decodes the markdown text; the frontmatter `id` must equal the directory name. */
const decodeCandidate = (input: CandidateInput, text: string) =>
  Effect.gen(function* () {
    const { origin, kind, dir, id } = input;
    const file = markdownFile(kind);
    const decoded = yield* decodeEntry(kind, text);
    switch (decoded._tag) {
      case "Newer":
        return { _tag: "Newer" as const, version: decoded.version };
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
          _tag: "Entry" as const,
          entry: { id, kind, origin, dir, meta: decoded.meta, body: decoded.body },
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

/** The deep check: the first symlink anywhere in the entry, or an unreadable directory. */
const checkCandidateTree = (input: CandidateInput, io: FileAccess) =>
  Effect.gen(function* () {
    const walked = yield* Effect.result(walkEntry(io, input.dir));
    if (walked._tag === "Failure")
      return rejectCandidate(input, "unreadable", "the entry directory is unreadable", ".")
        .rejection;
    if (walked.success._tag === "Link")
      return rejectCandidate(input, "symlink", `symlink: ${walked.success.rel}`, walked.success.rel)
        .rejection;
    return undefined;
  });

/**
 * Registers the entry's deep check, then reads its markdown. A newer `schema_version` runs the
 * deep check right away: a broken directory stays a rejection, a sound one is logged and skipped.
 */
const loadedCandidate = (input: CandidateInput, state: LoadState) =>
  Effect.gen(function* () {
    const check = yield* Effect.cached(checkCandidateTree(input, state.io));
    state.checks.set(input.dir, check);
    const loaded = yield* readCandidate(input, state.io);
    if (loaded._tag !== "Newer") return loaded;
    const problem = yield* check;
    if (problem) return { _tag: "Rejected" as const, rejection: problem };
    const { origin, kind, id, dir } = input;
    yield* Effect.logWarning(
      `Skipped ${origin} ${kind} ${printable(id)}: schema_version ${loaded.version} is newer than this CLI reads`,
    );
    state.skipped.push({ reason: "newer", origin, kind, id, dir, version: loaded.version });
    return undefined;
  });

/**
 * One name under a root's `stacks/` or `fragments/`. The entry directory itself must be a real
 * directory: a symlink or an unreadable one is rejected, and a plain file there is ignored.
 */
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

/** True when a project registry directory is a symlink, logging that it is skipped. */
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
 * Whether a root or one of its directories is skipped as a symlink, which applies to the project
 * root only. A skipped directory is recorded in `skipped`.
 */
const skippedAsLink = (root: RegistryRoot, dir: string, state: LoadState) =>
  Effect.gen(function* () {
    if (root.origin !== "project" || !(yield* linkedProjectDir(state.io, dir))) return false;
    state.skipped.push({ reason: "symlink", origin: root.origin, dir });
    return true;
  });

type FoundByKey = Map<string, RootCandidate[]>;

/** Loads one root's `stacks/` or `fragments/`, appending each candidate to its `kind/id` list. */
const loadKind = (
  root: RegistryRoot,
  { kind, dir }: (typeof kinds)[number],
  state: LoadState,
  found: FoundByKey,
) =>
  Effect.gen(function* () {
    const { io } = state;
    const parent = io.path.join(root.path, dir);
    if (yield* skippedAsLink(root, parent, state)) return;
    for (const id of yield* sortedNames(io, parent)) {
      const input = { origin: root.origin, kind, dir: io.path.join(parent, id), id };
      const loaded = yield* readEntryDirectory(input, state);
      if (!loaded) continue;
      const key = `${kind}/${id}`;
      found.set(key, [...(found.get(key) ?? []), { root, candidate: loaded }]);
    }
  });

/**
 * Loads every candidate of one root, stacks first and then fragments, each by sorted name,
 * appending each to its `kind/id` list in `found` after the higher roots' candidates.
 */
export const loadRoot = (root: RegistryRoot, state: LoadState, found: FoundByKey) =>
  Effect.gen(function* () {
    if (yield* skippedAsLink(root, root.path, state)) return;
    for (const kind of kinds) yield* loadKind(root, kind, state, found);
  });
