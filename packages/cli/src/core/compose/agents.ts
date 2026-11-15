/**
 * Picks which coding agents a new project ships adapter files for.
 *
 * An adapter is the set of files an entry ships for one agent under `adapters/<agent>/`, such as
 * Claude Code's `.claude/` settings or Codex's `.codex/` hooks. `stacks new`, `stacks add` and the
 * previews in `show` and `validate`
 * call `targetAgents` and pass the result to `compose.ts::compose` as `ComposeOptions.agents`;
 * `plan-files.ts` then keeps only the adapters for those agents.
 */
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
