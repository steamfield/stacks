/**
 * Installs one of the CLI's bundled agent skills into a Claude Code skills directory, or prints
 * its `SKILL.md`, for `stacks skill install`.
 *
 * A skill is a folder of instructions a coding agent loads on its own when a task matches it. The
 * package ships two under `skills/` (`Host.skill`): `stacks`, which teaches an agent to use the
 * CLI, and `stacks-author`, which teaches it to write entries. `commands/skill.ts` calls
 * `installSkill`, which copies every file of `skills/<name>/` to `.claude/skills/<name>/` under
 * the user's HOME, or under the project's git root with `--project`.
 *
 * Every installed file is compared with the bundled one before anything is written. Identical
 * files are left alone, missing ones are written, and if any file differs the whole install is
 * refused with `TargetNotEmpty` unless `--force` is given, so a skill the user edited is never
 * overwritten by surprise. Writes go through `scaffold/write.ts::openProject`, which refuses
 * symlinks out of the target and rolls back every file written if a later one fails. Start at
 * `installSkill`.
 */
import { Duration, Effect, FileSystem, Option, Path, type PlatformError } from "effect";
import { AppConfig, GIT_REPOSITORY_VARIABLES } from "../config";
import { NotFound, PermissionDenied, TargetNotEmpty } from "../errors";
import type { SkillName, SkillResult } from "../schemas/skill";
import { Host } from "../services/host";
import { type Captured, Processes } from "../services/processes";
import { rewriteAuthorLinks } from "./guide";
import { openProject, type ProjectWriter } from "./scaffold/write";

/**
 * The word budget for each skill's `SKILL.md`. A skill's SKILL.md loads whole whenever it
 * triggers, so it pays for itself only when it is short. References under a skill load only when
 * the skill sends the agent to them.
 */
export const SKILL_WORDS = { stacks: 600, "stacks-author": 800 } as const satisfies Record<
  SkillName,
  number
>;

/** One file of a bundled skill: its path relative to the skill directory, `/`-separated. */
type SkillFile = { readonly rel: string; readonly bytes: Uint8Array };
/** How an installed file compares with the bundled one. */
type FileState = "absent" | "same" | "differs";
type PlannedFile = SkillFile & { readonly state: FileState };

/** The directory part of a `/`-separated relative path that has one. */
const parentOf = (rel: string) => rel.slice(0, rel.lastIndexOf("/"));

const sameBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((byte, i) => byte === right[i]);

/** The toplevel `git rev-parse --show-toplevel` printed, if it ran cleanly and printed one. */
function toplevelFrom(found: Captured | undefined): string | undefined {
  if (found === undefined || found.timedOut || found.truncated || found.exitCode !== 0) {
    return undefined;
  }
  const toplevel = found.stdout.replace(/\n$/, "");
  return toplevel === "" ? undefined : toplevel;
}

/** The git toplevel, or cwd when git is absent or cwd is outside a work tree. */
const projectRoot = Effect.gen(function* () {
  const { cwd } = yield* Host;
  const config = yield* AppConfig;
  const processes = yield* Processes;
  const git = yield* processes.which("git");
  if (Option.isNone(git)) return cwd;
  const found = yield* processes
    .exec({
      argv: [git.value, "rev-parse", "--show-toplevel"],
      cwd,
      env: config.childEnv(GIT_REPOSITORY_VARIABLES),
      timeout: Duration.seconds(10),
    })
    .pipe(Effect.catchTag("SpawnFailed", () => Effect.succeed(undefined)));
  return toplevelFrom(found) ?? cwd;
});

/** A missing bundled skill is NotFound for its directory; anything else is unreadable. */
const sourceError = (dir: string, file: string) => (error: PlatformError.PlatformError) =>
  error.reason._tag === "NotFound" || error.reason._tag === "BadResource"
    ? new NotFound({ details: { path: dir, suggestions: [] } })
    : new PermissionDenied({ details: { reason: "read", path: file } });

/** Every regular file of a bundled skill directory, sorted; SKILL.md is required. */
const readSkillFiles = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const names = yield* fs
      .readDirectory(dir, { recursive: true })
      .pipe(Effect.mapError(sourceError(dir, dir)));
    const files: SkillFile[] = [];
    for (const name of [...names].sort()) {
      const file = path.join(dir, name);
      const info = yield* fs.stat(file).pipe(Effect.mapError(sourceError(dir, file)));
      if (info.type !== "File") continue;
      const bytes = yield* fs.readFile(file).pipe(Effect.mapError(sourceError(dir, file)));
      files.push({ rel: name.split(path.sep).join("/"), bytes });
    }
    if (!files.some((file) => file.rel === "SKILL.md"))
      return yield* new NotFound({ details: { path: dir, suggestions: [] } });
    return files;
  });

/**
 * The printed copy of a skill. The authoring skill's links to its references become the
 * `guide author` command that prints each one, since the printed copy travels without them.
 */
function printedText(raw: string, name: SkillName, cli: string): string {
  if (name !== "stacks-author") return raw;
  const body = rewriteAuthorLinks(raw, cli).replace(/\n*$/, "\n");
  return `${body}\nThe references this skill links to are printed by ${cli} guide author <topic>.\n`;
}

