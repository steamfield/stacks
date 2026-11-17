/**
 * Links scaffolds to later verify reports for time-to-green and first-test measurements. The
 * link supplies a random telemetry project id so the manifest's own id stays local.
 */
import type { DependencyAllowlist, RunRecord } from "@steamfield/stacks-format";
import { Clock, Effect, Option, Schema } from "effect";
import { readDependencies } from "../core/deps/index";
import { locateManifest, readManifest } from "../core/project/manifest";
import { countAsked } from "../core/runs";
import { NOTES_PATH } from "../project-layout";
import { type ScaffoldFacts, scaffoldEvent, verifyEvent } from "./events";
import { DAY, Project, read, remove, type Storage, uuid, write } from "./storage";

/** A project link older than this is ignored and deleted. */
const LINK_RETENTION = 365 * DAY;
/** Minimum interval before a linked project is eligible to spool dependency names again. */
const DEPS_INTERVAL = 7 * DAY;

const ProjectJson = Schema.fromJsonString(Project);

type ManifestLocation = { path: string; root: string };
type ProjectLink = { file: string; root: string; project: Project };

/**
 * Creates or refreshes the project's link and returns the scaffold event body with the telemetry
 * project id. A refresh keeps the link's id and scaffold time and adds the new step names.
 */
export const linkScaffold = Effect.fn("telemetry.linkScaffold")(function* (
  store: Storage,
  input: ScaffoldFacts,
) {
  const event = scaffoldEvent(input);
  const file = store.path.join("projects", `${input.manifest.projectId}.json`);
  const previous = yield* read(store, file, ProjectJson).pipe(Effect.option);
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

const locate = (cwd: string) => locateManifest(cwd).pipe(Effect.option);

/** The link for the project at `location`, if one exists and hasn't expired (expired ones go). */
const linkedProject = Effect.fn("telemetry.linkedProject")(function* (
  store: Storage,
  location: Option.Option<ManifestLocation>,
) {
  if (Option.isNone(location)) return undefined;
  const manifest = yield* readManifest(location.value.path);
  const file = store.path.join("projects", `${manifest.projectId}.json`);
  const saved = yield* read(store, file, ProjectJson).pipe(Effect.option);
  if (Option.isNone(saved)) return undefined;
  const now = yield* Clock.currentTimeMillis;
  if (now - Date.parse(saved.value.scaffoldedAt) > LINK_RETENTION) {
    yield* remove(store, file);
    return undefined;
  }
  const link: ProjectLink = { file, root: location.value.root, project: saved.value };
  return link;
});

/** Whether a run counts as the project's first passing test: a test step passed, not changed. */
const passedATest = (record: RunRecord) =>
  record.outcome !== "changed" &&
  record.steps.some((step) => step.layer === "test" && step.status === "passed");

/** Sets the link's first-test-pass time the first time a run passes a test. */
const noteFirstTestPass = Effect.fn("telemetry.noteFirstTestPass")(function* (
  store: Storage,
  link: ProjectLink,
  input: { record: RunRecord; now: number },
) {
  if (link.project.firstTestPassAt || !passedATest(input.record)) return link;
  const project = { ...link.project, firstTestPassAt: new Date(input.now).toISOString() };
  yield* write(store, link.file, project);
  return { ...link, project };
});

/** The number of questions under `## Asked` in the project's NOTES file, if it can be read. */
const askedCount = (store: Storage, location: Option.Option<ManifestLocation>) =>
  Option.isNone(location)
    ? Effect.succeed(undefined)
    : store.fs.readFileString(store.path.join(location.value.root, NOTES_PATH)).pipe(
        Effect.option,
        Effect.map((notes) => (Option.isSome(notes) ? countAsked(notes.value) : undefined)),
      );

const depsSpooledRecently = (project: Project, now: number) => {
  const previous = project.depsSentAt === undefined ? Number.NaN : Date.parse(project.depsSentAt);
  return Number.isFinite(previous) && now - previous < DEPS_INTERVAL;
};

/** Builds the verify event for the project in `cwd`, updating its link along the way. */
export const verifyEventFor = Effect.fn("telemetry.verifyEventFor")(function* (input: {
  store: Storage;
  cwd: string;
  record: RunRecord;
  cachedAllowlist: Effect.Effect<Option.Option<DependencyAllowlist>>;
}) {
  const { store, record } = input;
  const location = yield* locate(input.cwd);
  const found = yield* linkedProject(store, location);
  const now = yield* Clock.currentTimeMillis;
  const link = found && (yield* noteFirstTestPass(store, found, { record, now }));
  const event = verifyEvent(record, link?.project, now, yield* askedCount(store, location));
  if (!link || record.outcome !== "green") return event;
  if (depsSpooledRecently(link.project, now)) return event;
  const allowlist = yield* input.cachedAllowlist;
  if (Option.isNone(allowlist)) return event;
  const deps = yield* readDependencies(link.root, allowlist.value);
  return { ...event, deps };
});

export const markDepsSpooled = Effect.fn("telemetry.markDepsSpooled")(function* (
  store: Storage,
  cwd: string,
  eventTime: string,
) {
  const link = yield* linkedProject(store, yield* locate(cwd));
  if (link) yield* write(store, link.file, { ...link.project, depsSentAt: eventTime });
});
