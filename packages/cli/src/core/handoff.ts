import type { AgentId, DetectedAgent, Harness } from "@steamfield/stacks-format";
import { BRIEF_PATH } from "../project-layout";
import { type Audience, plainStyle, type Style } from "../services/output";
import { shellArg } from "./shell";
import { printable } from "./text";

/** Why `new` printed the prompt instead of launching an agent. */
type PrintReason =
  | "json"
  | "no-launch"
  | "not-a-terminal"
  | "untrusted"
  | "no-agent-found"
  | "agent-not-found"
  | "not-chosen";

/**
 * What `new` does once the project is written: tell the agent that called it what to do next,
 * launch an agent CLI with the prompt, or print the prompt for the user.
 */
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

type Launcher =
  | {
      via: "terminal";
      label: string;
      bin: string;
      args: (prompt: string) => string[];
      checked?: string;
    }
  | {
      via: "app";
      label: string;
      app: string;
      url: (dir: string, prompt: string) => string;
      checked?: string;
    };

/**
 * How each agent CLI starts an interactive session with a first prompt. `checked` is the date
 * the row was last checked against the agent's documentation; unset until someone has.
 */
export const LAUNCH_ARGS = {
  claude: {
    via: "terminal",
    label: "Claude Code",
    bin: "claude",
    args: (prompt: string) => [prompt],
  },
  codex: { via: "terminal", label: "Codex CLI", bin: "codex", args: (prompt: string) => [prompt] },
  opencode: {
    via: "terminal",
    label: "OpenCode",
    bin: "opencode",
    args: (prompt: string) => ["--prompt", prompt],
  },
  cursor: {
    via: "terminal",
    label: "Cursor CLI",
    bin: "cursor-agent",
    args: (prompt: string) => [prompt],
  },
  copilot: {
    via: "terminal",
    label: "Copilot CLI",
    bin: "copilot",
    args: (prompt: string) => ["-i", prompt],
  },
  "codex-app": {
    via: "app",
    label: "Codex app",
    app: "Codex.app",
    url: (dir: string, prompt: string) =>
      `codex://new?path=${encodeURIComponent(dir)}&prompt=${encodeURIComponent(prompt)}`,
  },
} as const satisfies Readonly<Record<Harness, Launcher>>;

/** Tried after `Settings.agents`, when `--launch` isn't given. */
export const LAUNCH_ORDER: ReadonlyArray<Harness> = [
  "claude",
  "codex",
  "opencode",
  "cursor",
  "copilot",
  "codex-app",
];

/** The one constructor used by automatic selection and the picker. */
export function launchDecision(agent: Harness, bin: string, prompt: string): LaunchDecision {
  const launcher = LAUNCH_ARGS[agent];
  return launcher.via === "app"
    ? { kind: "launch", agent, via: "app" }
    : { kind: "launch", agent, via: "terminal", bin, args: launcher.args(prompt) };
}

export const pickerQuestion = (count: number) => `Hand the project to [1-${count}, Enter for 1]: `;
export const pickerText = (options: ReadonlyArray<Harness>) =>
  `Agents found:\n${options.map((agent, i) => `  ${i + 1}) ${LAUNCH_ARGS[agent].label}`).join("\n")}\n`;

/** The one prompt every outcome gives the agent. No quotes or backticks, so it pastes into a shell. */
export const agentPrompt = (invocation: string) =>
  `Read ${BRIEF_PATH} and carry it out. It's your full task for this project; you're done when ${invocation} verify passes.`;

