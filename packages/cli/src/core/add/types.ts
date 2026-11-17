/** Owns the shared add options so the add modules can depend on them without a cycle. */
import type { AgentId } from "@steamfield/stacks-format";
import type { HandoffDecision } from "../handoff";

/** What the `add` command asks for; `handoff` decides the handoff once untrusted ids are known. */
export type AddOptions = {
  root: string;
  fragments: ReadonlyArray<string>;
  agents: ReadonlyArray<AgentId> | undefined;
  sandbox: boolean;
  yes: boolean;
  handoff: (untrusted: ReadonlyArray<string>) => HandoffDecision;
};
