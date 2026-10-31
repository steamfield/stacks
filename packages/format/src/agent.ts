import { Schema } from "effect";

/** The agents an entry can ship adapters for (`adapters/<AgentId>/`), and `--agents` names. */
export const AgentId = Schema.Literals(["claude", "codex", "opencode", "cursor"]);
export type AgentId = typeof AgentId.Type;

/** Launch targets: every `AgentId` plus `copilot` and `codex-app`. Adapter ids stay unchanged. */
export const Harness = Schema.Literals([...AgentId.literals, "copilot", "codex-app"]);
export type Harness = typeof Harness.Type;
/**
 * The agent the CLI runs under: a known `AgentId`, `"other"` for a generic agent marker that
 * names no known agent, or `"none"`. Declared here so every reader imports one schema.
 */
export const DetectedAgent = Schema.Literals([...AgentId.literals, "other", "none"]);
export type DetectedAgent = typeof DetectedAgent.Type;
