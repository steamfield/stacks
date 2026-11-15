/**
 * Decides which entry writes each file of a composition, before anything is read or written.
 *
 * Every entry (a stack or a fragment) ships files in its directory. Some apply only to certain
 * targets: an agent adapter (`adapters/<agent>/`), a fragment's overlay for one host stack, or a
 * stack's payload variant (`payloads/<variant>/`); `registry/entry.ts::shipsFor` decides. `compose.ts::compose` calls `planFiles` with the
 * composed entries; it keeps only the files that ship for this composition and gives each output
 * path exactly one owner. Two entries may write the same path only when both list it in their
 * `merge` field, and then their JSON is deep-merged in composition order (`merge.ts::deepMerge`).
 * `files.ts::composeFiles` later renders the plan.
 *
 * Paths are refused here rather than mid-write, because a failed write would leave a half-built
 * project: a path naming `.git` or `.stacks` in any spelling a filesystem treats as the same
 * (those directories belong to git and the CLI), and two paths that collide on a case-insensitive
 * volume or where one path's file is another's directory. Start at `planFiles`.
 */
import { type AgentId, outputPath } from "@steamfield/stacks-format";
import { Effect, Result } from "effect";
import { EntryInvalid } from "../../errors";
import { METADATA_DIR } from "../../project-layout";
import { type Entry, type EntryFile, entryRef, type Payload, shipsFor } from "../registry/entry";
import type { Registry } from "../registry/registry";
import { conflict, parties } from "./conflicts";
import { deepMerge } from "./merge";
import type { PlannedFile } from "./types";

/** Code points HFS+ ignores in names (git's `is_hfs_dotgit`): `.git` with one inside opens `.git`. */
const HFS_IGNORABLE = /[\u{200c}-\u{200f}\u{202a}-\u{202e}\u{206a}-\u{206f}\u{feff}]/gu;
/** A name the way a case-insensitive filesystem compares it. */
const fold = (name: string) => name.normalize("NFC").toLowerCase();

/**
 * Whether a path segment names `.git` or `.stacks` on some filesystem: the directories the
 * CLI owns in a project. After git's `is_hfs_dotgit` and `is_ntfs_dotgit`: case folded, HFS+
 * ignorable code points dropped, anything from a `:` (an NTFS stream) on and trailing dots and
 * spaces cut, and the NTFS short names `git~1` and `quicks~1` included.
 */
function reservedSegment(segment: string): boolean {
  const name = (fold(segment.replace(HFS_IGNORABLE, "")).split(":")[0] ?? "").replace(/[. ]+$/, "");
  return name === ".git" || name === METADATA_DIR || name === "git~1" || name === "quicks~1";
}

/** Entry paths were checked when the registry loaded them, so an escaping one is a CLI bug. */
const checkPlannedPath = (path: string) =>
  Effect.gen(function* () {
    if (!path || path.startsWith("/") || path.split("/").includes(".."))
      return yield* Effect.die(new Error("A planned path is empty or escapes the project root"));
  });

/** One entry's claim on an output path. */
type Writer = { entry: Entry; source: string; template: boolean; mode: number };
/** What selects an entry's overlays: the target agents, the host stack and its payload. */
export type FileSelection = {
  agents: ReadonlyArray<AgentId>;
  stack: string | null;
  payload: Payload;
};

/** Every output path's writers, in composition order. */
function fileWriters(
  registry: Registry["Service"],
  entries: ReadonlyArray<Entry>,
  selection: FileSelection,
) {
  return Effect.gen(function* () {
    const byPath = new Map<string, Writer[]>();
    for (const entry of entries)
      for (const file of yield* registry.files(entry)) {
        const writer = yield* writerFor(entry, file, selection);
        if (writer) byPath.set(writer.path, [...(byPath.get(writer.path) ?? []), writer.claim]);
      }
    return byPath;
  });
}

/** The output path and writer for one shipped file, or nothing when it doesn't ship here. */
const writerFor = (entry: Entry, file: EntryFile, selection: FileSelection) =>
  Effect.gen(function* () {
    const { agents, stack, payload } = selection;
    if (!shipsFor(file.source, agents, stack, payload)) return undefined;
    // A template needs a name before the suffix: a file called just `.tmpl` is copied as is.
    const path = outputPath(file.path);
    const template = path !== file.path;
    yield* checkPlannedPath(path);
    if (path.split("/").some(reservedSegment))
      return yield* conflict({ reason: "reserved_path", ...parties([entry]), path });
    if (template && entry.meta.merge.includes(path))
      return yield* new EntryInvalid({
        details: {
          id: entry.id,
          origin: entry.origin,
          reason: "merge_template",
          path: file.source,
        },
      });
    const claim: Writer = { entry, source: file.source, template, mode: file.mode };
    return { path, claim };
  });

