/**
 * Checks `registry.json` on an official root (one holding `allowlist.json`, the marker `deps.ts`
 * uses): missing, malformed, or a `minCli` above this CLI's version is an error naming the file.
 */
import { Effect, FileSystem, Path, type PlatformError, Result, Schema } from "effect";
import { RegistryMeta } from "../../../schemas/registry-meta";
import { VERSION } from "../../../version";
import { denied } from "../../fs/denied";
import { cliMeetsMinimum } from "../../registry/remote/verification";
import type { Check } from "../types";

const file = "registry.json";

/** Why `registry.json` is unusable. Each caller adds its own fix for `requiresNewerCli`. */
export type RegistryMetaProblem = { message: string; requiresNewerCli: boolean };

const problem = (message: string): RegistryMetaProblem => ({ message, requiresNewerCli: false });

const readFailure = (error: PlatformError.PlatformError) =>
  problem(
    error.reason._tag === "NotFound"
      ? 'File is missing. Add a JSON object with "formatVersion": 1 and "minCli" set to the oldest supported CLI version (major.minor.patch).'
      : "Cannot read the file. Check the file type and permissions.",
  );

export const readRegistryMeta = Effect.fn("registry.readMeta")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const at = path.join(root, file);
  const info = yield* fs.lstat(at).pipe(Effect.mapError(readFailure));
  if (info.type !== "File")
    return yield* Effect.fail(problem("Use a regular file in the registry root."));
  const text = yield* fs.readFileString(at).pipe(Effect.mapError(readFailure));
  const meta = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(RegistryMeta))(text, {
    onExcessProperty: "error",
  }).pipe(
    Effect.mapError(() =>
      problem('Expected a JSON object with only "formatVersion": 1 and a "minCli" version string.'),
    ),
  );
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(meta.minCli))
    return yield* Effect.fail(
      problem(`Set "minCli" to a version in major.minor.patch form, for example "${VERSION}".`),
    );
  if (!cliMeetsMinimum(meta.minCli))
    return yield* Effect.fail<RegistryMetaProblem>({
      message: `This registry requires stacks ${meta.minCli} or newer (current version ${VERSION}).`,
      requiresNewerCli: true,
    });
  return meta;
});

export const registryMetaChecks: Check = Effect.fn("validate.registryMeta")(function* (view) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const marker = path.join(view.root, "allowlist.json");
  // The directory entry marks an official root even if its allowlist cannot be decoded.
  const official = yield* Effect.result(fs.lstat(marker));
  if (Result.isFailure(official)) {
    if (official.failure.reason._tag === "NotFound") return { findings: [] };
    return yield* denied("read", marker);
  }

  const read = yield* Effect.result(readRegistryMeta(view.root));
  if (Result.isSuccess(read)) return { findings: [] };
  const { message, requiresNewerCli } = read.failure;
  return {
    findings: [
      {
        check: "registry-meta",
        severity: "error",
        file,
        message: requiresNewerCli ? `${message} Run stacks validate with a newer CLI.` : message,
      },
    ],
  };
});
