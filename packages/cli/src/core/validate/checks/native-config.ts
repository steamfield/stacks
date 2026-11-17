/**
 * Decodes command-bearing fields in native agent configs for static inspection (trust point 1).
 * Open schemas allow future settings and events, while case errors in known keys would make agents
 * silently ignore them. Source contributions can be partial because the merged file is decoded
 * separately.
 */
import { Result, Schema } from "effect";
import { parse as parseToml } from "smol-toml";
import { shellWords } from "../../shell";

export type NativeCommand = { words: readonly string[]; permission: boolean };

const isMiscased = (known: readonly string[], key: string) =>
  known.some((expected) => expected !== key && expected.toLowerCase() === key.toLowerCase());

const record = Schema.Record(Schema.String, Schema.Unknown);

/** Reject misspellings of known keys without closing unrelated agent settings. */
function referenceStruct<const Fields extends Schema.Struct.Fields>(fields: Fields) {
  const keys = Object.keys(fields);
  return record
    .check(
      Schema.makeFilter(
        (value) =>
          Object.keys(value).every((key) => !isMiscased(keys, key)) ||
          "wrong-case reference config key",
      ),
    )
    .pipe(Schema.decodeTo(Schema.Struct(fields)));
}

/** Reject a known event spelled in the wrong case; an event the CLI doesn't know yet passes. */
function eventRecord<Value extends Schema.Constraint>(events: readonly string[], value: Value) {
  return Schema.Record(Schema.String, value).check(
    Schema.makeFilter(
      (hooks) =>
        Object.keys(hooks).every((event) => !isMiscased(events, event)) || "wrong-case hook event",
    ),
  );
}

const codexEvents = [
  "SessionStart",
  "SessionEnd",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "UserPromptSubmit",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "Interrupt",
  "PreCompact",
  "PostCompact",
];
const cursorEvents = [
  "sessionStart",
  "sessionEnd",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "subagentStart",
  "subagentStop",
  "beforeShellExecution",
  "afterShellExecution",
  "beforeMCPExecution",
  "afterMCPExecution",
  "beforeReadFile",
  "afterFileEdit",
  "beforeSubmitPrompt",
  "preCompact",
  "stop",
  "afterAgentResponse",
  "afterAgentThought",
  "beforeTabFileRead",
  "afterTabFileEdit",
  "workspaceOpen",
];

const commandHook = referenceStruct({
  type: Schema.Literal("command"),
  command: Schema.String,
  timeout: Schema.optionalKey(Schema.Number),
  statusMessage: Schema.optionalKey(Schema.String),
  async: Schema.optionalKey(Schema.Boolean),
});
const hookGroup = referenceStruct({
  matcher: Schema.optionalKey(Schema.String),
  hooks: Schema.Array(commandHook),
});
const codexHooks = referenceStruct({
  hooks: eventRecord(codexEvents, Schema.Array(hookGroup)),
});
const cursorHook = referenceStruct({
  command: Schema.String,
  matcher: Schema.optionalKey(Schema.String),
  timeout: Schema.optionalKey(Schema.Number),
  loop_limit: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});
const cursorHookMap = eventRecord(cursorEvents, Schema.Array(cursorHook));
const cursorHooks = referenceStruct({ version: Schema.Literal(1), hooks: cursorHookMap });
// Merge contributors may supply hooks while another owner supplies the version.
const cursorContribution = referenceStruct({ hooks: cursorHookMap });
const action = Schema.Literals(["allow", "ask", "deny"]);
const permissionRule = Schema.Union([action, Schema.Record(Schema.String, action)]);
const openCodeConfig = referenceStruct({
  formatter: Schema.optionalKey(
    Schema.Union([
      Schema.Literal(false),
      Schema.Record(
        Schema.String,
        referenceStruct({
          command: Schema.optionalKey(Schema.Array(Schema.String)),
          extensions: Schema.optionalKey(Schema.Array(Schema.String)),
          disabled: Schema.optionalKey(Schema.Boolean),
          environment: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
        }),
      ),
    ]),
  ),
  permission: Schema.optionalKey(
    Schema.Union([
      action,
      Schema.Record(Schema.String, permissionRule).check(
        Schema.makeFilter(
          (rules) =>
            Object.keys(rules).every((key) => !isMiscased(["bash"], key)) ||
            "wrong-case bash permission key",
        ),
      ),
    ]),
  ),
});

