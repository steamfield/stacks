import {
  Kebab,
  type Kind,
  type NamedComposition,
  type OfficialNames,
} from "@steamfield/stacks-format";
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { parseDocument } from "yaml";
import { compose } from "../../src/core/compose/compose";
import { decodeEntry, isStack, type Stack, splitFrontmatter } from "../../src/core/registry/entry";
import { Registry } from "../../src/core/registry/registry";
import { releaseTags, withReleaseRegistry } from "./history";

type Source = OfficialNames["sources"][number];

const historicalId = (text: string) =>
  Effect.try({
    try: () => {
      const parts = splitFrontmatter(text);
      if (parts === undefined) throw new Error("missing frontmatter");
      const doc = parseDocument(parts.frontmatter, { logLevel: "silent" });
      if (doc.errors.length || doc.warnings.length) throw new Error("invalid YAML");
      const value: unknown = doc.toJS({ maxAliasCount: 100 });
      return value;
    },
    catch: () => new Error("could not recover historical id"),
  }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ id: Kebab }))));

const releaseId = Effect.fn("index.releaseId")(function* (file: string, kind: Kind) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(file);
  const decoded = yield* decodeEntry(kind, text);
  if (decoded._tag === "Meta") return { id: decoded.meta.id, degraded: false };
  const recovered = yield* Effect.result(historicalId(text));
  return { id: recovered._tag === "Success" ? recovered.success.id : undefined, degraded: true };
});

const releaseKindIds = Effect.fn("index.releaseKindIds")(function* (root: string, kind: Kind) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const ids: string[] = [];
  let degraded = false;
  const directory = path.join(root, `${kind}s`);
  if (!(yield* fs.exists(directory))) return { ids, degraded };
  for (const name of (yield* fs.readDirectory(directory)).sort()) {
    const file = path.join(directory, name, kind === "stack" ? "STACK.md" : "FRAGMENT.md");
    if (!(yield* fs.exists(file))) continue;
    const found = yield* releaseId(file, kind);
    if (found.degraded) degraded = true;
    if (found.id !== undefined) ids.push(found.id);
  }
  return { ids, degraded };
});

const stackCompositions = Effect.fn("index.releaseCompositions")(function* (stack: Stack) {
  const compositions: NamedComposition[] = [];
  for (const extra of [[], ...stack.meta.fragments.optional.map((id) => [id])]) {
    const composed = yield* compose({
      stack: stack.id,
      with: extra,
      without: [],
      preset: "default",
      agents: [],
      always: [],
      mode: "new",
    });
    compositions.push({
      fragments: composed.fragments.map((entry) => entry.id),
      steps: composed.verify.map((step) => step.name),
    });
  }
  return compositions;
});

const releaseSource = Effect.fn("index.releaseSource")(function* (root: string, tag: string) {
  const stackIds = yield* releaseKindIds(root, "stack");
  const fragmentIds = yield* releaseKindIds(root, "fragment");
  const registry = yield* Registry;
  const entries = yield* registry.all;
  let degraded = stackIds.degraded || fragmentIds.degraded || (yield* registry.skipped).length > 0;
  const stacks: Source["stacks"][number][] = [];
  for (const id of stackIds.ids) {
    const entry = entries.find((entry) => isStack(entry) && entry.id === id);
    const attempt =
      entry !== undefined && isStack(entry)
        ? yield* Effect.result(stackCompositions(entry))
        : undefined;
    if (attempt?._tag !== "Success") degraded = true;
    stacks.push({ id, compositions: attempt?._tag === "Success" ? attempt.success : [] });
  }
  if (degraded)
    yield* Console.warn(
      `Warning: ${tag}: registry could not fully decode or compose; retained recoverable frontmatter ids.`,
    );
  return {
    origin: "release",
    version: tag.slice(1),
    stacks,
    fragments: fragmentIds.ids,
  } satisfies Source;
});

export const releaseNames = Effect.fn("index.releaseNames")(function* (cwd: string) {
  const sources: Source[] = [];
  for (const tag of yield* releaseTags(cwd))
    sources.push(yield* withReleaseRegistry(cwd, tag, (root) => releaseSource(root, tag)));
  return sources;
});
