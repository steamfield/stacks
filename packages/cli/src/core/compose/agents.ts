/** Selects the agents whose adapter files ship with a project. */
import type { AgentId } from "@steamfield/stacks-format";
import type { Settings } from "../../schemas/config";

/**
 * The agents a composition ships adapters for: `new --agents` when given, else `Settings.agents`
 * when set and non-empty, else Claude Code. The agent running the CLI, if one is detected, doesn't
 * change the set. Duplicates are dropped, keeping the first.
 */
export function targetAgents(
  flag: ReadonlyArray<AgentId> | undefined,
  settings: Pick<Settings, "agents">,
): ReadonlyArray<AgentId> {
  return [...new Set(preferredAgents(flag, settings))];
}

function preferredAgents(
  flag: ReadonlyArray<AgentId> | undefined,
  settings: Pick<Settings, "agents">,
): ReadonlyArray<AgentId> {
  if (flag?.length) return flag;
  if (settings.agents?.length) return settings.agents;
  return ["claude"];
}
