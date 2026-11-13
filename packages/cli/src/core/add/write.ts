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

/** Keep manifest-only projects manifest-only; a first add may lack writable external state. */
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

/** Write the delta as one transaction, state first and manifest last. */
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
      const operations = [
        ...input.plan.write.map((file) => ({
          file,
          bytes: file.bytes,
          destination: file.path,
          rewrite: false,
        })),
        ...input.plan.park.map(({ file, bytes, incoming, action }) => ({
          file,
          bytes,
          destination: incoming,
          rewrite: action === "merge",
        })),
      ].sort((a, b) => {
        if (a.file.path < b.file.path) return -1;
        return a.file.path > b.file.path ? 1 : 0;
      });
      for (const operation of operations) {
        if (operation.rewrite) yield* writer.rewrite(operation.destination, operation.bytes);
        else
          yield* writer.write(
            operation.destination,
            operation.bytes,
            (operation.file.mode & 0o111) !== 0,
          );
      }
      const metadata = (rel: string, text: string) =>
        Effect.gen(function* () {
          if (yield* fs.exists(path.join(writer.root, rel)))
            yield* writer.rewrite(rel, encoder.encode(text));
          else yield* writer.write(rel, encoder.encode(text));
        });
      const metadataFiles: ReadonlyArray<readonly [string, string]> = [
        [IGNORE_PATH, IGNORE],
        [NOTES_PATH, NOTES],
      ];
      for (const [rel, text] of metadataFiles)
        if (!(yield* fs.exists(path.join(writer.root, rel))))
          yield* writer.write(rel, encoder.encode(text));
      yield* writer.directory(STATE_DIR);
      yield* metadata(BRIEF_PATH, input.brief.text);
      const recorded = yield* recordState(
        input.manifest,
        input.stateManifest,
        input.project,
        writer.root,
      );
      yield* metadata(MANIFEST_PATH, encodeManifest(input.manifest));
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
