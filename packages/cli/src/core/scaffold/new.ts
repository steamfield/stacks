/**
 * Builds a new project from a composition (trust point 1). Rendering finishes before `openProject`,
 * so preview and real runs use the same rendered plan.
 */
import type { AgentId, Manifest } from "@steamfield/stacks-format";
import { Effect, Exit, FileSystem, Option, Path } from "effect";
import { AppConfig } from "../../config";
import { BadInput, ComposeConflict } from "../../errors";
import {
  BRIEF_PATH,
  IGNORE,
  IGNORE_PATH,
  NOTES,
  NOTES_PATH,
  projectFiles,
  STATE_DIR,
} from "../../project-layout";
import type { Settings } from "../../schemas/config";
import type { NewPreset, NewResult } from "../../schemas/new";
import { Host } from "../../services/host";
import { Output } from "../../services/output";
import { renderBrief } from "../brief/render";
import type { Brief, GitState } from "../brief/types";
import { targetAgents } from "../compose/agents";
import { compose, dropFlags } from "../compose/compose";
import { composeFilesWithNeutral, type RenderedFile } from "../compose/files";
import { missingToolsOnPath } from "../compose/tools";
import type { Composition } from "../compose/types";
import { fingerprintFromFiles } from "../fingerprint";
import { type HandoffDecision, handoffRecord } from "../handoff";
import { type GitProbe, gitInit, gitInstalled, probeGit } from "../project/git";
import { buildManifest, encodeManifest, MANIFEST_PATH } from "../project/manifest";
import { removeProjectState, writeProjectState } from "../project/state";
import { templateOverrides, templateValues } from "../project/template-values";
import { openProject, type ProjectWriter } from "../project/writer";
import { DEFAULT_PAYLOAD, type Payload } from "../registry/entry";
import { slug } from "../slug";
import { hasControl } from "../text";
import { fillMarkers } from "./fill";
import { inspectTarget } from "./target";

export type NewOptions = {
  stack: string;
  /** Relative to `Host.cwd`; defaults to the slug of `name`, else the stack id. */
  dir: string | undefined;
  name: string | undefined;
  author: string | undefined;
  dryRun: boolean;
  with: ReadonlyArray<string>;
  without: ReadonlyArray<string>;
  sandbox: boolean;
  preset?: NewPreset;
  payload?: Payload;
  ownRepo?: boolean;
  yes: boolean;
  agents: ReadonlyArray<AgentId> | undefined;
  scope: string | undefined;
  /**
   * The handoff for the composed project, given the ids of its untrusted entries; decided before
   * anything is written, so the manifest records it in the one write.
   */
  handoff: (untrusted: ReadonlyArray<string>) => HandoffDecision;
};

type Scaffolded = {
  result: Omit<NewResult, "handoff">;
  decision: HandoffDecision;
  manifest: Manifest;
  composition: Composition;
};

type PlannedFile = Pick<RenderedFile, "path" | "bytes" | "executable">;

type GitInitFailure = { exitCode: number; brief: Brief };

const encoder = new TextEncoder();

/**
 * Explicit flags (including `--sandbox`), then the setting, then default. Lean composes and
 * records as default, minus the default fragments.
 */
function scaffoldPreset(options: NewOptions, setting: NewOptions["preset"]): NewPreset {
  return options.preset ?? (options.sandbox ? "sandbox" : (setting ?? "default"));
}

/**
 * `--own-repo` inside another work tree: the target becomes its own fresh repository. The target
 * is empty but for `.git` and OS files, so the enclosing repository tracks nothing in it.
 */
function ownRepository(git: GitProbe, ownRepo: boolean | undefined): GitProbe {
  if (!ownRepo || git.state.kind !== "parent" || git.own) return git;
  return { state: { kind: "fresh" }, init: true, own: true };
}

/** The fixed `.stacks/` files written after the entry files; the manifest comes last, apart. */
function plannedFiles(files: ReadonlyArray<PlannedFile>, briefText: string): PlannedFile[] {
  return [
    ...files,
    { path: IGNORE_PATH, bytes: encoder.encode(IGNORE), executable: false },
    { path: BRIEF_PATH, bytes: encoder.encode(briefText), executable: false },
    { path: NOTES_PATH, bytes: encoder.encode(NOTES), executable: false },
  ];
}

/**
 * The absolute project directory (`--dir`, else the slug of `--name`, else the stack id) and the
 * project name (`--name`, else the directory's name), with both checked as template values.
 */
