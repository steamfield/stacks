import type { DependencyAllowlist, RunRecord } from "@steamfield/stacks-format";
import { Clock, Effect, Option, Schema } from "effect";
import { readDependencies } from "../core/deps";
import { locateManifest, readManifest } from "../core/manifest";
import { countAsked } from "../core/runs";
import { NOTES_PATH } from "../project-layout";
import { type ScaffoldFacts, scaffoldEvent, verifyEvent } from "./events";
import { DAY, Project, read, remove, type Storage, uuid, write } from "./storage";

export const scaffold = Effect.fn("telemetry.scaffold")(function* (
  store: Storage,
  input: ScaffoldFacts,
) {
  const event = scaffoldEvent(input);
  const file = store.path.join("projects", `${input.manifest.projectId}.json`);
  const previous = yield* read(store, file, Schema.fromJsonString(Project)).pipe(Effect.option);
  const project: Project = Option.isSome(previous)
    ? previous.value
    : {
        telemetryProjectId: yield* uuid,
        scaffoldedAt: input.manifest.createdAt,
        stack: event.stack,
        fragments: event.fragments,
        steps: [],
      };
  yield* write(store, file, {
    ...project,
    stack: event.stack,
    fragments: event.fragments,
    steps: [...new Set([...project.steps, ...input.steps])],
  });
  return { ...event, projectId: project.telemetryProjectId };
});
const located = (cwd: string) => locateManifest(cwd).pipe(Effect.option);
const linkedProject = Effect.fn("telemetry.linkedProject")(function* (
  store: Storage,
  located: Option.Option<{ path: string; root: string }>,
) {
  if (Option.isNone(located)) return undefined;
  const manifest = yield* readManifest(located.value.path);
  const file = store.path.join("projects", `${manifest.projectId}.json`);
  const saved = yield* read(store, file, Schema.fromJsonString(Project)).pipe(Effect.option);
  if (Option.isNone(saved)) return undefined;
  const now = yield* Clock.currentTimeMillis;
  if (now - Date.parse(saved.value.scaffoldedAt) > 365 * DAY) {
    yield* remove(store, file);
    return undefined;
  }
  return { file, root: located.value.root, project: saved.value };
});
export const verify = Effect.fn("telemetry.verify")(function* (input: {
  store: Storage;
  cwd: string;
  record: RunRecord;
  cachedAllowlist: Effect.Effect<Option.Option<DependencyAllowlist>>;
}) {
  const { store, record } = input;
  const manifest = yield* located(input.cwd);
  const link = yield* linkedProject(store, manifest);
  let project = link?.project;
  const now = yield* Clock.currentTimeMillis;
  const testPassed =
    record.outcome !== "changed" &&
    record.steps.some((step) => step.layer === "test" && step.status === "passed");
  if (link && project && !project.firstTestPassAt && testPassed) {
    project = { ...project, firstTestPassAt: new Date(now).toISOString() };
    yield* write(store, link.file, project);
  }
  const notes = Option.isSome(manifest)
    ? yield* store.fs
        .readFileString(store.path.join(manifest.value.root, NOTES_PATH))
        .pipe(Effect.option)
    : Option.none<string>();
  const event = verifyEvent(
    record,
    project,
    now,
    Option.isSome(notes) ? countAsked(notes.value) : undefined,
  );
  if (!link || record.outcome !== "green" || !project) return event;
  const previous = project.depsSentAt === undefined ? Number.NaN : Date.parse(project.depsSentAt);
  if (Number.isFinite(previous) && now - previous < 7 * DAY) return event;
  const allowlist = yield* input.cachedAllowlist;
  if (Option.isNone(allowlist)) return event;
  const deps = yield* readDependencies(link.root, allowlist.value);
  return { ...event, deps };
});

export const markDepsSent = Effect.fn("telemetry.markDepsSent")(function* (
  store: Storage,
  cwd: string,
  sentAt: string,
) {
  const link = yield* linkedProject(store, yield* located(cwd));
  if (link) yield* write(store, link.file, { ...link.project, depsSentAt: sentAt });
});
