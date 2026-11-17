/** Applies an add plan as one transaction through `openProject`. */
import type { Manifest } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path } from "effect";
import { PermissionDenied } from "../../errors";
import {
  BRIEF_PATH,
  IGNORE,
  IGNORE_PATH,
  MANIFEST_PATH,
  NOTES,
  NOTES_PATH,
  STATE_DIR,
} from "../../project-layout";
import type { Brief } from "../brief/types";
import { encodeManifest } from "../manifest";
import {
  projectStateFor,
  projectStatePath,
  replaceProjectState,
  warnUnwritten,
} from "../project-state";
import { openProject } from "../scaffold/write";
import type { AddPlan } from "./plan";
import type { AddProject } from "./project";

const encoder = new TextEncoder();
const denied = (path: string) => new PermissionDenied({ details: { reason: "write", path } });

/**
 * Write the project's state record and say whether it was written. A project that has a manifest
 * but no state record stays without one. An existing record keeps its creation and first-green
 * times. On a first add an unwritable state directory is only a warning; once a record exists,
 * failing to update it is a failure.
 */
const recordState = (
  manifest: Manifest,
  stateManifest: Manifest,
  project: Pick<AddProject, "previous" | "tamper">,
  root: string,
) =>
  Effect.gen(function* () {
    if (project.previous && !project.tamper?.record) return false;
    const path = yield* Path.Path;
    const target = project.tamper?.record?.path ?? (yield* projectStatePath(manifest.projectId));
    if (target === undefined) return false;
    const state = projectStateFor(stateManifest, path.join(root, MANIFEST_PATH));
    const kept = project.tamper?.record?.state;
    return yield* replaceProjectState(
      {
        ...state,
        createdAt: kept?.createdAt ?? state.createdAt,
        firstGreenAt: kept?.firstGreenAt ?? null,
        firstTestPassAt: kept?.firstTestPassAt ?? null,
      },
      target,
    ).pipe(
      Effect.as(true),
      Effect.catchTag("PlatformError", (error) =>
        project.previous
          ? Effect.fail(denied(target))
          : warnUnwritten(error, target).pipe(Effect.as(false)),
      ),
    );
  });

const STARTER_METADATA: ReadonlyArray<readonly [string, string]> = [
  [IGNORE_PATH, IGNORE],
  [NOTES_PATH, NOTES],
];

/** Apply the new and parked file writes in path order, using `rewrite` only for a parked merge. */
function fileOperations(plan: AddPlan) {
  return [
    ...plan.write.map((file) => ({
      file,
      bytes: file.bytes,
      destination: file.path,
      rewrite: false,
    })),
    ...plan.park.map(({ file, bytes, incoming, action }) => ({
      file,
      bytes,
      destination: incoming,
      rewrite: action === "merge",
    })),
  ].sort((a, b) => {
    if (a.file.path < b.file.path) return -1;
    return a.file.path > b.file.path ? 1 : 0;
  });
}

/**
 * Write entry files and parked copies before the remaining `.stacks/` metadata and brief. Record
 * state before the manifest. As in `scaffold`'s initial project write, the manifest comes last
 * among project files so it describes a complete write. `openProject` and `replaceProjectState`
 * undo their changes if the transaction fails or is interrupted.
 */
export const applyAdd = (input: {
  root: string;
  plan: AddPlan;
  project: Pick<AddProject, "previous" | "tamper">;
  manifest: Manifest;
  stateManifest: Manifest;
  brief: Brief;
}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writer = yield* openProject(input.root);
      const exists = (rel: string) => fs.exists(path.join(writer.root, rel));
      const writeOrReplace = (rel: string, text: string) =>
        Effect.gen(function* () {
          if (yield* exists(rel)) yield* writer.rewrite(rel, encoder.encode(text));
          else yield* writer.write(rel, encoder.encode(text));
        });
      for (const operation of fileOperations(input.plan)) {
        if (operation.rewrite) yield* writer.rewrite(operation.destination, operation.bytes);
        else
          yield* writer.write(
            operation.destination,
            operation.bytes,
            (operation.file.mode & 0o111) !== 0,
          );
      }
      // The ignore file and NOTES.md belong to the project once written, so only a missing one
      // is created.
      for (const [rel, text] of STARTER_METADATA)
        if (!(yield* exists(rel))) yield* writer.write(rel, encoder.encode(text));
      yield* writer.directory(STATE_DIR);
      yield* writeOrReplace(BRIEF_PATH, input.brief.text);
      const recorded = yield* recordState(
        input.manifest,
        input.stateManifest,
        input.project,
        writer.root,
      );
      yield* writeOrReplace(MANIFEST_PATH, encodeManifest(input.manifest));
      return recorded;
    }),
  ).pipe(
    Effect.catchTag("TargetNotEmpty", (error) =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const root = error.details?.path ?? input.root;
        return yield* new PermissionDenied({
          details: {
            reason: "blocked",
            path: path.resolve(root, error.details?.entries[0] ?? "."),
          },
        });
      }),
    ),
  );