const projectLocation = (options: NewOptions, cwd: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const dir = path.resolve(
      cwd,
      options.dir ?? (options.name === undefined ? options.stack : slug(options.name)),
    );
    const basename = path.basename(dir);
    if (hasControl(basename))
      return yield* new BadInput({ details: { id: basename, flag: "dir" } });
    const name = options.name ?? basename;
    yield* templateOverrides({ name });
    return { dir, name };
  });

const composeProject = (input: {
  options: NewOptions;
  preset: NewPreset;
  payload: Payload;
  settings: Settings;
}) =>
  compose({
    stack: input.options.stack,
    with: input.options.with,
    without: input.options.without,
    preset: input.preset === "lean" ? "default" : input.preset,
    lean: input.preset === "lean",
    payload: input.payload,
    agents: targetAgents(input.options.agents, input.settings),
    always: input.settings.always ?? [],
    mode: "new",
  });

/**
 * Refuses fragments that need their own repository when the target sits inside another one. A
 * repository rooted at the target is the project's own, so it can hold them.
 */
const checkOwnRepo = (composition: Composition, git: GitProbe) =>
  Effect.gen(function* () {
    if (git.state.kind !== "parent" || git.own || !composition.needsOwnRepo.length) return;
    const owners = composition.needsOwnRepo.map((id) => ({ kind: "fragment" as const, id }));
    const drop = dropFlags(composition, owners);
    return yield* new ComposeConflict({
      details: {
        reason: "needs_own_repo",
        ids: [...composition.needsOwnRepo],
        path: git.state.toplevel,
        fix:
          drop.length && drop.every((item) => item.flag === "without")
            ? drop.map((item) => `--without ${item.id}`)
            : [],
      },
    });
  });

const projectManifest = (input: {
  composition: Composition;
  name: string;
  briefWords: number;
  fingerprint: string;
  decision: HandoffDecision;
}) =>
  Effect.gen(function* () {
    const built = yield* buildManifest(input.composition, { briefWords: input.briefWords });
    // Outside the step digest (Trust model point 5), so filling it changes no digest.
    return {
      ...built,
      name: input.name,
      fingerprint: input.fingerprint,
      handoff: handoffRecord(input.decision, built.createdAt),
    } satisfies Manifest;
  });

/** Write the manifest last among project files. */
const writeFiles = Effect.fn("scaffold.writeFiles")(function* (
  writer: ProjectWriter,
  files: ReadonlyArray<PlannedFile>,
  manifestBytes: Uint8Array,
) {
  const output = yield* Output;
  yield* output.live("Writing files");
  for (const file of files) yield* writer.write(file.path, file.bytes, file.executable);
  yield* writer.directory(STATE_DIR);
  yield* writer.write(MANIFEST_PATH, manifestBytes);
}, Effect.scoped);

/**
 * Runs `git init` in the project. When it fails, removes whatever part of a `.git` it left and
 * rewrites the brief and the manifest's word count for a project without git.
 */
const initializeGit = Effect.fn("scaffold.initializeGit")(function* (
  writer: ProjectWriter,
  input: { manifest: Manifest; briefWithoutGit: () => Brief },
) {
  const output = yield* Output;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* output.live("git init");
  // Adopted first, so an interrupt while git runs also takes its `.git` away; but only a
  // `.git` that wasn't there before git ran is ours to take.
  const ours = Option.isNone(yield* Effect.option(fs.lstat(path.join(writer.root, ".git"))));
  if (ours) yield* writer.adopt(".git");
  const exitCode = yield* gitInit(writer.root);
  if (exitCode === 0) return undefined;
  // Whatever part of a `.git` the failed init left is no repository.
  if (ours) yield* writer.discard(".git");
  const brief = input.briefWithoutGit();
  yield* writer.replace(BRIEF_PATH, encoder.encode(brief.text));
  // Only the count changed; the digest, and so the state record, stay as written.
  yield* writer.replace(
    MANIFEST_PATH,
    encoder.encode(encodeManifest({ ...input.manifest, briefWords: brief.briefWords })),
  );
  return { exitCode, brief } satisfies GitInitFailure;
}, Effect.scoped);

/**
 * Write project files, then the state record, then initialize git within one scope. A later
 * failure or interruption rolls back earlier writes through `openProject` and the state
 * record's `removeProjectState` release.
 */
