/**
 * Checks the commands in one composed agent config file (Codex, Cursor or OpenCode) during
 * `stacks validate`.
 *
 * A hook or formatter command that calls a project command (`bun run lint`) should name one the
 * composition declares in its commands table, and one that runs a script (`.codex/hooks/x.sh`,
 * `bash scripts/fmt.sh`) should name a file the composition ships; otherwise the agent's hook
 * breaks in the new project (`ref-command`, `ref-hook`). A file that doesn't parse gets one
 * `ref-toml` or `ref-json` error and a file whose structure doesn't decode one `ref-config` error,
 * and its references are skipped. Commands are only read, never run (trust point 1).
 *
 * `shipped-refs.ts` calls `nativeReferences` for each rendered config file; `native-config.ts`
 * parses the formats. Each issue carries `matches`, which `shipped-refs.ts` uses to find which
 * entry's copy of a merged file holds the command.
 */
import { Result } from "effect";
import { runnerTarget } from "./commands";
import {
  decodedNativeCommands,
  decodedNativeSourceCommands,
  type NativeCommand,
  parseNativeConfig,
} from "./native-config";
import type { ReferenceIssue } from "./reference-issue";

/** What the composition provides: the paths it ships and whether it declares a command. */
type Provided = { paths: ReadonlySet<string>; declared: (target: string) => boolean };

const SCRIPT_RUNTIMES = ["sh", "bash", "zsh", "node", "python", "python3", "bun"];

export function nativeReferences(path: string, text: string, context: Provided): ReferenceIssue[] {
  const parsed = Result.try(() => parseNativeConfig(path, text));
  if (Result.isFailure(parsed))
    return [invalid(path.endsWith(".toml") ? "ref-toml" : "ref-json", "syntax")];
  const decoded = decodedNativeCommands(path, parsed.success);
  if (Result.isFailure(decoded)) return [invalid("ref-config", "structure")];
  return decoded.success.flatMap((command) => commandReferences(path, command, context));
}

function invalid(check: string, kind: string): ReferenceIssue {
  return {
    check,
    severity: "error",
    needle: "",
    message: `invalid config ${kind}; references were skipped`,
  };
}

/** An undeclared project command, then a missing script, for one command of the config. */
function commandReferences(
  path: string,
  command: NativeCommand,
  { paths, declared }: Provided,
): ReferenceIssue[] {
  const issues: ReferenceIssue[] = [];
  const matches = (value: unknown) => sourceHasCommand(path, value, command);
  const target = runnerTarget(quoteWords(command.words));
  const script = scriptOperand(command.words);
  if (target && !script && !/[*?]/.test(target) && !declared(target))
    issues.push({
      check: "ref-command",
      severity: "error",
      needle: target,
      message: `config runs ${target}, which no composed entry declares in commands`,
      matches,
    });
  if (command.permission || !script) return issues;
  const file = projectRelative(script);
  if (!/^[-/$~]/.test(file) && !/[:*?]/.test(file) && !paths.has(file))
    issues.push({
      check: "ref-hook",
      severity: "error",
      needle: script,
      message: `hook references ${file}, which no composed entry ships`,
      matches,
    });
  return issues;
}

/** Re-quotes argv for `runnerTarget`, keeping word boundaries such as paths with spaces. */
const quoteWords = (words: readonly string[]) =>
  words.map((word) => `'${word.replaceAll("'", `'\\''`)}'`).join(" ");

/** A script path with the agent's project-directory variable or a leading `./` removed. */
const projectRelative = (script: string) =>
  script.replace(/^\$\{?(?:CODEX_PROJECT_DIR|CURSOR_PROJECT_DIR)\}?\//, "").replace(/^\.\//, "");

/** Whether one entry's copy of the config holds the same command, of the same kind. */
function sourceHasCommand(path: string, value: unknown, command: NativeCommand): boolean {
  const source = decodedNativeSourceCommands(path, value);
  return (
    Result.isSuccess(source) &&
    source.success.some(
      (item) =>
        item.permission === command.permission &&
        JSON.stringify(item.words) === JSON.stringify(command.words),
    )
  );
}

/** Only the executable or its interpreter's script is a shipped-file operand. */
function scriptOperand(words: readonly string[]): string | undefined {
  const executable = words[0];
  if (!executable) return undefined;
  const runtime = executable.slice(executable.lastIndexOf("/") + 1);
  if (!SCRIPT_RUNTIMES.includes(runtime)) return executable.includes("/") ? executable : undefined;
  const bunRun = runtime === "bun" && words[1] === "run";
  const script = words[bunRun ? 2 : 1];
  if (!script || /^[-;&|()<>]/.test(script)) return undefined;
  // bun run <name> is a command-table reference unless its operand is a path.
  return bunRun && !script.includes("/") ? undefined : script;
}
