import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { destructiveReason } from "./_destructive";
import { gitReason } from "./_git";
import { deny, projectRoot, readPayload, text } from "./_lib";
import { type Command, commands } from "./_shell";

/** Resolve symlinks before applying each following component, including `..`. */
function physical(path: string): string {
  let current = "/";
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      current = dirname(current);
      continue;
    }
    current = resolve(current, part);
    try {
      current = realpathSync(current);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      // Missing output is safe to inspect; its existing ancestors have already been resolved.
    }
  }
  return current;
}

/**
 * The directory a plain filename glob expands inside (`./tmp/` for `./tmp/*.log`), or undefined
 * when the word holds other expansions, has no directory part, or globs across directories.
 */
function globDirectory(target: string): string | undefined {
  if (/[$`~{(]/.test(target)) return undefined;
  const first = target.search(/[*?[]/);
  const slash = target.lastIndexOf("/", first);
  if (first < 0 || slash < 0 || target.includes("/", first)) return undefined;
  return target.slice(0, slash + 1);
}

function removalTargetReason(
  target: string,
  options: { root: string; directory: string; expands: boolean },
): string | undefined {
  // A glob inside a subdirectory (rm -rf ./tmp/*) empties that directory: check the directory.
  const checked = options.expands ? globDirectory(target) : target;
  if (checked === undefined) {
    return "Recursive deletion has an unknown target. Name paths inside the project.";
  }
  const path = physical(isAbsolute(checked) ? checked : `${options.directory}/${checked}`);
  const rel = relative(options.root, path);
  if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
    return "Recursive deletion outside the project or of its root is blocked. Ask the user first.";
  }
  return undefined;
}

function recursiveRemovalReason(cmd: Command, cwd: string): string | undefined {
  const args = cmd.argv.slice(1);
  const end = args.indexOf("--");
  const options = end < 0 ? args : args.slice(0, end);
  const recursive = options.some((arg) => arg === "--recursive" || /^-[^-]*[rR]/.test(arg));
  if (!recursive) return undefined;
  if (cmd.remote || cmd.viaXargs || cmd.dir === null) {
    return "Recursive deletion has an unknown target. Name paths inside the project.";
  }
  const root = physical(projectRoot());
  const directory = physical(resolve(cwd, cmd.dir ?? "."));
  for (const [index, target] of args.entries()) {
    const beforeSeparator = end < 0 || index <= end;
    if (beforeSeparator && target.startsWith("-")) continue;
    const reason = removalTargetReason(target, {
      root,
      directory,
      expands: cmd.expands[index + 1] ?? false,
    });
    if (reason) return reason;
  }
  return undefined;
}

function reasonFor(cmd: Command, cwd: string): string | undefined {
  if (cmd.opaque) return "The command is too complex to inspect safely.";
  const reason = destructiveReason(cmd);
  if (reason) return reason;
  const name = basename(cmd.argv[0] ?? "");
  if (name === "rm") return recursiveRemovalReason(cmd, cwd);
  if (name === "git") return gitReason(cmd, cwd);
  return undefined;
}

try {
  const payload = readPayload();
  const cwd = text(payload?.tool_input?.working_directory) || text(payload?.cwd) || process.cwd();
  for (const cmd of commands(text(payload?.tool_input?.command))) {
    const reason = reasonFor(cmd, cwd);
    if (reason) {
      deny(`BLOCKED: ${reason}\nNever work around this block.`);
      break;
    }
  }
} catch {
  deny("BLOCKED: The command guard could not inspect this call safely. Ask the user first.");
}