const writeProject = (input: {
  dir: string;
  files: ReadonlyArray<PlannedFile>;
  manifest: Manifest;
  manifestBytes: Uint8Array;
  initGit: boolean;
  briefWithoutGit: () => Brief;
}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const writer = yield* openProject(input.dir);
      yield* writeFiles(writer, input.files, input.manifestBytes);
      // Outside the project, so the writer doesn't track it: its own release undoes it on a
      // failure or interruption from here on. Acquiring is uninterruptible, so a written record
      // always has its release.
      const record = yield* Effect.acquireRelease(
        writeProjectState(input.manifest, path.join(writer.root, MANIFEST_PATH)),
        (write, exit) => (Exit.isSuccess(exit) ? Effect.void : removeProjectState(write)),
      );
      const gitFailure = input.initGit
        ? yield* initializeGit(writer, {
            manifest: input.manifest,
            briefWithoutGit: input.briefWithoutGit,
          })
        : undefined;
      return { stateRecord: record.written, gitFailure };
    }),
  );

/** Scaffold from entry data alone (trust point 1). Previews stop before `openProject`. */
export const scaffold = (options: NewOptions) =>
  Effect.gen(function* () {
    const host = yield* Host;
    const settings = yield* (yield* AppConfig).get;

    const overrides = yield* templateOverrides(options);
    const { dir, name } = yield* projectLocation(options, host.cwd);
    const preset = scaffoldPreset(options, settings.preset);
    const payload = options.payload ?? DEFAULT_PAYLOAD;
    const composition = yield* composeProject({ options, preset, payload, settings });

    const target = yield* inspectTarget(dir);
    const installed = yield* gitInstalled;
    const git = ownRepository(yield* probeGit(target, installed), options.ownRepo);
    yield* checkOwnRepo(composition, git);

    const missing = yield* missingToolsOnPath(composition);

    const values = yield* templateValues({
      name,
      settings,
      overrides,
      git: { cwd: target.nearest, installed },
    });
    const composed = yield* composeFilesWithNeutral(composition, values);
    // Markers stacks can fill from the composition alone; neutral files keep them for the fingerprint.
    const files = fillMarkers(composed.files, composition);
    const contentFingerprint = fingerprintFromFiles(composition, composed.neutralFiles);

    const written = projectFiles(files);
    const renderFor = (state: GitState) =>
      renderBrief(composition, {
        project: name,
        git: state,
        written,
        missing,
        yes: options.yes || preset === "sandbox",
        invocation: host.invocation,
      });
    const brief = renderFor(git.state);
    const decision = options.handoff(composition.untrusted.map((entry) => entry.id));
    const manifest = yield* projectManifest({
      composition,
      name,
      briefWords: brief.briefWords,
      fingerprint: contentFingerprint,
      decision,
    });
    const manifestBytes = encoder.encode(encodeManifest(manifest));

    // A preview stops at the writer boundary, after the same composition and rendering.
    const outcome = options.dryRun
      ? { stateRecord: false, gitFailure: undefined }
      : yield* writeProject({
          dir,
          files: plannedFiles(files, brief.text),
          manifest,
          manifestBytes,
          initGit: git.init,
          briefWithoutGit: () => renderFor({ kind: "none" }),
        });
    const { gitFailure } = outcome;
    const finalBrief = gitFailure?.brief ?? brief;
    const warnings: Array<NewResult["warnings"][number]> = [
      ...composition.warnings,
      ...(git.warning ? [git.warning] : []),
    ];
    if (gitFailure)
      warnings.push({ code: "git_init_failed", id: "git", exitCode: gitFailure.exitCode });

    const result = {
      project: dir,
      dryRun: options.dryRun,
      fingerprint: contentFingerprint,
      stack: composition.stack.id,
      fragments: composition.fragments.map((fragment) => fragment.id),
      preset,
      payload,
      agents: [...composition.agents],
      written,
      brief: BRIEF_PATH,
      briefWords: finalBrief.briefWords,
      fixedWords: finalBrief.fixedWords,
      missingTools: missing.map((item) => ({
        tool: item.tool,
        owners: [...item.owners],
        drop: [...item.drop],
      })),
      untrusted: [...composition.untrusted],
      warnings,
      git: gitFailure ? "none" : git.state.kind,
      stateRecord: outcome.stateRecord,
    } satisfies Scaffolded["result"];
    return { result, decision, manifest, composition } satisfies Scaffolded;
  });
