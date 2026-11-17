/** Renders the registry catalog or the fragments a project can still add. */
import type { AuthorsFile, Manifest } from "@steamfield/stacks-format";
import { Effect, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { Allowlist } from "../core/allowlist";
import { readLedger } from "../core/ledger";
import { type Group, groups, listResult, projectChoices, toRow, withStats } from "../core/list";
import { renderAddable, renderList } from "../core/list-report";
import { MANIFEST_PATH, readManifest } from "../core/manifest";
import { type Entry, isRejected, type RejectedEntry } from "../core/registry/entry";
import { Registry, remoteRoots } from "../core/registry/registry";
import { shellArg } from "../core/shell";
import { shownPath } from "../core/shown-path";
import { Stats } from "../core/stats";
import { closest } from "../core/suggest";
import { printable } from "../core/text";
import { textWidth } from "../core/wrap";
import { Usage } from "../errors";
import { METADATA_DIR } from "../project-layout";
import type { LedgerRecord } from "../schemas/ledger";
import { ListResult } from "../schemas/list";
import { Host } from "../services/host";
import { Output } from "../services/output";

const isGroup = (value: string): value is Group =>
  (groups as ReadonlyArray<string>).includes(value);

/** The group argument checked against the known groups; `undefined` means all of them. */
const selectedGroup = (group: Option.Option<string>) =>
  Effect.gen(function* () {
    const typed = Option.getOrUndefined(group);
    if (typed !== undefined && !isGroup(typed))
      return yield* new Usage({ details: { command: typed, suggestions: closest(typed, groups) } });
    return typed;
  });

/**
 * The project's manifest, or `undefined` outside a project. An unreadable or invalid manifest
 * prints a warning and lists the full registry instead of failing.
 */
const readProjectManifest = (manifestFile: string) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const fallBack = (warning: string) => output.note(warning).pipe(Effect.as(undefined));
    return yield* readManifest(manifestFile).pipe(
      Effect.catchTag("NotFound", () => Effect.succeed(undefined)),
      Effect.catchTags({
        InvalidConfig: () =>
          fallBack(
            `Warning: invalid manifest or schema version at ${printable(manifestFile)}; using the full registry.`,
          ),
        PermissionDenied: () =>
          fallBack(
            `Warning: unreadable manifest at ${printable(manifestFile)}; using the full registry.`,
          ),
      }),
    );
  });

/** The usual registry roots, with the project root moved to `--dir`'s `.stacks/`. */
const rootsFor = (projectRoot: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    return (yield* remoteRoots).map((entry) =>
      entry.origin === "project" ? { ...entry, path: path.join(projectRoot, METADATA_DIR) } : entry,
    );
  });

/** The bundled run ledger, read from the bundled root; absent when there is no bundled root. */
const bundledLedger = (roots: Effect.Success<typeof remoteRoots>) => {
  const bundled = roots.find((root) => root.origin === "bundled");
  return bundled ? readLedger(bundled.path) : Effect.succeed(undefined);
};

/** Every entry, rejected ones included, and the bundled `authors.json`, from these roots. */
const loadRegistry = (roots: Effect.Success<typeof remoteRoots>) =>
  Registry.pipe(
    Effect.flatMap((registry) => Effect.all({ items: registry.all, authors: registry.authors })),
    Effect.provide(Registry.layer(roots)),
  );

/** One row per usable entry, whatever the group, for the addable view and the catalog's counts. */
const allRows = (
  items: ReadonlyArray<Entry | RejectedEntry>,
  records: ReadonlyArray<LedgerRecord>,
  authors: AuthorsFile,
) =>
  items
    .filter((item): item is Entry => !isRejected(item))
    .map((entry) => toRow(entry, records, authors));

/** Rejected rows with their directories as text shows them: relative for an agent. */
const shownRejected = (rejected: ListResult["rejected"], agent: boolean) =>
  Effect.gen(function* () {
    if (!agent) return rejected;
    const { cwd } = yield* Host;
    return yield* Effect.forEach(rejected, (entry) =>
      Effect.map(shownPath(cwd, entry.dir), (dir) => ({ ...entry, dir })),
    );
  });

/** ` --dir <path>` for the hints the addable view prints, or nothing without `--dir`. */
const dirFlagText = (dir: Option.Option<string>) =>
  Option.match(dir, {
    onNone: () => "",
    onSome: (selected) => ` --dir ${printable(shellArg(selected))}`,
  });

export const listCommand = Command.make(
  "list",
  {
    dir: Flag.String("dir").pipe(
      Flag.withDescription("Project directory to list from. Defaults to the current directory."),
      Flag.optional,
    ),
    group: Argument.String("group").pipe(
      Argument.withDescription(
        "Show one group: stacks, fragments (apps excluded) or apps. Omit it to show all three.",
      ),
      Argument.optional,
    ),
  },
  ({ group, dir }) =>
    Effect.gen(function* () {
      const typed = yield* selectedGroup(group);
      yield* (yield* Allowlist).refresh;
      const host = yield* Host;
      const path = yield* Path.Path;
      const output = yield* Output;
      const projectRoot = path.resolve(
        host.cwd,
        Option.getOrElse(dir, () => "."),
      );
      const manifest: Manifest | undefined = yield* readProjectManifest(
        path.join(projectRoot, MANIFEST_PATH),
      );
      const roots = yield* rootsFor(projectRoot);
      const ledger = yield* bundledLedger(roots);
      const records = ledger?.records ?? [];
      const { items, authors } = yield* loadRegistry(roots);
      const summary = Option.getOrUndefined(yield* (yield* Stats).summary);

      const plain = listResult(items, typed, records, authors);
      const result = { ...plain, entries: withStats(plain.entries, summary) };
      const all = withStats(allRows(items, records, authors), summary);
      const { project, addable } = projectChoices(all, manifest);
      const agent = output.audience === "agent";
      // A human's descriptions wrap to the terminal; an agent's stay on one line each.
      const width = textWidth(!agent, host.columns);
      const rejected = yield* shownRejected(result.rejected, agent);
      const text =
        manifest && typed === undefined
          ? renderAddable({
              addable,
              rejected,
              width,
              invocation: host.invocation,
              dirFlag: dirFlagText(dir),
              measure: host.stringWidth,
              style: output.style,
            })
          : renderList({ ...result, rejected }, all, {
              group: typed,
              width,
              invocation: host.invocation,
              ledgerPresent: ledger?.present ?? false,
              measure: host.stringWidth,
              style: output.style,
            });
      yield* output.result(
        Schema.encodeSync(ListResult)({ ...result, ...(project ? { project } : {}) }),
        text,
      );
    }),
).pipe(
  Command.withDescription(
    "List the stacks, fragments and apps you can build from, with where each comes from and whether it is trusted. Inside a project, the default view shows the fragments you can still add. Exits 0, 2 on an unknown group, 6 when a registry root can't be read, 130 when interrupted.",
  ),
  Command.withShortDescription("List the stacks, fragments and apps you can build from."),
  Command.withExamples(({ commandPath }) => [
    {
      command: commandPath.join(" "),
      description: "Show every group, or addable fragments in a project",
    },
    { command: `${commandPath.join(" ")} stacks`, description: "Show only the stacks" },
    {
      command: `${commandPath.join(" ")} --json`,
      description: "Get the full registry as one ListResult object",
    },
  ]),
);
