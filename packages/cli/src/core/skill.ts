import { Duration, Effect, FileSystem, Option, Path, type PlatformError, Random } from "effect";
import { AppConfig, GIT_REPOSITORY_VARIABLES } from "../config";
import { NotFound, PermissionDenied, TargetNotEmpty } from "../errors";
import type { SkillName, SkillResult } from "../schemas/skill";
import { Host } from "../services/host";
import { Processes } from "../services/processes";
import { openProject, type ProjectWriter, within } from "./scaffold/write";

// A skill's SKILL.md loads whole whenever it triggers, so it pays for itself only when it is
// short. References under a skill load only when the skill sends the agent to them.
export const SKILL_WORDS = { stacks: 600, "stacks-author": 800 } as const satisfies Record<
  SkillName,
  number
>;

/** One file of a bundled skill: its path relative to the skill directory, `/`-separated. */
type SkillFile = { readonly rel: string; readonly bytes: Uint8Array };
type FileState = "absent" | "same" | "differs";
/** The directory part of a `/`-separated relative path that has one. */
const parentOf = (rel: string) => rel.slice(0, rel.lastIndexOf("/"));

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
  const toplevel = found?.stdout.replace(/\n$/, "");
  return found && !found.timedOut && !found.truncated && found.exitCode === 0 && toplevel
    ? toplevel
    : cwd;
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

/** `--print`: only SKILL.md, without looking up or writing an install target. */
const printSkill = (dir: string, name: SkillName) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(dir, "SKILL.md");
    const text = yield* fs.readFileString(file).pipe(Effect.mapError(sourceError(dir, file)));
    return {
      name,
      path: null,
      action: "printed",
      files: [{ path: "SKILL.md", action: "printed" }],
      text,
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

/** The installed skill's checks and replacement, bound to one writer and skill directory. */
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
  const denied = (rel: string) => () =>
    new PermissionDenied({ details: { reason: "unwritable", path: shown(rel) } });
  const escaped = (rel: string) =>
    new PermissionDenied({ details: { reason: "escape", path: shown(rel) } });

  const inspect = (file: SkillFile) =>
    Effect.gen(function* () {
      const at = real(file.rel);
      const info = yield* fs
        .lstat(at)
        .pipe(
          Effect.catch((error) =>
            error.reason._tag === "NotFound"
              ? Effect.succeed(undefined)
              : Effect.fail(denied(file.rel)()),
          ),
        );
      if (info?.type === "SymbolicLink") return yield* escaped(file.rel);
      if (info && info.type !== "File") return yield* occupied([file.rel], "non-file");
      if (!info) return "absent" satisfies FileState;
      const current = yield* fs.readFile(at).pipe(Effect.mapError(denied(file.rel)));
      const same =
        current.length === file.bytes.length && current.every((byte, i) => byte === file.bytes[i]);
      return (same ? "same" : "differs") satisfies FileState;
    });

  // Stage through the safe writer, then rename: a failed write keeps the user's copy.
  const replace = (file: SkillFile) =>
    Effect.gen(function* () {
      const at = real(file.rel);
      const suffix = (yield* Random.nextIntBetween(0, 0xffffff)).toString(16);
      const base = file.rel.slice(file.rel.lastIndexOf("/") + 1);
      const temporary = `${parentOf(`${name}/${file.rel}`)}/.${base}.${suffix}.tmp`;
      yield* writer.write(temporary, file.bytes);
      const parentInside = yield* fs.realPath(path.dirname(at)).pipe(
        Effect.map((resolved) => within(writer.root, resolved, path.sep)),
        Effect.mapError(denied(file.rel)),
      );
      if (!parentInside) return yield* escaped(file.rel);
      const latest = yield* fs.lstat(at).pipe(Effect.mapError(denied(file.rel)));
      if (latest.type === "SymbolicLink") return yield* escaped(file.rel);
      if (latest.type !== "File") return yield* occupied([file.rel], "non-file");
      yield* fs
        .rename(path.join(writer.root, ...temporary.split("/")), at)
        .pipe(Effect.mapError(denied(file.rel)));
    });

  return { inspect, replace, occupied };
};

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

    const planned: Array<SkillFile & { state: FileState }> = [];
    for (const file of files) planned.push({ ...file, state: yield* installed.inspect(file) });
    const differing = planned.filter((file) => file.state === "differs").map((file) => file.rel);
    if (differing.length > 0 && !options.force) return yield* installed.occupied(differing);

    for (const file of planned) {
      if (file.state === "absent") yield* writer.write(`${name}/${file.rel}`, file.bytes);
      if (file.state === "differs") yield* installed.replace(file);
    }
    return installResult(name, path.join(dir, "SKILL.md"), planned);
  });

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
