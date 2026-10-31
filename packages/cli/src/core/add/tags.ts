import { Effect, FileSystem, Option, Path, Schema } from "effect";

const Package = Schema.Struct({
  scripts: Schema.optionalKey(Schema.Unknown),
  workspaces: Schema.optionalKey(Schema.Unknown),
  packageManager: Schema.optionalKey(Schema.Unknown),
});
const isScripts = Schema.is(Schema.Record(Schema.String, Schema.Unknown));
const MANIFESTS = ["package.json", "go.mod", "pyproject.toml", "Cargo.toml"] as const;

/** Infer conditional tags from repository data only; these never determine applies_to fit. */
export const inferTags = Effect.fn("add.inferTags")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const exists = (name: string) =>
    fs.exists(path.join(root, name)).pipe(Effect.orElseSucceed(() => false));
  const tags = new Set<string>();
  if (yield* exists("Makefile")) tags.add("make");
  if (yield* exists("package.json")) tags.add("node");
  for (const tag of yield* packageTags(fs, path.join(root, "package.json"), tags.has("make")))
    tags.add(tag);
  for (const [file, tag] of [
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["tsconfig.json", "typescript"],
    ["go.mod", "go"],
    ["pyproject.toml", "python"],
    ["Cargo.toml", "rust"],
  ] as const)
    if (yield* exists(file)) tags.add(tag);
  if (yield* hasWorkspaceManifests(fs, path, root)) tags.add("monorepo");
  return [...tags].sort();
});

const packageTags = Effect.fn("add.packageTags")(function* (
  fs: FileSystem.FileSystem,
  file: string,
  make: boolean,
) {
  const text = yield* Effect.option(fs.readFileString(file));
  if (Option.isNone(text)) return [];
  const parsed = yield* Effect.option(
    Schema.decodeUnknownEffect(Schema.fromJsonString(Package))(text.value),
  );
  if (Option.isNone(parsed)) return [];
  const data = parsed.value;
  const tags: string[] = [];
  if (isScripts(data.scripts) && !make) tags.push("scripts");
  if (typeof data.packageManager === "string" && data.packageManager.startsWith("bun@"))
    tags.push("bun");
  if (Object.hasOwn(data, "workspaces")) tags.push("monorepo");
  return tags;
});

const hasWorkspaceManifests = Effect.fn("add.hasWorkspaceManifests")(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
) {
  const children = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed(() => []));
  let manifests = 0;
  for (const child of children) {
    const stat = yield* Effect.option(fs.stat(path.join(root, child)));
    if (Option.isNone(stat) || stat.value.type !== "Directory") continue;
    for (const file of MANIFESTS)
      if (yield* fs.exists(path.join(root, child, file)).pipe(Effect.orElseSucceed(() => false))) {
        manifests++;
        break;
      }
    if (manifests >= 2) return true;
  }
  return false;
});
