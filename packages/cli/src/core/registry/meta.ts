/** Reads registry metadata and identifies official roots by their allowlist marker. */
import { Effect, FileSystem, Path, type PlatformError, Result, Schema } from "effect";
import { RegistryMeta } from "../../schemas/registry-meta";
import { VERSION } from "../../version";
import { cliMeetsMinimum } from "./remote/verification";

export const REGISTRY_META_FILE = "registry.json";
export const ALLOWLIST_FILE = "allowlist.json";

/** Why `registry.json` is unusable. Each caller adds its own fix for `requiresNewerCli`. */
export type RegistryMetaProblem = { message: string; requiresNewerCli: boolean };

/** Only a missing directory entry skips checks. The file reads report anything unreadable. */
export const officialRoot = Effect.fn("registry.officialRoot")(function* (
  root: string,
): Effect.fn.Return<"absent" | "present", never, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const marker = yield* Effect.result(fs.lstat(path.join(root, ALLOWLIST_FILE)));
  if (Result.isFailure(marker) && marker.failure.reason._tag === "NotFound") return "absent";
  return "present";
});

const problem = (message: string): RegistryMetaProblem => ({ message, requiresNewerCli: false });

const readFailure = (error: PlatformError.PlatformError) =>
  problem(
    error.reason._tag === "NotFound"
      ? 'File is missing. Add a JSON object with "formatVersion": 1 and "minCli" set to the oldest supported CLI version (major.minor.patch).'
      : "Cannot read the file. Check the file type and permissions.",
  );

function decodeFailure({ issue }: Schema.SchemaError): RegistryMetaProblem {
  const field = issue._tag === "Composite" ? issue.issues[0] : undefined;
  if (
    field?._tag === "Pointer" &&
    field.path[0] === "minCli" &&
    field.issue._tag === "Composite" &&
    field.issue.issues[0]?._tag === "Filter"
  )
    return problem(
      `Set "minCli" to a version in major.minor.patch form, for example "${VERSION}".`,
    );
  return problem(
    'Expected a JSON object with only "formatVersion": 1 and a "minCli" version string.',
  );
}

export const readRegistryMeta = Effect.fn("registry.readMeta")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const at = path.join(root, REGISTRY_META_FILE);
  const info = yield* fs.lstat(at).pipe(Effect.mapError(readFailure));
  if (info.type !== "File")
    return yield* Effect.fail(problem("Use a regular file in the registry root."));
  const text = yield* fs.readFileString(at).pipe(Effect.mapError(readFailure));
  const meta = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(RegistryMeta))(text, {
    onExcessProperty: "error",
  }).pipe(Effect.mapError(decodeFailure));
  if (!cliMeetsMinimum(meta.minCli))
    return yield* Effect.fail<RegistryMetaProblem>({
      message: `This registry requires stacks ${meta.minCli} or newer (current version ${VERSION}).`,
      requiresNewerCli: true,
    });
  return meta;
});