export type HandoffInput = {
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

/** The agents to try, in order: `--launch` alone, else the configured ones, then the rest. */
export const candidates = (preferred: Harness | undefined, configured: ReadonlyArray<AgentId>) =>
  preferred ? [preferred] : [...new Set([...configured, ...LAUNCH_ORDER])];

/**
 * The handoff, first matching rule wins: a detected agent; `--json`; `--no-launch`; no terminal;
 * an untrusted entry; else an explicit or configured harness, the only harness, or a choice.
 * An untrusted entry never reaches
 * `launch`.
 */
export function decideHandoff(input: HandoffInput): HandoffDecision {
  const { untrusted } = input;
  if (input.detected !== "none") return { kind: "inside-agent", agent: input.detected, untrusted };
  const print = (reason: PrintReason, agent?: Harness): HandoffDecision => ({
    kind: "print",
    reason,
    ...(agent ? { agent } : {}),
    untrusted,
  });
  if (input.json) return print("json");
  if (!input.launch) return print("no-launch");
  if (!input.stdinIsTTY || !input.stdoutIsTTY) return print("not-a-terminal");
  if (untrusted.length) return print("untrusted");
  if (input.preferred) {
    const bin = input.found.get(input.preferred);
    return bin
      ? launchDecision(input.preferred, bin, input.prompt)
      : print("agent-not-found", input.preferred);
  }
  for (const agent of input.configured) {
    const bin = input.found.get(agent);
    if (bin) return launchDecision(agent, bin, input.prompt);
  }
  const options = LAUNCH_ORDER.flatMap((agent) => {
    const bin = input.found.get(agent);
    return bin ? [launchDecision(agent, bin, input.prompt)] : [];
  });
  const first = options[0];
  if (!first) return print("no-agent-found");
  if (options.length > 1) return { kind: "choose", options, untrusted };
  return first;
}

const recordedAgent = (agent: Harness | "other"): AgentId | "other" => {
  if (agent === "codex-app") return "codex";
  return agent === "copilot" ? "other" : agent;
};

/** The manifest's `handoff` record. */
export const handoffRecord = (decision: HandoffDecision, at: string) => ({
  kind: decision.kind === "choose" ? "print" : decision.kind,
  ...(decision.kind === "print" || decision.kind === "choose"
    ? {}
    : { agent: recordedAgent(decision.agent) }),
  at,
});

/** A prompt as a shell argument: double quotes read better when nothing inside expands. */
const quote = (text: string) =>
  /^[A-Za-z0-9._/+-]+$/.test(text) || !/^[^"$`\\!]*$/.test(text) ? shellArg(text) : `"${text}"`;

/**
 * The text after `new`'s summary for an outcome other than `launch`. `shown` is how the summary
 * showed the project (`core/shown-path.ts::shownPath`: relative when under the cwd). A human also
 * gets a ready-to-run example command; an agent has the prompt on the line above it already.
 */
export function renderHandoff(
  decision: Exclude<HandoffDecision, { kind: "launch" | "choose" }>,
  context: {
    shown: string;
    invocation: string;
    audience: Audience;
    agent: AgentId | undefined;
    style?: Style;
  },
): string {
  const ids = decision.untrusted.map(printable).join(", ");
  const where = context.shown === "." ? "the current directory" : printable(context.shown);
  if (decision.kind === "inside-agent")
    return decision.untrusted.length
      ? `STOP: this project uses entries this machine hasn't trusted: ${ids}. Don't start. Show the user the list and ${BRIEF_PATH}'s first section, and continue only if they confirm.`
      : `NEXT STEP FOR THE AGENT: read ${BRIEF_PATH} now and carry it out, working in ${where}. Loop on ${context.invocation} verify until it passes. Don't stop here to report back; the brief says when to ask the user.`;
  const prompt = agentPrompt(context.invocation);
  const requested = LAUNCH_ARGS[decision.agent ?? context.agent ?? "claude"];
  const example = requested.via === "terminal" ? requested : LAUNCH_ARGS[context.agent ?? "claude"];
  const dir = printable(shellArg(context.shown));
  const lines: string[] = [];
  if (decision.reason === "untrusted")
    lines.push(
      `Not launching an agent: this project uses entries this machine hasn't trusted (${ids}; listed above). Read them and the brief's first section before an agent acts on it.`,
    );
  if (decision.reason === "agent-not-found")
    lines.push(
      requested.via === "app"
        ? "The Codex app isn't installed (macOS only)."
        : `${requested.bin} isn't on PATH.`,
    );
  if (decision.reason === "no-agent-found")
    lines.push(
      `No agent CLI found on PATH (looked for ${LAUNCH_ORDER.flatMap((id) => {
        const launcher = LAUNCH_ARGS[id];
        return launcher.via === "terminal" ? [launcher.bin] : [];
      }).join(", ")}).`,
    );
  const { style = plainStyle } = context;
  lines.push(
    style("next", `Next: open ${dir} in your coding agent and give it this prompt:`),
    `  ${prompt}`,
  );
  if (context.audience === "human")
    lines.push(
      `For example: ${context.shown === "." ? "" : `cd ${dir} && `}${[example.bin, ...example.args(prompt).map(quote)].join(" ")}`,
    );
  return lines.join("\n");
}
