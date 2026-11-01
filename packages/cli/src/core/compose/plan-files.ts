import type { AgentId } from "@steamfield/stacks-format";
import { Effect, Result } from "effect";
import { EntryInvalid } from "../../errors";
import { METADATA_DIR } from "../../project-layout";
import { type Entry, type EntryFile, entryRef, outputPath, shipsFor } from "../registry/entry";
import type { Registry } from "../registry/registry";
import type { PlannedFile } from "./compose";
import { conflict, parties } from "./conflicts";
import { deepMerge } from "./merge";

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

const checkPlannedPath = (path: string) =>
  Effect.gen(function* () {
    if (!path || path.startsWith("/") || path.split("/").includes(".."))
      return yield* Effect.die(new Error("A planned path is empty or escapes the project root"));
  });

type Writer = { entry: Entry; source: string; template: boolean; mode: number };

function fileWriters(
  registry: Registry["Service"],
  entries: ReadonlyArray<Entry>,
  agents: ReadonlyArray<AgentId>,
  stack: string | null,
) {
  return Effect.gen(function* () {
    const byPath = new Map<string, Writer[]>();
    const addWriter = (entry: Entry, file: EntryFile) =>
      Effect.gen(function* () {
        if (!shipsFor(file.source, agents, stack)) return;
        // A template needs a name before the suffix: a file called just `.tmpl` is copied as is.
        const path = outputPath(file);
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
        byPath.set(path, [
          ...(byPath.get(path) ?? []),
          { entry, source: file.source, template, mode: file.mode },
        ]);
      });
    for (const entry of entries)
      for (const file of yield* registry.files(entry)) yield* addWriter(entry, file);
    return byPath;
  });
}

/** Every output path with one owner, or one JSON merge of writers that all list it in `merge`. */
export function planFiles(
  registry: Registry["Service"],
  entries: ReadonlyArray<Entry>,
  agents: ReadonlyArray<AgentId>,
  stack: string | null,
) {
  return Effect.gen(function* () {
    const byPath = yield* fileWriters(registry, entries, agents, stack);
    const planned: PlannedFile[] = [];
    /** Folded file paths, and folded directories on the way to one, each to a path that made it. */
    const files = new Map<string, string>();
    const dirs = new Map<string, string>();
    const checkOutputPath = (path: string, writers: ReadonlyArray<Writer>) =>
      Effect.gen(function* () {
        // Two paths a case-insensitive filesystem treats as one, or a file where another path needs
        // a directory, would only fail mid-write; refuse them before anything is written.
        const parents = path
          .split("/")
          .slice(0, -1)
          .map((_, i, all) => fold(all.slice(0, i + 1).join("/")));
        const key = fold(path);
        const other =
          files.get(key) ??
          dirs.get(key) ??
          parents.map((parent) => files.get(parent)).find((found) => found !== undefined);
        if (other !== undefined)
          return yield* conflict({
            reason: "file_owner",
            ...parties([...(byPath.get(other) ?? []), ...writers].map((writer) => writer.entry)),
            path,
          });
        files.set(key, path);
        for (const parent of parents) dirs.set(parent, path);
      });
    for (const path of [...byPath.keys()].sort()) {
      const writers = byPath.get(path) ?? [];
      const [first] = writers;
      if (!first) continue;
      yield* checkOutputPath(path, writers);
      planned.push(yield* planOutput(registry, { path, writers, first }));
    }
    return planned;
  });
}

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
