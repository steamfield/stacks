/**
 * The options `stacks add` passes into `core/add.ts` and on to every step in `core/add/`. Kept in
 * its own file so the modules here can share it without importing each other in a cycle.
 */
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
