/**
 * Reads the project context for `stacks add`. It uses `checkTamper` (trust point 5) so adding steps
 * cannot hide an unaccepted change.
 */
import type { AgentId, Manifest } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path } from "effect";
import { AppConfig } from "../../config";
import { BadInput, PermissionDenied, VerifyChanged } from "../../errors";
import type { AddResult } from "../../schemas/add";
import type { Settings } from "../../schemas/config";
import { manifestMounts } from "../compose/part-entries";
import type { PartMount } from "../compose/types";
import { isAbsent } from "../fs/absent";
import { denied } from "../fs/denied";
import { MANIFEST_PATH, readManifest } from "../project/manifest";
import type { Entry } from "../registry/entry";
import { Registry } from "../registry/registry";
import { checkTamper, type Tamper } from "../verify/tamper";
import { refusePartDirectory } from "./part-dir";
import { checkAddRoot } from "./plan";
import type { AddOptions } from "./types";

export type AddProject = {
  previous: Manifest | undefined;
  tamper: Tamper | undefined;
  settings: Settings;
  stack: Entry | undefined;
  /** The project's own parts, from `Manifest.parts`; empty for a single-stack project. */
  parts: ReadonlyArray<PartMount>;
  warnings: AddResult["warnings"];
  existing: AddResult["alreadyApplied"];
};

type Warning = AddResult["warnings"][number];

export const readAddProject = (options: AddOptions) =>
  Effect.gen(function* () {
    const settings = yield* (yield* AppConfig).settings;
    const path = yield* Path.Path;
    yield* checkAddRoot(options.root);
    const previous = yield* readManifest(path.join(options.root, MANIFEST_PATH)).pipe(
      Effect.catchTag("NotFound", () => Effect.succeed(undefined)),
    );
    if (!previous) yield* refusePartDirectory(options.root);
    const tamper = previous
      ? yield* checkTamper(previous, path.join(options.root, MANIFEST_PATH))
      : undefined;
    if (tamper?.changed) return yield* new VerifyChanged({ details: tamper.changed });
    if (previous) yield* checkFlagsMatch(options, previous);
    // The parts compose mounts in add mode: the manifest's, never the registry entry's.
    const parts = manifestMounts(previous?.parts);
    yield* checkPartDirectories(options.root, parts);
    const registry = yield* Registry;
    const stack = yield* projectStack(registry, previous?.stack?.id);
    const warnings: Array<Warning> = [
      ...(previous?.stack && !stack ? [{ code: "stack_unknown", id: previous.stack.id }] : []),
      ...(yield* unknownParts(registry, parts)),
    ];
    const project: AddProject = {
      previous,
      tamper,
      settings,
      stack,
      parts,
      warnings,
      existing: previous?.fragments.map((entry) => entry.id) ?? [],
    };
    return project;
  });

/** Refuse conflicting `--sandbox` or `--agents` flags because add extends the recorded configuration. */
const checkFlagsMatch = (options: AddOptions, previous: Manifest) =>
  Effect.gen(function* () {
    if (options.sandbox && previous.preset !== "sandbox")
      return yield* new BadInput({ details: { id: "sandbox", flag: "sandbox" } });
    if (options.agents && !sameAgents(options.agents, previous.agents))
      return yield* new BadInput({ details: { id: options.agents.join(","), flag: "agents" } });
  });

/** Whether two agent lists name the same agents, ignoring order and duplicates in `requested`. */
const sameAgents = (requested: ReadonlyArray<AgentId>, recorded: ReadonlyArray<AgentId>) =>
  [...new Set(requested)].sort().join(",") === [...recorded].sort().join(",");

function projectStack(registry: Registry["Service"], id: string | undefined) {
  if (id === undefined) return Effect.succeed(undefined);
  return registry.get("stack", id).pipe(Effect.orElseSucceed(() => undefined));
}

/**
 * Every part directory must be a real directory before anything is written, so a removed part, a
 * file or a symlink in its place stops the add rather than receiving a fragment's files.
 */
const checkPartDirectories = Effect.fn("add.checkPartDirectories")(function* (
  root: string,
  parts: ReadonlyArray<PartMount>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const part of parts) {
    const at = path.join(root, part.name);
    const type = yield* fs.lstat(at).pipe(
      Effect.map((info) => info.type),
      Effect.catch((error) =>
        isAbsent(error) ? Effect.succeed("Missing") : Effect.fail(denied("read", at)),
      ),
    );
    if (type !== "Directory")
      return yield* new PermissionDenied({ details: { reason: "blocked", path: part.name } });
  }
});

/** A `part_unknown` warning for each part stack no registry has; the part still places by id. */
const unknownParts = (registry: Registry["Service"], parts: ReadonlyArray<PartMount>) =>
  Effect.forEach(parts, (part) =>
    projectStack(registry, part.stack).pipe(
      Effect.map(
        (entry): ReadonlyArray<Warning> =>
          entry ? [] : [{ code: "part_unknown", id: part.stack }],
      ),
    ),
  ).pipe(Effect.map((lists) => lists.flat()));