/** Top-level keys that carry references; one in the wrong case fails the whole file. */
const ROOT_KEYS = ["hooks", "formatter", "permission", "version"];

const NATIVE_CONFIGS = [
  ".codex/hooks.json",
  ".codex/config.toml",
  ".cursor/hooks.json",
  "opencode.json",
  "opencode.jsonc",
];

export function isNativeConfig(path: string): boolean {
  return NATIVE_CONFIGS.includes(path);
}

/** Parses a native config's text by its format; throws on a syntax error. */
export function parseNativeConfig(path: string, text: string): unknown {
  if (path === ".codex/config.toml") return parseToml(text);
  return path.startsWith("opencode.") ? parseJsonc(text) : JSON.parse(text);
}

/** Strip only JSONC comments and trailing commas; JSON.parse still owns JSON syntax. */
function parseJsonc(text: string): unknown {
  const stringsOrComments = /"(?:[^"\\]|\\.)*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g;
  const uncommented = text.replace(stringsOrComments, (token) =>
    token.startsWith("/") ? token.replace(/[^\r\n]/g, " ") : token,
  );
  return JSON.parse(
    uncommented.replace(/"(?:[^"\\]|\\.)*"|,(?=\s*[}\]])/g, (token) =>
      token === "," ? " " : token,
    ),
  );
}

export function decodedNativeCommands(path: string, value: unknown) {
  return Result.try(() => nativeCommands(path, value));
}

/** Contributors need only supply their part of a valid composed config. */
export function decodedNativeSourceCommands(path: string, value: unknown) {
  if (path !== ".cursor/hooks.json") return decodedNativeCommands(path, value);
  return Result.try(() =>
    cursorCommands(Schema.decodeUnknownSync(cursorContribution)(value).hooks),
  );
}

/**
 * Decode the reference-bearing subset, permitting unrelated agent settings to evolve. Throws on a
 * structure that doesn't decode; only the `Result.try` wrappers above call it.
 */
function nativeCommands(path: string, value: unknown): NativeCommand[] {
  const root = Schema.decodeUnknownSync(record)(value);
  if (Object.keys(root).some((key) => isMiscased(ROOT_KEYS, key)))
    throw new Error("Wrong-case reference config key");
  if (path.startsWith("opencode.")) return openCodeCommands(value);
  // A policy-only Codex TOML file has no hooks to check.
  if (path === ".codex/config.toml" && !Object.hasOwn(root, "hooks")) return [];
  if (path === ".cursor/hooks.json")
    return cursorCommands(Schema.decodeUnknownSync(cursorHooks)(value).hooks);
  const config = Schema.decodeUnknownSync(codexHooks)(value);
  return Object.values(config.hooks).flatMap((groups) =>
    groups.flatMap((group) => group.hooks.map((hook) => shellCommand(hook.command))),
  );
}

function cursorCommands(hooks: typeof cursorHookMap.Type): NativeCommand[] {
  return Object.values(hooks).flatMap((group) => group.map((hook) => shellCommand(hook.command)));
}

/** OpenCode's formatter commands (already argv arrays), then its `bash` permission rules. */
function openCodeCommands(value: unknown): NativeCommand[] {
  const config = Schema.decodeUnknownSync(openCodeConfig)(value);
  const formatters = config.formatter ? Object.values(config.formatter) : [];
  const commands = formatters.flatMap((formatter) =>
    formatter.command ? [unwrapShell(formatter.command)] : [],
  );
  const bash = typeof config.permission === "object" ? config.permission.bash : undefined;
  if (typeof bash === "object")
    for (const rule of Object.keys(bash))
      commands.push({ words: shellWords(rule), permission: true });
  return commands;
}

function shellCommand(command: string): NativeCommand {
  return unwrapShell(shellWords(command));
}

/** `sh -c '<script>'` and `bash -c '<script>'` stand for the script they run. */
function unwrapShell(words: readonly string[]): NativeCommand {
  if ((words[0] === "sh" || words[0] === "bash") && words[1] === "-c")
    return shellCommand(words[2] ?? "");
  return { words, permission: false };
}
