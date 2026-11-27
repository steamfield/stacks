/** Builds `.stacks/sources.json`; `new` and `add` write it through the project writer. */
import { bundleDigest, type EntryBundle } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path, Schema } from "effect";
import { SOURCES_PATH } from "../../project-layout";
import { ProjectSources } from "../../schemas/sources";
import { stackEntries } from "../compose/part-entries";
import type { Composition, MountedEntry } from "../compose/types";
import { defined } from "../object";
import { Registry } from "../registry/registry";
import type { IndexProvenance } from "./provenance";

type SourceRow = ProjectSources["entries"][number];

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareParts(a: SourceRow["part"], b: SourceRow["part"]): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return compareText(a, b);
}

/** The `sources.json` document for a composition's resolved entries. */
export const projectSources = ({
  provenance,
  entries,
}: {
  provenance: IndexProvenance;
  entries: ProjectSources["entries"];
}): ProjectSources => ({
  formatVersion: 1,
  index: provenance.index ?? null,
  entries: [...entries].sort(
    (a, b) =>
      compareText(a.kind, b.kind) || compareText(a.id, b.id) || compareParts(a.part, b.part),
  ),
});

const sourceRow = Effect.fn("project.sourceRow")(function* (
  registry: Registry["Service"],
  entry: MountedEntry,
) {
  const tree = yield* registry.tree(entry);
  const files = yield* Effect.forEach(tree.files, ({ source, mode }) =>
    registry.bytes(entry, source).pipe(
      Effect.map((bytes): EntryBundle["files"][number] => ({
        path: source,
        executable: (mode & 0o111) !== 0,
        encoding: "base64",
        content: Buffer.from(bytes).toString("base64"),
      })),
    ),
  );
  const { id, kind, origin } = entry;
  const digest = yield* bundleDigest({ id, kind, files });
  return {
    kind,
    id,
    origin,
    digest,
    ...defined({ part: kind === "stack" ? entry.mount?.name : undefined }),
  } satisfies SourceRow;
});

const sourceRows = Effect.fn("project.sourceRows")(function* (
  entries: ReadonlyArray<MountedEntry>,
) {
  const registry = yield* Registry;
  return yield* Effect.forEach(entries, (entry) => sourceRow(registry, entry));
});

export const composedSources = (composition: Composition, provenance: IndexProvenance) =>
  sourceRows([
    ...stackEntries(composition.stack, composition.parts),
    ...composition.fragments,
  ]).pipe(Effect.map((entries) => projectSources({ provenance, entries })));

const decodeSources = Schema.decodeUnknownEffect(Schema.fromJsonString(ProjectSources), {
  onExcessProperty: "error",
});

/** Prior sources are optional. A damaged file contributes no historical rows. */
const readProjectSources = Effect.fn("project.readSources")(
  function* (root: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(root, SOURCES_PATH);
    const info = yield* fs.lstat(file);
    if (info.type !== "File") return undefined;
    return yield* decodeSources(yield* fs.readFileString(file));
  },
  Effect.orElseSucceed(() => undefined),
);

export const updatedSources = Effect.fn("project.updatedSources")(function* (input: {
  root: string;
  composition: Composition<MountedEntry | null>;
  provenance: IndexProvenance;
}) {
  const { composition, provenance } = input;
  const previous = yield* readProjectSources(input.root);
  const added = yield* sourceRows(composition.fragments);
  const addedIds = new Set(added.map(({ id }) => id));
  const historical = previous
    ? previous.entries.filter(({ kind, id }) => kind !== "fragment" || !addedIds.has(id))
    : yield* sourceRows([
        ...stackEntries(composition.stack, composition.parts),
        ...(composition.applied ?? []),
      ]);
  return projectSources({ provenance, entries: [...historical, ...added] });
});

export function encodeSources(sources: ProjectSources): string {
  return `${JSON.stringify(Schema.encodeSync(ProjectSources)(sources), null, 2)}\n`;
}
