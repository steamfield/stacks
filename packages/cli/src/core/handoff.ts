/**
 * Decides agent handoff and renders its prompt. `decideHandoff` owns launch eligibility (trust
 * points 3 and 4), and `LAUNCH_ARGS` owns the fixed launchers (trust point 1).
 */
import type { AgentId, DetectedAgent, Harness } from "@steamfield/stacks-format";
import { BRIEF_PATH } from "../project-layout";
import { type Audience, plainStyle, type Style } from "../services/output";
import { shellArg } from "./text/shell";
import { printable } from "./text/text";

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
 * Fixed agent launchers keep entries from choosing an executable (trust point 1). `checked`
 * records when the launcher was last verified against the agent's documentation and stays unset
 * until that check happens.
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

/** The binaries of every terminal launcher, in launch order, as the no-agent-found line names them. */
const TERMINAL_BINS = LAUNCH_ORDER.flatMap((agent) => {
  const launcher = LAUNCH_ARGS[agent];
  return launcher.via === "terminal" ? [launcher.bin] : [];
});

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

/** The picker's question after `pickerText`'s numbered list of `count` agents. */
export const pickerQuestion = (count: number) => `Hand the project to [1-${count}, Enter for 1]: `;

export const pickerText = (options: ReadonlyArray<Harness>) => {
  const rows = options.map((agent, index) => `  ${index + 1}) ${LAUNCH_ARGS[agent].label}`);
  return `Agents found:\n${rows.join("\n")}\n`;
};

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
 * The handoff, decided by the first rule that matches. The order is the behavior: each rule
 * outranks every rule below it. An untrusted entry stops at rule 5 at the latest, so it never
 * reaches `launch` or `choose` (trust point 3), and nothing launches or asks without a person at
 * a terminal on both stdin and stdout (trust point 4).
 */
export function decideHandoff(input: HandoffInput): HandoffDecision {
  const { untrusted } = input;
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
 * The manifest's `handoff` record. A pending choice is recorded as `print` with no agent until
 * the picker settles it.
 */
export const handoffRecord = (decision: HandoffDecision, at: string) => ({
  kind: decision.kind === "choose" ? "print" : decision.kind,
  ...(decision.kind === "print" || decision.kind === "choose"
    ? {}
    : { agent: recordedAgent(decision.agent) }),
  at,
});

/** Text a POSIX shell takes literally without any quoting. */
const SHELL_SAFE = /^[A-Za-z0-9._/+-]+$/;
/** Characters a POSIX shell still expands or escapes inside double quotes. */
const DOUBLE_QUOTE_SPECIAL = /["$`\\!]/;

/** A prompt as a shell argument: double quotes read better when nothing inside expands. */
function quote(text: string): string {
  if (SHELL_SAFE.test(text) || DOUBLE_QUOTE_SPECIAL.test(text)) return shellArg(text);
  return `"${text}"`;
}

type RenderContext = {
  shown: string;
  invocation: string;
  audience: Audience;
  agent: AgentId | undefined;
  style?: Style;
};

/**
 * Use `shownPath` for the same project path as the summary. Agents already have the prompt,
 * so the ready-to-run example is for people at a terminal.
 */
export function renderHandoff(
  decision: Exclude<HandoffDecision, { kind: "launch" | "choose" }>,
  context: RenderContext,
): string {
  if (decision.kind === "inside-agent") return insideAgentText(decision.untrusted, context);
  return printedText(decision, context);
}

/** The instruction to the calling agent: start on the brief, or stop when an entry is untrusted. */
function insideAgentText(untrusted: ReadonlyArray<string>, context: RenderContext): string {
  if (untrusted.length > 0)
    return `STOP: this project uses entries this machine hasn't trusted: ${untrustedIds(untrusted)}. Don't start. Show the user the list and ${BRIEF_PATH}'s first section, and continue only if they confirm.`;
  const where = context.shown === "." ? "the current directory" : printable(context.shown);
  return `NEXT STEP FOR THE AGENT: read ${BRIEF_PATH} now and carry it out, working in ${where}. Loop on ${context.invocation} verify until it passes. Don't stop here to report back; the brief says when to ask the user.`;
}

/** Why nothing launched (when that needs saying), then the prompt and, for a human, an example. */
function printedText(
  decision: Extract<HandoffDecision, { kind: "print" }>,
  context: RenderContext,
): string {
  const prompt = agentPrompt(context.invocation);
  const dir = printable(shellArg(context.shown));
  const { style = plainStyle } = context;
  const lines = [
    ...printReasonLines(decision, context.agent),
    style("next", `Next: open ${dir} in your coding agent and give it this prompt:`),
    `  ${prompt}`,
  ];
  if (context.audience === "human") lines.push(exampleLine(decision, context, prompt));
  return lines.join("\n");
}

/** The agent a printed outcome talks about: the one asked for, else the configured one, else Claude. */
const requestedLauncher = (decision: { agent?: Harness }, configured: AgentId | undefined) =>
  LAUNCH_ARGS[decision.agent ?? configured ?? "claude"];

/** The line explaining why no agent launched; most reasons are already obvious to the reader. */
function printReasonLines(
  decision: Extract<HandoffDecision, { kind: "print" }>,
  configured: AgentId | undefined,
): ReadonlyArray<string> {
  switch (decision.reason) {
    case "untrusted":
      return [
        `Not launching an agent: this project uses entries this machine hasn't trusted (${untrustedIds(decision.untrusted)}; listed above). Read them and the brief's first section before an agent acts on it.`,
      ];
    case "agent-not-found": {
      const requested = requestedLauncher(decision, configured);
      return [
        requested.via === "app"
          ? "The Codex app isn't installed (macOS only)."
          : `${requested.bin} isn't on PATH.`,
      ];
    }
    case "no-agent-found":
      return [`No agent CLI found on PATH (looked for ${TERMINAL_BINS.join(", ")}).`];
    case "json":
    case "no-launch":
    case "not-a-terminal":
    case "not-chosen":
      return [];
  }
}

/**
 * A ready-to-run command that starts the requested agent on the project. An app can't be started
 * from a shell line, so the example falls back to the configured terminal agent, else Claude.
 */
function exampleLine(
  decision: Extract<HandoffDecision, { kind: "print" }>,
  context: RenderContext,
  prompt: string,
): string {
  const requested = requestedLauncher(decision, context.agent);
  const example = requested.via === "terminal" ? requested : LAUNCH_ARGS[context.agent ?? "claude"];
  const command = [example.bin, ...example.args(prompt).map(quote)].join(" ");
  const cd = context.shown === "." ? "" : `cd ${printable(shellArg(context.shown))} && `;
  return `For example: ${cd}${command}`;
}

const untrustedIds = (untrusted: ReadonlyArray<string>) => untrusted.map(printable).join(", ");
