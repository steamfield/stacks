import { Effect, FileSystem, Path } from "effect";
import { AppConfig } from "../../config";
import { METADATA_DIR } from "../../project-layout";
import { Host } from "../../services/host";
import { printable } from "../text/text";
import type { IndexRegistryRoot, LocalRegistryRoot } from "./types";

type RootInput = Omit<LocalRegistryRoot, "trusted"> & { overridden?: boolean; remote?: boolean };
export type RegistryRoots = ReadonlyArray<RootInput>;

/** Project roots and bundled overrides are untrusted (trust point 2). */
export function localRoot({ origin, path, overridden }: RootInput): LocalRegistryRoot {
  return { origin, path, trusted: origin !== "project" && !overridden };
}

/** An override equal to the official URL still requires its signature (trust point 2). */
export const indexRoot = Effect.fn("registry.indexRoot")(function* (config: AppConfig["Service"]) {
  const url = yield* config.remoteIndexUrl;
  if (url === undefined) return undefined;
  return Object.freeze({
    origin: "index",
    url,
    trusted: url === config.officialIndexUrl,
  } satisfies IndexRegistryRoot);
});

/**
 * The bundled root: STACKS_REGISTRY_DIR resolved against the cwd when set, else
 * `Host.registry`. `found` when it is a directory; a variable naming no directory is a warning.
 */
export const bundledRoot = Effect.gen(function* () {
  const host = yield* Host;
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* (yield* AppConfig).paths;
  const overridden = paths.registry !== undefined;
  // resolve also drops the trailing slash a URL-derived Host.registry keeps, which validate's
  // root comparison depends on.
  const at = path.resolve(host.cwd, paths.registry ?? host.registry);
  const found = yield* fs.stat(at).pipe(
    Effect.map((info) => info.type === "Directory"),
    Effect.orElseSucceed(() => false),
  );
  if (overridden && !found)
    yield* Effect.logWarning(`STACKS_REGISTRY_DIR is not a directory: ${printable(at)}`);
  return { path: at, overridden, found };
});

/** `project`, `user`, `bundled`: `./.stacks/` in the cwd, the user directory, `bundledRoot`. */
export const defaultRoots = Effect.gen(function* () {
  const host = yield* Host;
  const path = yield* Path.Path;
  const paths = yield* (yield* AppConfig).paths;
  const bundled = yield* bundledRoot;
  return [
    { origin: "project", path: path.join(host.cwd, METADATA_DIR) },
    { origin: "user", path: paths.user },
    { origin: "bundled", path: bundled.path, overridden: bundled.overridden },
  ] satisfies RegistryRoots;
});

/** Only entry-consuming commands opt into network-backed registry resolution. */
export const remoteRoots = defaultRoots.pipe(
  Effect.map((roots) =>
    roots.map((root) => (root.origin === "bundled" ? { ...root, remote: true } : root)),
  ),
);

/** Use the selected project's metadata directory for entry resolution. */
export const projectRoots = Effect.fn("registry.projectRoots")(function* (dir: string) {
  const path = yield* Path.Path;
  return (yield* remoteRoots).map((root) =>
    root.origin === "project" ? { ...root, path: path.join(dir, METADATA_DIR) } : root,
  );
});
