/** Renders the handoff prompt, picker and launch examples. */
import type { AgentId, Harness } from "@steamfield/stacks-format";
import { BRIEF_PATH } from "../../project-layout";
import { type Audience, plainStyle, type Style } from "../../services/output";
import { shellArg } from "../text/shell";
import { printable } from "../text/text";
import type { HandoffDecision } from "./decide";
import { LAUNCH_ARGS, LAUNCH_ORDER } from "./launchers";

/** The binaries of every terminal launcher, in launch order, as the no-agent-found line names them. */
const TERMINAL_BINS = LAUNCH_ORDER.flatMap((agent) => {
  const launcher = LAUNCH_ARGS[agent];
  return launcher.via === "terminal" ? [launcher.bin] : [];
});

/** The picker's question after `pickerText`'s numbered list of `count` agents. */
export const pickerQuestion = (count: number) => `Hand the project to [1-${count}, Enter for 1]: `;

export const pickerText = (options: ReadonlyArray<Harness>) => {
  const rows = options.map((agent, index) => `  ${index + 1}) ${LAUNCH_ARGS[agent].label}`);
  return `Agents found:\n${rows.join("\n")}\n`;
};

/** The one prompt every outcome gives the agent. No quotes or backticks, so it pastes into a shell. */
export const agentPrompt = (invocation: string) =>
  `Read ${BRIEF_PATH} and carry it out. It's your full task for this project; you're done when ${invocation} verify passes.`;

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