/**
 * Output paths claimed so far, folded the way a case-insensitive filesystem compares them: each
 * file path, and each directory on the way to one, mapped to the path that claimed it.
 */
type ClaimedPaths = { files: Map<string, string>; dirs: Map<string, string> };

/** Every output path with one owner, or one JSON merge of writers that all list it in `merge`. */
export function planFiles(
  registry: Registry["Service"],
  entries: ReadonlyArray<Entry>,
  selection: FileSelection,
) {
  return Effect.gen(function* () {
    const byPath = yield* fileWriters(registry, entries, selection);
    const planned: PlannedFile[] = [];
    const claimed: ClaimedPaths = { files: new Map(), dirs: new Map() };
    for (const path of [...byPath.keys()].sort()) {
      const writers = byPath.get(path) ?? [];
      const [first] = writers;
      if (!first) continue;
      yield* claimPath(claimed, byPath, path);
      planned.push(yield* planOutput(registry, { path, writers, first }));
    }
    return planned;
  });
}

/**
 * Records `path` as claimed, refusing it when a case-insensitive filesystem would treat it as an
 * earlier path, or when it needs a directory where an earlier path is a file (or the reverse).
 * Either would only fail mid-write, so it is refused before anything is written.
 */
const claimPath = (
  claimed: ClaimedPaths,
  byPath: ReadonlyMap<string, ReadonlyArray<Writer>>,
  path: string,
) =>
  Effect.gen(function* () {
    const parents = path
      .split("/")
      .slice(0, -1)
      .map((_, i, all) => fold(all.slice(0, i + 1).join("/")));
    const key = fold(path);
    const other =
      claimed.files.get(key) ??
      claimed.dirs.get(key) ??
      parents.map((parent) => claimed.files.get(parent)).find((found) => found !== undefined);
    if (other !== undefined) {
      const writers = [...(byPath.get(other) ?? []), ...(byPath.get(path) ?? [])];
      return yield* conflict({
        reason: "file_owner",
        ...parties(writers.map((writer) => writer.entry)),
        path,
      });
    }
    claimed.files.set(key, path);
    for (const parent of parents) claimed.dirs.set(parent, path);
  });

/** The plan for one path: a copy or template from its only writer, or a JSON merge of them all. */
function planOutput(
  registry: Registry["Service"],
  input: { path: string; writers: ReadonlyArray<Writer>; first: Writer },
) {
  const { path, writers, first } = input;
  return Effect.gen(function* () {
    if (writers.length === 1) {
      return {
        path,
        owner: entryRef(first.entry),
        owners: [entryRef(first.entry)],
        kind: first.template ? "template" : "copy",
        source: { entry: entryRef(first.entry), file: first.source },
        mode: first.mode,
      } satisfies PlannedFile;
    }
    if (!writers.every((writer) => writer.entry.meta.merge.includes(path)))
      return yield* conflict({
        reason: "file_owner",
        ...parties(writers.map((writer) => writer.entry)),
        path,
      });
    const merged = yield* mergeJson(registry, writers);
    return {
      path,
      owner: entryRef(first.entry),
      owners: writers.map((writer) => entryRef(writer.entry)),
      kind: "merge",
      content: `${JSON.stringify(merged, null, 2)}\n`,
      mode: first.mode,
    } satisfies PlannedFile;
  });
}

/** Every writer's JSON deep-merged in order; a file that isn't JSON is `EntryInvalid`. */
const mergeJson = (registry: Registry["Service"], writers: ReadonlyArray<Writer>) =>
  Effect.gen(function* () {
    let merged: unknown;
    for (const [i, writer] of writers.entries()) {
      const text = yield* registry.read(writer.entry, writer.source);
      const parsed = Result.try(() => JSON.parse(text) as unknown);
      if (Result.isFailure(parsed))
        return yield* new EntryInvalid({
          details: {
            id: writer.entry.id,
            origin: writer.entry.origin,
            reason: "merge_json",
            path: writer.source,
          },
        });
      merged = i === 0 ? parsed.success : deepMerge(merged, parsed.success);
    }
    return merged;
  });
