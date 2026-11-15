/**
 * Turns a composition's planned files into the bytes that will land in the project.
 *
 * `plan-files.ts::planFiles` decides which entry writes each path and how: copied as is, rendered
 * from a `.tmpl` template, or merged from several entries' JSON. This module reads those sources
 * from the registry and renders the templates with a set of template values (project name, slug,
 * author, year). It is the one renderer for every entry file: `scaffold/new.ts` writes its output
 * for `stacks new`, `add/prepare.ts` plans `stacks add` with it, `core/fingerprint.ts` hashes it,
 * and `validate/composed.ts` checks it. The CLI's own `.stacks/` files are rendered elsewhere.
 *
 * `NEUTRAL_VARS` are fixed template values, so a composition's fingerprint (a hash identifying
 * exactly what was composed) doesn't depend on the user's settings or the date.
 * `composeFilesWithNeutral` reads every source once and renders it with both value sets, so the
 * written files and the fingerprint come from the same snapshot. Output is sorted by path, and a
 * file's `executable` flag comes from its source's permission bits.
 */
import { Effect, type FileSystem, type Path } from "effect";
import { EntryInvalid, type PermissionDenied } from "../../errors";
import type { Entry } from "../registry/entry";
import { Registry } from "../registry/registry";
import { renderTemplate, type TemplateValues } from "../template";
import type { Composition, PlannedFile } from "./types";

export type RenderedFile = {
  readonly path: string;
  /** Every writer as `<kind>:<id>`, joined with `+` in composition order. */
  readonly owner: string;
  readonly bytes: Uint8Array;
  readonly executable: boolean;
};

/** Fixed values keep fingerprints independent of project settings and the clock. */
export const NEUTRAL_VARS: Readonly<TemplateValues> = Object.freeze({
  project_name: "example",
  project_slug: "example",
  env_prefix: "EXAMPLE",
  package_scope: "",
  author: "",
  year: "2000",
});

/** A planned file after reading: final bytes, or template text still to be rendered. */
type SourceFile = Omit<RenderedFile, "bytes"> &
  ({ bytes: Uint8Array } | { template: { text: string; entry: Entry; source: string } });

/**
 * The registry to read sources through. Validation passes its own so it reads the snapshot it
 * already checked; standalone rendering reads the current source files through a fresh one.
 */
const fileReader = (registry?: Registry["Service"]) =>
  registry ? Effect.succeed(registry) : Registry.pipe(Effect.provide(Registry.layer([])));

const byPath = (a: SourceFile, b: SourceFile) => {
  if (a.path < b.path) return -1;
  return a.path > b.path ? 1 : 0;
};

/** Read once so project-valued and neutral rendering use the same source snapshot. */
const readFiles = (
  composition: Composition<Entry | null>,
  registry?: Registry["Service"],
): Effect.Effect<
  ReadonlyArray<SourceFile>,
  EntryInvalid | PermissionDenied,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const reader = yield* fileReader(registry);
    const entries = [...(composition.stack ? [composition.stack] : []), ...composition.fragments];
    const files: SourceFile[] = [];
    for (const planned of composition.files)
      files.push(yield* readSource(reader, entries, planned));
    return files.sort(byPath);
  });

/**
 * One planned file's content. A merge already holds its final bytes; a copy is read as bytes and
 * a template as text. An unreadable source stays the registry's `PermissionDenied`, as everywhere
 * else.
 */
const readSource = (
  reader: Registry["Service"],
  entries: ReadonlyArray<Entry>,
  planned: PlannedFile,
) =>
  Effect.gen(function* () {
    const entry = entries.find(
      (entry) => entry.kind === planned.owner.kind && entry.id === planned.owner.id,
    );
    if (!entry) return yield* Effect.die(new Error("A planned file has no composed owner"));
    const file = {
      path: planned.path,
      owner: planned.owners.map((writer) => `${writer.kind}:${writer.id}`).join("+"),
      executable: (planned.mode & 0o111) !== 0,
    };
    if (planned.kind === "merge")
      return {
        ...file,
        bytes: new TextEncoder().encode(planned.content ?? ""),
      } satisfies SourceFile;
    const source = planned.source?.file ?? "";
    if (planned.kind === "copy")
      return {
        ...file,
        bytes: new Uint8Array(yield* reader.bytes(entry, source)),
      } satisfies SourceFile;
    const text = yield* reader.read(entry, source);
    return { ...file, template: { text, entry, source } } satisfies SourceFile;
  });

/** The single renderer, shared by standalone composition and scaffold's two value sets. */
const renderFiles = (sources: ReadonlyArray<SourceFile>, values: TemplateValues) =>
  Effect.forEach(sources, (source): Effect.Effect<RenderedFile, EntryInvalid> => {
    if ("bytes" in source) return Effect.succeed(source);
    const { template, ...file } = source;
    const rendered = renderTemplate(template.text, values);
    if ("unknown" in rendered)
      return Effect.fail(
        new EntryInvalid({
          details: {
            id: template.entry.id,
            origin: template.entry.origin,
            reason: "template",
            path: template.source,
            line: rendered.line,
          },
        }),
      );
    return Effect.succeed({ ...file, bytes: new TextEncoder().encode(rendered.text) });
  });

/** Render the entry files only; the CLI's own `.stacks/` files are separate. */
export const composeFiles = (
  composition: Composition<Entry | null>,
  values: TemplateValues,
  registry?: Registry["Service"],
) => Effect.flatMap(readFiles(composition, registry), (sources) => renderFiles(sources, values));

/** Scaffold's files and fingerprint input, rendered from one read of every source. */
export const composeFilesWithNeutral = (
  composition: Composition<Entry | null>,
  values: TemplateValues,
) =>
  Effect.gen(function* () {
    const sources = yield* readFiles(composition);
    return {
      files: yield* renderFiles(sources, values),
      neutralFiles: yield* renderFiles(sources, NEUTRAL_VARS),
    };
  });
