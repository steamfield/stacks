/** Decides launch eligibility and the recorded handoff (trust points 3 and 4). */
import type { AgentId, DetectedAgent, Harness, Manifest } from "@steamfield/stacks-format";
import { LAUNCH_ARGS, LAUNCH_ORDER } from "./launchers";

/** Why `new` printed the prompt instead of launching an agent. */
type PrintReason =
  | "json"
  | "no-launch"
  | "not-a-terminal"
  | "untrusted"
  | "no-agent-found"
  | "agent-not-found"
  | "not-chosen";

export type HandoffDecision =
  | {
      kind: "inside-agent";
      agent: Exclude<DetectedAgent, "none">;
      untrusted: ReadonlyArray<string>;
    }
  | LaunchDecision
  | { kind: "choose"; options: ReadonlyArray<LaunchDecision>; untrusted: ReadonlyArray<string> }
  | { kind: "print"; reason: PrintReason; agent?: Harness; untrusted: ReadonlyArray<string> };

type LaunchDecision =
  | { kind: "launch"; agent: Harness; via: "terminal"; bin: string; args: ReadonlyArray<string> }
  | { kind: "launch"; agent: Harness; via: "app" };

/**
 * The one constructor used by automatic selection and the picker. `bin` is the path
 * `Processes.which` found; an app launcher doesn't use it.
 */
export function launchDecision(agent: Harness, bin: string, prompt: string): LaunchDecision {
  const launcher = LAUNCH_ARGS[agent];
  return launcher.via === "app"
    ? { kind: "launch", agent, via: "app" }
    : { kind: "launch", agent, via: "terminal", bin, args: launcher.args(prompt) };
}

export type HandoffInput = {
  dryRun?: boolean;
  /** `AppConfig.agent`. */
  detected: DetectedAgent;
  json: boolean;
  /** False with `--no-launch`. */
  launch: boolean;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  /** Ids of the composed entries with `trusted: false`. */
  untrusted: ReadonlyArray<string>;
  /** `--launch`. */
  preferred?: Harness;
  /** `Settings.agents`, in the user's order. */
  configured: ReadonlyArray<AgentId>;
  /** Each agent's binary that `Processes.which` found, by agent. */
  found: ReadonlyMap<Harness, string>;
  /** `agentPrompt(Host.invocation)`. */
  prompt: string;
};

export type HandoffPreferences = Omit<HandoffInput, "untrusted" | "dryRun">;
export type SettledHandoff = Exclude<HandoffDecision, { kind: "choose" }>;

/** The agents to try, in order: `--launch` alone, else the configured ones, then the rest. */
export const candidates = (preferred: Harness | undefined, configured: ReadonlyArray<AgentId>) =>
  preferred ? [preferred] : [...new Set([...configured, ...LAUNCH_ORDER])];

/**
 * Previews always print a plan. Otherwise, the first matching rule wins. Each rule
 * outranks every rule below it. An untrusted entry stops at rule 5 at the latest, so it never
 * reaches `launch` or `choose` (trust point 3), and nothing launches or asks without a person at
 * a terminal on both stdin and stdout (trust point 4).
 */
export function decideHandoff(input: HandoffInput): HandoffDecision {
  const { untrusted } = input;
  if (input.dryRun) return printDecision("no-launch", untrusted);
  // 1. Already running under an agent: tell that agent what to do instead of starting another.
  if (input.detected !== "none") return { kind: "inside-agent", agent: input.detected, untrusted };
  // 2. `--json` callers read the result; nothing is launched for them.
  if (input.json) return printDecision("json", untrusted);
  // 3. `--no-launch` asks for the prompt only.
  if (!input.launch) return printDecision("no-launch", untrusted);
  // 4. Terminal eligibility.
  if (!input.stdinIsTTY || !input.stdoutIsTTY) return printDecision("not-a-terminal", untrusted);
  // 5. Require review of untrusted entries.
  if (untrusted.length > 0) return printDecision("untrusted", untrusted);
  // 6. Everything is trusted and a person is at the terminal: pick an installed agent.
  return pickInstalledAgent(input);
}

/**
 * Rule 6 of `decideHandoff`: `--launch` if it's installed; else the first configured agent that
 * is; else the only installed agent, or a choice between several.
 */
function pickInstalledAgent(input: HandoffInput): HandoffDecision {
  const { untrusted, found, prompt } = input;
  if (input.preferred) {
    const bin = found.get(input.preferred);
    return bin
      ? launchDecision(input.preferred, bin, prompt)
      : printDecision("agent-not-found", untrusted, input.preferred);
  }
  for (const agent of input.configured) {
    const bin = found.get(agent);
    if (bin) return launchDecision(agent, bin, prompt);
  }
  const options = LAUNCH_ORDER.flatMap((agent) => {
    const bin = found.get(agent);
    return bin ? [launchDecision(agent, bin, prompt)] : [];
  });
  const first = options[0];
  if (!first) return printDecision("no-agent-found", untrusted);
  if (options.length > 1) return { kind: "choose", options, untrusted };
  return first;
}

function printDecision(
  reason: PrintReason,
  untrusted: ReadonlyArray<string>,
  agent?: Harness,
): HandoffDecision {
  return { kind: "print", reason, ...(agent ? { agent } : {}), untrusted };
}

/**
 * The agent the manifest records for a harness: the Codex app counts as `codex`, and Copilot,
 * which has no `AgentId`, as `other`.
 */
function recordedAgent(agent: Harness | "other"): AgentId | "other" {
  if (agent === "codex-app") return "codex";
  if (agent === "copilot") return "other";
  return agent;
}

/**
 * Handoff is outside the step digest (trust point 5). A pending choice is recorded as `print`
 * with no agent until the picker settles it.
 */
export const settleHandoff = (
  manifest: Manifest,
  decision: HandoffDecision,
  at: string,
): Manifest => ({
  ...manifest,
  handoff: {
    kind: decision.kind === "choose" ? "print" : decision.kind,
    ...(decision.kind === "print" || decision.kind === "choose"
      ? {}
      : { agent: recordedAgent(decision.agent) }),
    at,
  },
});
