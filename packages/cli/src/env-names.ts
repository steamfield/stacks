import { AgentId } from "@steamfield/stacks-format";
import { Schema } from "effect";

/**
 * One agent session marker: the environment variable `name`, set and non-empty (and equal to
 * `equals` when given), means `agent`; `"by-value"` reads the agent from the value itself.
 * `confirmed` is the date the marker was last checked against the agent's documentation; no
 * marker has been checked yet, so none carries it.
 */
const AgentMarker = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9_]*$/, { expected: "a variable name" })),
  agent: Schema.Union([AgentId, Schema.Literal("by-value")]),
  equals: Schema.optionalKey(Schema.String),
  confirmed: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/, { expected: "a date" })),
  ),
});
type AgentMarker = typeof AgentMarker.Type;
const marker = (name: string, agent: AgentMarker["agent"], equals?: string) => ({
  name,
  agent,
  ...(equals === undefined ? {} : { equals }),
});
/**
 * Agent detection's markers, checked in order; the first match wins. `AI_AGENT` is the
 * cross-agent convention: its value is matched by prefix against the known ids, and any other
 * non-empty value is `"other"`. Cursor's trace id variable isn't here because its integrated
 * terminal sets it for people too.
 */
export const AgentMarkers: ReadonlyArray<AgentMarker> = Schema.decodeUnknownSync(
  Schema.Array(AgentMarker),
)([
  marker("CLAUDECODE", "claude"),
  marker("CLAUDE_CODE", "claude"),
  marker("CODEX_SANDBOX", "codex"),
  marker("CODEX_CI", "codex"),
  marker("CODEX_THREAD_ID", "codex"),
  marker("OPENCODE", "opencode"),
  marker("OPENCODE_CLIENT", "opencode"),
  marker("CURSOR_AGENT", "cursor"),
  marker("CURSOR_EXTENSION_HOST_ROLE", "cursor", "agent-exec"),
  marker("AI_AGENT", "by-value"),
]);
/**
 * Every marker variable, once each: `childEnv`'s `remove` list for a verify step, so a project's
 * own tools don't think they run under an agent.
 */
export const AGENT_MARKER_NAMES: ReadonlyArray<string> = [
  ...new Set(AgentMarkers.map((item) => item.name)),
];
/** CLI settings, shared by their readers and verify's child-environment removal list. */
export const CLI_ENV = {
  logLevel: "LOG_LEVEL",
  dataDir: "STACKS_DATA_DIR",
  stateDir: "STACKS_STATE_DIR",
  registryDir: "STACKS_REGISTRY_DIR",
  logFormat: "STACKS_LOG_FORMAT",
  logFile: "STACKS_LOG_FILE",
  offline: "STACKS_OFFLINE",
  telemetryDisabled: "STACKS_TELEMETRY_DISABLED",
  telemetryDebug: "STACKS_TELEMETRY_DEBUG",
  telemetryUrl: "STACKS_TELEMETRY_URL",
  indexUrl: "STACKS_INDEX_URL",
  devApiUrl: "STACKS_DEV_API_URL",
} as const;
/**
 * The settings verify removes from a step's environment. `LOG_LEVEL` stays: projects read the same
 * name for their own logging, and a person running `LOG_LEVEL=debug stacks verify` means it for them.
 */
export const CLI_SETTING_NAMES: ReadonlyArray<string> = Object.values(CLI_ENV).filter(
  (name) => name !== CLI_ENV.logLevel,
);
/**
 * The variables that point git at a repository, work tree, index or object store instead of
 * letting it discover one from its working directory: `childEnv`'s `remove` list for the CLI's
 * own git calls. A git hook or alias exports `GIT_DIR` (and a pre-commit hook `GIT_INDEX_FILE`),
 * so `new` run from one would otherwise inspect or initialize the caller's repository. The
 * discovery limits (`GIT_CEILING_DIRECTORIES`, `GIT_DISCOVERY_ACROSS_FILESYSTEM`) select nothing
 * and stay, as do settings such as `GIT_CONFIG_GLOBAL`.
 */
export const GIT_REPOSITORY_VARIABLES: ReadonlyArray<string> = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_QUARANTINE_PATH",
];
