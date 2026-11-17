/**
 * Reads entry source text so findings can name file lines, including frontmatter. Unreadable
 * source text can be omitted while checks such as `fileChecks` report the read failure.
 */
import { Effect, Result } from "effect";
import type { Entry, EntryFile } from "../registry/entry";
import { markdownFile } from "../registry/entry";
import { Registry } from "../registry/registry";

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

const readEntrySources = (registry: Registry["Service"], entry: Entry) =>
  Effect.gen(function* () {
    // Empty Markdown on a read failure lets other source checks continue.
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
