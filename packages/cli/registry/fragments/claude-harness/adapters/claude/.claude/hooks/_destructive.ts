import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { projectRoot } from "./_lib";
import type { Command } from "./_shell";

const message = (reason: string, suggestion: string) => `${reason}\n\n${suggestion}`;
const shortFlag = (args: string[], flag: string) =>
  args.some((arg) => arg.startsWith("-") && !arg.startsWith("--") && arg.includes(flag));
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const DB_CLIENTS = new Set([
  "psql",
  "pgcli",
  "mysql",
  "mariadb",
  "mycli",
  "sqlite3",
  "litecli",
  "sqlcmd",
  "duckdb",
  "clickhouse",
  "clickhouse-client",
  "cockroach",
  "snowsql",
]);
const DISK = /^\/dev\/(sd|nvme|hd|r?disk|mapper|vd|xvd)/;

function diskReason(cmd: Command): string | undefined {
  const [program = "", ...args] = cmd.argv;
  const name = basename(program);
  if (cmd.redirects.some((target) => DISK.test(target)))
    return message(
      "Redirecting output to a raw disk device destroys it.",
      "Do not run without explicit confirmation.",
    );
  if (name === "dd" && args.some((arg) => arg.startsWith("of=") && DISK.test(arg.slice(3))))
    return message(
      "dd writing to a raw disk device destroys it.",
      "Confirm the of= target. Ask the user first.",
    );
  if (/^mkfs(?:\.|$)/.test(name))
    return message("mkfs reformats a device.", "Do not run without explicit confirmation.");
  return undefined;
}

/** Root/home spellings are special even when rm was not given a recursive flag. */
function protectedTarget(cmd: Command, index: number): boolean {
  const word = cmd.argv[index] ?? "";
  if (/[$~*]/.test(word) && !cmd.expands[index]) return false;
  return /^(?:\/\*?|(?:~|\$HOME|\$\{HOME\}|\$PWD|\$\{PWD\}|\.\.?)(?:\/\*?)?)$/.test(word);
}

function removalReason(cmd: Command): string | undefined {
  const args = cmd.argv.slice(1);
  if (cmd.viaXargs && (shortFlag(args, "r") || shortFlag(args, "R") || shortFlag(args, "f")))
    return message(
      "Recursive or forced rm fed by xargs.",
      "Review the pipeline. Ask the user first.",
    );
  for (let index = 1; index < cmd.argv.length; index++) {
    if (protectedTarget(cmd, index))
      return message(
        "rm targeting the filesystem root, home, or the working directory.",
        "Name the exact paths to remove. Ask the user first.",
      );
    if (cmd.argv[index] === "*" && cmd.expands[index])
      return message(
        "rm with a bare wildcard.",
        "Be explicit about which files to remove. Ask the user first.",
      );
  }
  return undefined;
}

function findReason(args: string[]): string | undefined {
  const destructive = args.some(
    (arg, index) =>
      arg === "-delete" ||
      (["-exec", "-execdir", "-ok", "-okdir"].includes(arg) &&
        ["rm", "unlink", "shred"].includes(basename(args[index + 1] ?? ""))),
  );
  if (destructive)
    return message(
      "find with -delete or -exec rm deletes every matched file.",
      "Review the find expression and its root path. Ask the user first.",
    );
  return undefined;
}

function chownTarget(cmd: Command, index: number): boolean {
  return protectedTarget(cmd, index) && /^(?:\/|~|\$HOME|\$\{HOME\})/.test(cmd.argv[index] ?? "");
}

function filesystemReason(cmd: Command): string | undefined {
  const [program = "", ...args] = cmd.argv;
  const name = basename(program);
  if (name === "rm") return removalReason(cmd);
  if (name === "find") return findReason(args);
  if (name === "chmod" && /^0?777$/.test(args.find((arg) => !arg.startsWith("-")) ?? ""))
    return message(
      "chmod 777 makes files world-writable.",
      "Use 755 for directories and 644 for files.",
    );
  if (
    name === "chown" &&
    (shortFlag(args, "R") || args.includes("--recursive")) &&
    args.some((_, index) => chownTarget(cmd, index + 1))
  )
    return message(
      "Recursive chown of the filesystem root or home.",
      "Name the exact directory. Ask the user first.",
    );
  return diskReason(cmd);
}

