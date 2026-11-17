/** Owns the shared add options so the add modules can depend on them without a cycle. */
import type { AgentId } from "@steamfield/stacks-format";
import type { HandoffPreferences } from "../handoff/decide";

export type AddOptions = {
  root: string;
  fragments: ReadonlyArray<string>;
  agents: ReadonlyArray<AgentId> | undefined;
  sandbox: boolean;
  yes: boolean;
  handoff: HandoffPreferences;
};
