import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { Command } from "./_shell";

const message = (reason: string, suggestion: string) => `${reason}\n\n${suggestion}`;
const shortFlag = (args: string[], flag: string) =>
  args.some((arg) => /^-[^-]/.test(arg) && arg.includes(flag));

function gitArgs(args: string[]) {
  let index = 0;
  while (args[index]?.startsWith("-")) {
    index += ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"].includes(
      args[index] ?? "",
    )
      ? 2
      : 1;
  }
  return { global: args.slice(0, index), operation: args[index], rest: args.slice(index + 1) };
}

/** Stop at an option's value: its letters are not further short options. */
function commitCluster(arg: string): "deny" | "next" | "done" {
  for (let index = 1; index < arg.length; index++) {
    const option = arg.charAt(index);
    if (option === "n") return "deny";
    if ("mcCFt".includes(option)) return index === arg.length - 1 ? "next" : "done";
    if ("uS".includes(option)) return "done";
  }
  return "done";
}

function commitSkipsHooks(args: string[]): boolean {
  const valued = new Set([
    "--message",
    "--reuse-message",
    "--reedit-message",
    "--file",
    "--template",
  ]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--") break;
    if (arg === "--no-verify") return true;
    if (valued.has(arg)) {
      index++;
      continue;
    }
    if (!/^-[^-]/.test(arg)) continue;
    const cluster = commitCluster(arg);
    if (cluster === "deny") return true;
    if (cluster === "next") index++;
  }
  return false;
}

/** Checkout, restore and switch forms that throw away working-tree changes. */
function worktreeReason(operation: string | undefined, rest: string[]): string | undefined {
  if (operation === "checkout" && rest.some((arg) => arg === "." || arg === ":/"))
    return message(
      "git checkout . discards every unstaged change.",
      "Revert specific files: git checkout -- <file>",
    );
  const staged = rest.includes("--staged") || shortFlag(rest, "S");
  const worktree = rest.includes("--worktree") || shortFlag(rest, "W");
  if (
    operation === "restore" &&
    rest.some((arg) => arg === "." || arg === ":/") &&
    (!staged || worktree)
  )
    return message(
      "git restore . discards every unstaged change.",
      "Revert specific files: git restore <file>",
    );
  if (
    (operation === "checkout" || operation === "switch") &&
    (rest.includes("--force") || rest.includes("--discard-changes") || shortFlag(rest, "f"))
  )
    return message(
      "A forced checkout or switch discards every local change.",
      "Commit or stash the work first. Ask the user first.",
    );
  return undefined;
}

/** Clean, stash and branch forms that delete untracked files, stashes or unmerged branches. */
function deleteReason(operation: string | undefined, rest: string[]): string | undefined {
  if (
    operation === "clean" &&
    (rest.includes("--force") || shortFlag(rest, "f")) &&
    !rest.includes("--dry-run") &&
    !shortFlag(rest, "n")
  )
    return message(
      "git clean -f deletes untracked files permanently.",
      "Preview with git clean -n. Ask the user first.",
    );
  if (operation === "stash" && ["drop", "clear"].includes(rest[0] ?? ""))
    return message(
      "git stash drop/clear destroys stashed work.",
      "Other sessions may have work in the stash. Ask the user first.",
    );
  if (operation === "branch" && shortFlag(rest, "D"))
    return message(
      "git branch -D deletes a branch even when its commits are merged nowhere.",
      "Use git branch -d, which refuses unmerged work. Ask the user first.",
    );
  return undefined;
}

/** --force-with-lease and --force-if-includes refuse to overwrite work the pusher hasn't seen. */
function forcePush(arg: string): boolean {
  return arg === "--force" || /^-[^-]*f/.test(arg) || (arg.startsWith("+") && arg.length > 1);
}

/** --mirror, --delete/-d and a :<ref> refspec delete remote branches. */
function deletingPush(arg: string): boolean {
  return (
    arg === "--mirror" ||
    arg === "--delete" ||
    /^-[^-]*d/.test(arg) ||
    (arg.startsWith(":") && arg.length > 1)
  );
}

function historyReason(operation: string | undefined, rest: string[]): string | undefined {
  if (operation === "push" && rest.some(deletingPush))
    return "This push deletes or overwrites remote branches. Ask the user first.";
  if (
    (operation === "push" && rest.some(forcePush)) ||
    ["filter-branch", "filter-repo"].includes(operation ?? "") ||
    (operation === "rebase" &&
      !rest.some((arg) => ["--abort", "--continue", "--skip", "--quit"].includes(arg))) ||
    (operation === "reflog" && ["expire", "delete"].includes(rest[0] ?? ""))
  )
    return message(
      "Rewriting Git history can destroy shared work. Ask the user first.",
      "If a force push is needed, --force-with-lease refuses to overwrite work you haven't fetched.",
    );
  return undefined;
}

function git(args: string[], cwd: string) {
  return spawnSync("git", args, { cwd, encoding: "utf8", timeout: 2000 });
}

/** True when every ref named resolves to HEAD's own commit, so the reset moves nothing. */
function targetsHead(refs: string[], global: string[], cwd: string): boolean {
  const revision = (ref: string) => {
    const result = git([...global, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd);
    return result.status === 0 ? result.stdout.trim() : undefined;
  };
  const head = revision("HEAD");
  return head !== undefined && refs.every((ref) => revision(ref) === head);
}

function resetReason(
  cmd: Command,
  options: { cwd: string; global: string[]; rest: string[] },
): string | undefined {
  if (cmd.remote || cmd.dir === null || cmd.env.some((value) => value.startsWith("GIT_")))
    return "Cannot inspect this repository before a hard reset. Ask the user first.";
  const cwd = resolve(options.cwd, cmd.dir ?? ".");
  const refs = options.rest.filter((arg) => !arg.startsWith("-"));
  if (!targetsHead(refs, options.global, cwd))
    return message(
      "A hard reset to another commit drops this branch's commits beyond it; only the reflog can recover them.",
      "Ask the user first.",
    );
  const status = git(
    [...options.global, "-c", "core.fsmonitor=false", "status", "--porcelain"],
    cwd,
  );
  if (status.status !== 0 || status.stdout.trim())
    return "A hard reset could discard uncommitted work. Commit or stash it, or ask the user first.";
  return undefined;
}

export function gitReason(cmd: Command, cwd: string): string | undefined {
  const { global, operation, rest } = gitArgs(cmd.argv.slice(1));
  if (
    (operation === "commit" && commitSkipsHooks(rest)) ||
    (operation === "push" && rest.includes("--no-verify"))
  )
    return message(
      "--no-verify skips the project's git hooks.",
      "Fix what the hook reports instead. Ask the user first.",
    );
  const reason =
    worktreeReason(operation, rest) ??
    deleteReason(operation, rest) ??
    historyReason(operation, rest);
  if (reason) return reason;
  if (operation === "reset" && rest.some((arg) => arg === "--hard" || arg.startsWith("--hard=")))
    return resetReason(cmd, { cwd, global, rest });
  return undefined;
}
