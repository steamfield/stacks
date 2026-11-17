/**
 * Renders planned entry files into bytes. Project and fingerprint rendering share a source snapshot
 * through `composeFilesWithNeutral`.
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

type SourceFile = Omit<RenderedFile, "bytes"> &
  ({ bytes: Uint8Array } | { template: { text: string; entry: Entry; source: string } });

/** Reuse validation's checked registry snapshot. Standalone rendering reads current sources. */
const fileReader = (registry?: Registry["Service"]) =>
  registry ? Effect.succeed(registry) : Registry.pipe(Effect.provide(Registry.layer([])));

const byPath = (a: SourceFile, b: SourceFile) => {
  if (a.path < b.path) return -1;
  return a.path > b.path ? 1 : 0;
};

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
    // Both renderings use the same path order and source snapshot for writes and fingerprints.
    return files.sort(byPath);
  });

/**
 * Encode merged text from the plan without rereading its sources. Unreadable copy or template
 * sources keep the registry's `PermissionDenied`.
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
      // The planned source's mode determines whether the rendered file is executable.
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

/** The CLI's own metadata files are separate from this entry rendering. */
export const composeFiles = (
  composition: Composition<Entry | null>,
  values: TemplateValues,
  registry?: Registry["Service"],
) => Effect.flatMap(readFiles(composition, registry), (sources) => renderFiles(sources, values));

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
