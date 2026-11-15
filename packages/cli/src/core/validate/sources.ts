/**
 * Reads the raw text of entries for `stacks validate`, so a finding can name the file and line a
 * problem is on.
 *
 * The registry hands checks decoded entries: metadata and a body without its frontmatter. Line
 * numbers in the file need the text as it is on disk, so `index.ts` and `preview.ts` call
 * `readSources` once and put the result on the `View` as `sources`. A file that can't be read is
 * left out (or read as empty text for the markdown file); the checks that care, such as
 * `files.ts`, report unreadable files themselves.
 */
import { Effect, Result } from "effect";
import type { Entry, EntryFile } from "../registry/entry";
import { markdownFile } from "../registry/entry";
import { Registry } from "../registry/registry";

/** One shipped file of an entry, with its text. */
export type Source = EntryFile & { text: string };

/**
 * An entry's markdown text, its shipped files, and `bodyOffset`: the number of lines before the
 * body, which turns a line in the decoded body into a line in the file.
 */
export type EntrySources = {
  text: string;
  bodyOffset: number;
  files: ReadonlyArray<Source>;
};

/** The sources of one entry. */
const readEntrySources = (registry: Registry["Service"], entry: Entry) =>
  Effect.gen(function* () {
    const text = yield* registry
      .read(entry, markdownFile(entry.kind))
      .pipe(Effect.orElseSucceed(() => ""));
    const listed = yield* registry.files(entry).pipe(Effect.orElseSucceed(() => []));
    const files: Source[] = [];
    for (const file of listed) {
      const read = yield* Effect.result(registry.read(entry, file.source));
      if (Result.isSuccess(read)) files.push({ ...file, text: read.success });
    }
    return {
      text,
      bodyOffset: text.split("\n").length - entry.body.split("\n").length,
      files,
    } satisfies EntrySources;
  });

/** Each entry's sources, keyed by the entry's directory, read one entry at a time. */
export const readSources = (entries: ReadonlyArray<Entry>) =>
  Effect.gen(function* () {
    const registry = yield* Registry;
    const sources = new Map<string, EntrySources>();
    for (const entry of entries) sources.set(entry.dir, yield* readEntrySources(registry, entry));
    return sources;
  });