/** `--print`: only SKILL.md, without looking up or writing an install target. */
const printSkill = (dir: string, name: SkillName) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cli = (yield* Host).invocation;
    const file = path.join(dir, "SKILL.md");
    const raw = yield* fs.readFileString(file).pipe(Effect.mapError(sourceError(dir, file)));
    return {
      name,
      path: null,
      action: "printed",
      files: [{ path: "SKILL.md", action: "printed" }],
      text: printedText(raw, name, cli),
    } satisfies SkillResult;
  });

/** `.claude/skills` under the project root with `--project`, otherwise under the captured HOME. */
const skillsRoot = (project: boolean) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const host = yield* Host;
    // Use only the captured HOME: config.paths deliberately falls back to the OS home.
    const home = (yield* AppConfig).childEnv([]).HOME;
    if (!project && !home?.trim())
      return yield* new PermissionDenied({ details: { reason: "unwritable", path: "$HOME" } });
    const base = project ? yield* projectRoot : path.resolve(host.cwd, home ?? "");
    return path.join(base, ".claude", "skills");
  });

/**
 * The checks on already installed files, bound to one writer and skill directory. Failures name
 * the path as the user sees it (`dir`), not the writer's real path.
 */
const installedFiles = (options: {
  writer: ProjectWriter;
  name: SkillName;
  dir: string;
  fs: FileSystem.FileSystem;
  path: Path.Path;
}) => {
  const { writer, name, dir, fs, path } = options;
  const real = (rel: string) => path.join(writer.root, name, ...rel.split("/"));
  const shown = (rel: string) => path.join(dir, ...rel.split("/"));
  const occupied = (entries: ReadonlyArray<string>, blocker?: "non-file") =>
    new TargetNotEmpty({
      details: { path: dir, entries: [...entries], ...(blocker ? { blocker } : {}) },
    });
  const denied = (rel: string) =>
    new PermissionDenied({ details: { reason: "unwritable", path: shown(rel) } });
  const escaped = (rel: string) =>
    new PermissionDenied({ details: { reason: "escape", path: shown(rel) } });

  /** Compares one installed file with the bundled copy; only NotFound counts as absent. */
  const inspect = (file: SkillFile) =>
    Effect.gen(function* () {
      const at = real(file.rel);
      const info = yield* fs
        .lstat(at)
        .pipe(
          Effect.catch((error) =>
            error.reason._tag === "NotFound"
              ? Effect.succeed(undefined)
              : Effect.fail(denied(file.rel)),
          ),
        );
      if (info?.type === "SymbolicLink") return yield* escaped(file.rel);
      if (info && info.type !== "File") return yield* occupied([file.rel], "non-file");
      if (!info) return "absent" satisfies FileState;
      const current = yield* fs.readFile(at).pipe(Effect.mapError(() => denied(file.rel)));
      return (sameBytes(current, file.bytes) ? "same" : "differs") satisfies FileState;
    });

  return { inspect, occupied };
};

/** Writes the absent files and rewrites the differing ones; identical files stay untouched. */
const applyPlan = (writer: ProjectWriter, name: SkillName, planned: ReadonlyArray<PlannedFile>) =>
  Effect.gen(function* () {
    for (const file of planned) {
      if (file.state === "absent") yield* writer.write(`${name}/${file.rel}`, file.bytes);
      if (file.state === "differs") yield* writer.rewrite(`${name}/${file.rel}`, file.bytes);
    }
  });

/**
 * Writes every file of the skill under `skills/<name>/`. Every file is checked before any is
 * written, so a differing file refuses the whole install (unless `force`) and nothing changes.
 */
const writeSkill = (options: {
  skills: string;
  name: SkillName;
  files: ReadonlyArray<SkillFile>;
  force: boolean;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { name, files } = options;
    const dir = path.join(options.skills, name);
    const writer = yield* openProject(options.skills);
    const installed = installedFiles({ writer, name, dir, fs, path });
    const directories = new Set(files.map((file) => parentOf(`${name}/${file.rel}`)));
    for (const directory of [...directories].sort()) yield* writer.directory(directory);

    const planned: PlannedFile[] = [];
    for (const file of files) planned.push({ ...file, state: yield* installed.inspect(file) });
    const differing = planned.filter((file) => file.state === "differs").map((file) => file.rel);
    if (differing.length > 0 && !options.force) return yield* installed.occupied(differing);

    yield* applyPlan(writer, name, planned);
    return installResult(name, path.join(dir, "SKILL.md"), planned);
  });

/** The install's result: each file `unchanged` or `written`, and the skill `written` if any was. */
function installResult(
  name: SkillName,
  skill: string,
  planned: ReadonlyArray<{ rel: string; state: FileState }>,
): SkillResult {
  const files = planned.map((file): SkillResult["files"][number] => ({
    path: file.rel,
    action: file.state === "same" ? "unchanged" : "written",
  }));
  const written = files.some((file) => file.action === "written");
  return { name, path: skill, action: written ? "written" : "unchanged", files };
}

/**
 * Installs the bundled skill `name` (or prints it with `print`). The bundled files are read in
 * full before the target is looked up, so a broken package fails before anything is written.
 */
export const installSkill = (options: {
  name: SkillName;
  project: boolean;
  force: boolean;
  print: boolean;
}) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const host = yield* Host;
    const source = path.join(host.skill, options.name);
    if (options.print) return yield* printSkill(source, options.name);
    const files = yield* readSkillFiles(source);
    const skills = yield* skillsRoot(options.project);
    return yield* Effect.scoped(
      writeSkill({ skills, name: options.name, files, force: options.force }),
    );
  });