function databaseReason(cmd: Command): string | undefined {
  if (!DB_CLIENTS.has(basename(cmd.argv[0] ?? ""))) return undefined;
  const sql = [...cmd.argv.slice(1), ...cmd.stdin].join("\n");
  if (/\b(?:drop\s+(?:table|database|schema)|truncate\s+(?:table\s+)?[\w".]+)/i.test(sql))
    return message("DROP or TRUNCATE causes irreversible data loss.", "Ask the user first.");
  if (sql.split(";").some((statement) => /\bdelete\s+from\s+\S+\s*$/i.test(statement)))
    return message(
      "DELETE without a WHERE clause empties the table.",
      "Add a WHERE clause, or ask the user first.",
    );
  return undefined;
}

function executionReason(cmd: Command): string | undefined {
  const [program = "", ...args] = cmd.argv;
  const name = basename(program);
  if (name === "sudo")
    return message(
      "sudo runs the command as root.",
      "Ask the user to run it themselves if it is needed.",
    );
  if (SHELLS.has(name) && cmd.inputPrograms?.some((input) => ["curl", "wget"].includes(input)))
    return message(
      "Piping a download into a shell runs code nobody has read.",
      "Download the script, show it to the user, and ask before running it.",
    );
  if (
    cmd.background &&
    cmd.functionName &&
    cmd.inputPrograms?.length &&
    (name === cmd.functionName || cmd.inputPrograms.includes(cmd.functionName))
  )
    return message("A fork bomb exhausts the machine's processes.", "Do not run it.");
  if (
    name === "killall" ||
    (name === "pkill" && args.includes("-9")) ||
    (name === "kill" && args.includes("-9") && args.includes("-1"))
  )
    return message("Broad process killing.", "Kill a specific PID, or ask the user.");
  return undefined;
}

function dockerReason(args: string[]): string | undefined {
  let index = 0;
  while (args[index]?.startsWith("-")) {
    index += ["--context", "-c", "--host", "-H", "--config", "--log-level", "-l"].includes(
      args[index] ?? "",
    )
      ? 2
      : 1;
  }
  const [operation, sub, ...rest] = args.slice(index);
  const removes =
    ((operation === "system" || operation === "image") && sub === "prune") ||
    (operation === "volume" && ["rm", "prune"].includes(sub ?? "")) ||
    operation === "rmi";
  if (
    removes ||
    (operation === "compose" &&
      sub === "down" &&
      (shortFlag(rest, "v") || rest.includes("--volumes")))
  )
    return message(
      "This deletes Docker images or volumes (including database data).",
      "The Docker context may not be local. Ask the user first.",
    );
  return undefined;
}

function releaseReason(cmd: Command): string | undefined {
  const [program = "", sub, ...rest] = cmd.argv;
  const name = basename(program);
  if (name === "docker") return dockerReason(cmd.argv.slice(1));
  if (name === "gh" && ["repo", "release"].includes(sub ?? "") && rest[0] === "delete")
    return message("gh repo/release delete is unrecoverable.", "Ask the user first.");
  if (cmd.argv.includes("--dry-run") || cmd.argv.includes("--snapshot")) return undefined;
  const publish =
    ["npm", "pnpm", "yarn", "bun", "uv", "cargo", "poetry", "gem"].includes(name) &&
    cmd.argv.slice(1).includes("publish");
  if (
    publish ||
    (name === "twine" && sub === "upload") ||
    (name === "goreleaser" && sub === "release")
  )
    return message(
      "Publishing a release is irreversible.",
      "Releases are user-initiated. Ask the user first.",
    );
  return undefined;
}

function infraReason(cmd: Command): string | undefined {
  const [program = "", ...args] = cmd.argv;
  const name = basename(program);
  const teardown =
    (["terraform", "tofu"].includes(name) &&
      (args.includes("destroy") || (args.includes("apply") && args.includes("-destroy")))) ||
    (name === "pulumi" && args.includes("destroy")) ||
    (name === "kubectl" && args.includes("delete")) ||
    (name === "aws" &&
      args[0] === "s3" &&
      ((args[1] === "rm" && args.includes("--recursive")) ||
        (args[1] === "rb" && args.includes("--force"))));
  if (teardown)
    return message(
      "This tears down infrastructure or deletes cloud data.",
      "Infrastructure changes are user-initiated. Ask the user first.",
    );
  return undefined;
}

const LOCKFILES: readonly [string, string][] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];
const MANAGERS = ["bun", "npm", "pnpm", "yarn"];

/** The package managers owning the project's lockfiles, else its packageManager field, else bun. */
function packageOwners(root: string): string[] {
  const owners = LOCKFILES.filter(([file]) => existsSync(join(root, file))).map(([, pm]) => pm);
  if (owners.length > 0) return owners;
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const field =
      typeof manifest === "object" && manifest !== null && "packageManager" in manifest
        ? String(manifest.packageManager)
        : "";
    const named = field.split("@")[0] ?? "";
    if (MANAGERS.includes(named)) return [named];
  } catch {
    // No readable package.json: fall through to the harness's own runtime.
  }
  return ["bun"];
}

function changesDependencies(name: string, sub: string | undefined): boolean {
  if (name === "yarn" && sub === undefined) return true;
  const subcommands = ["install", "i", "add", "ci", "remove", "uninstall", "rm", "update", "up"];
  if (name === "bun") subcommands.push("a");
  return subcommands.includes(sub ?? "");
}

function packageReason(cmd: Command): string | undefined {
  const [program = "", sub] = cmd.argv;
  const name = basename(program);
  if (!MANAGERS.includes(name) || !changesDependencies(name, sub)) return undefined;
  const owners = packageOwners(projectRoot());
  if (owners.includes(name)) return undefined;
  const owner = owners[0] ?? "bun";
  return `${owner} owns this project's lockfile. Use ${owner} install, ${owner} add, or ${owner} remove.`;
}

/** The shell fallback's command families, inspected only after shell lexing. */
export function destructiveReason(cmd: Command): string | undefined {
  for (const check of [
    filesystemReason,
    databaseReason,
    executionReason,
    releaseReason,
    infraReason,
    packageReason,
  ]) {
    const reason = check(cmd);
    if (reason) return reason;
  }
  return undefined;
}
