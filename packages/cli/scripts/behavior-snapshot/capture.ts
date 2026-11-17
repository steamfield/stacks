import { isUtf8 } from "node:buffer";
import {
  type BigIntStats,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { type Normalize, normalizeTerminal } from "./normalize";
import { type Audience, runCommand } from "./process";

export type Runner = { node: string; binary: string; packageRoot: string };

export function put(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

export function writeJson(file: string, value: unknown) {
  put(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function environment(home: string, node: string, telemetryUrl?: string) {
  const templates = join(home, "git-templates");
  mkdirSync(templates, { recursive: true });
  put(join(home, ".gitconfig"), "[init]\n\tdefaultBranch = main\n");
  return {
    HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
    XDG_STATE_HOME: join(home, "state"),
    XDG_CACHE_HOME: join(home, "cache"),
    TMPDIR: join(home, "tmp"),
    PATH: `${dirname(node)}:/usr/bin:/bin`,
    SHELL: "/bin/sh",
    LC_ALL: "C",
    TZ: "UTC",
    TERM: "xterm-256color",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TEMPLATE_DIR: templates,
    STACKS_LOG_FILE: join(home, "command.jsonl"),
    LOG_LEVEL: "debug",
    ...(telemetryUrl === undefined
      ? { STACKS_OFFLINE: "1" }
      : { STACKS_TELEMETRY_URL: telemetryUrl }),
  };
}

type Entry = { mode: number } & (
  | { text: string }
  | { base64: string }
  | { link: string }
  | { type: "directory" | "fifo" | "special" }
);
type Files = Map<string, { entry: Entry; revision: string }>;

function readEntry(path: string, stat: BigIntStats): Entry {
  const mode = Number(stat.mode) & 0o777;
  if (stat.isDirectory()) return { mode, type: "directory" };
  if (stat.isFIFO()) return { mode, type: "fifo" };
  if (stat.isSymbolicLink()) return { mode, link: readlinkSync(path) };
  if (!stat.isFile()) return { mode, type: "special" };
  const bytes = readFileSync(path);
  return {
    mode,
    ...(isUtf8(bytes) && !bytes.includes(0)
      ? { text: bytes.toString("utf8") }
      : { base64: bytes.toString("base64") }),
  };
}

export function readTree(root: string, prefix = ""): Files {
  const files: Files = new Map();
  if (!existsSync(root)) return files;
  for (const item of readdirSync(root).sort((a, b) => a.localeCompare(b, "en"))) {
    const path = join(root, item);
    const name = join(prefix, item);
    const stat = lstatSync(path, { bigint: true });
    const directory = stat.isDirectory();
    // A file can be rewritten with identical bytes. Track metadata only for the before/after check.
    const revision = directory ? "" : `${stat.mtimeNs}:${stat.ctimeNs}`;
    files.set(name, { entry: readEntry(path, stat), revision });
    if (directory) {
      for (const [key, file] of readTree(path, name)) files.set(key, file);
    }
  }
  return files;
}

export function normalizedFiles(files: Files, normalize: Normalize) {
  return Array.from(files, ([path, { entry }]) => ({
    path: normalize(path),
    ...("text" in entry ? { ...entry, text: normalize(entry.text) } : entry),
    ...("link" in entry ? { link: normalize(entry.link) } : {}),
  })).sort((a, b) => a.path.localeCompare(b.path, "en"));
}

function fileChanges(before: Files, after: Files, normalize: Normalize) {
  const written = new Map(
    Array.from(after).filter(
      ([path, file]) => JSON.stringify(file) !== JSON.stringify(before.get(path)),
    ),
  );
  return {
    written: normalizedFiles(written, normalize),
    removed: Array.from(before.keys())
      .filter((path) => !after.has(path))
      .map(normalize)
      .sort(),
  };
}

type Capture = {
  runner: Runner;
  out: string;
  args: ReadonlyArray<string>;
  audience: Audience;
  cwd: string;
  workspace: string;
  env: ReturnType<typeof environment>;
  normalize: Normalize;
};

function filesFor({ workspace, env }: Capture): Files {
  return new Map([
    ...readTree(workspace, "workspace"),
    ...readTree(join(env.XDG_CONFIG_HOME, "stacks"), "registry"),
    ...readTree(join(env.XDG_STATE_HOME, "stacks"), "state"),
  ]);
}

export async function capture(input: Capture) {
  const { args, audience, cwd, env, normalize, out, runner } = input;
  mkdirSync(env.TMPDIR, { recursive: true });
  if (existsSync(env.STACKS_LOG_FILE)) writeFileSync(env.STACKS_LOG_FILE, "");
  const before = filesFor(input);
  const { exitCode, signal, stdout, stderr } = await runCommand({
    ...runner,
    args,
    audience,
    cwd,
    env,
    label: basename(out),
  });
  writeJson(join(out, "result.json"), {
    args: [...args, ...(audience === "json" ? ["--json"] : [])],
    cwd: normalize(cwd),
    exitCode,
    ...(signal === null ? {} : { signal }),
  });
  const terminalText = audience === "human" ? normalizeTerminal(stdout) : stdout;
  put(join(out, "stdout.txt"), normalize(terminalText));
  put(join(out, "stderr.txt"), normalize(stderr));
  const log = existsSync(env.STACKS_LOG_FILE) ? readFileSync(env.STACKS_LOG_FILE, "utf8") : "";
  put(join(out, "command.jsonl"), normalize(log));
  writeJson(join(out, "files.json"), fileChanges(before, filesFor(input), normalize));
}
