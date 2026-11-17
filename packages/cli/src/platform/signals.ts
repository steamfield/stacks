/**
 * Owns the CLI signal policy. Pure decisions take signal history and time as inputs so they can
 * be tested without delivering OS signals.
 */
import { EXIT_INTERRUPTED } from "../errors";
import { killGroupsNow, killProcess, type ProcessHolder } from "./process";

type PolicySignal = "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGQUIT";
type SignalAction = "interrupt" | "ignore" | "force-exit" | "forward" | "default";
type Decision = { action: SignalAction; state: SignalState };
export type SignalState = {
  /** When the first interrupting signal arrived, if one has. */
  readonly interruptedAt?: number;
  /** When the last SIGINT was left to an interactive child. */
  readonly ignoredAt?: number;
  /** A SIGTERM or SIGHUP was forwarded to the interactive child; the CLI stops once it exits. */
  readonly forwarded?: true;
};
/**
 * One Ctrl+C can arrive twice: the terminal delivers it to the whole foreground group while a
 * wrapper such as `npm exec` forwards its own copy. A second interrupting signal sooner
 * than this after the first is that same keypress.
 */
export const SECOND_SIGNAL_MS = 1000;

/** What `signal`, arriving at `now`, means; `foreground` is whether an interactive child runs. */
export function decide(
  state: SignalState,
  signal: PolicySignal,
  now: number,
  foreground: boolean,
): Decision {
  return foreground ? decideWithChild(state, signal, now) : decideAlone(state, signal, now);
}

/**
 * The terminal already delivered SIGINT and SIGQUIT to the child, which decides what they mean.
 * A wrapper's copy of that SIGINT may land after the child exits, so remember when it came.
 */
function decideWithChild(state: SignalState, signal: PolicySignal, now: number): Decision {
  if (signal === "SIGINT") return { action: "ignore", state: { ...state, ignoredAt: now } };
  if (signal === "SIGQUIT") return { action: "ignore", state };
  return { action: "forward", state: { ...state, forwarded: true } };
}

/** No child holds the terminal: interrupt first, then ignore a quick repeat or force the exit. */
function decideAlone(state: SignalState, signal: PolicySignal, now: number): Decision {
  if (signal === "SIGQUIT") return { action: "default", state };
  if (state.interruptedAt === undefined) {
    if (signal === "SIGINT" && withinSecond(state.ignoredAt, now))
      return { action: "ignore", state };
    return { action: "interrupt", state: { ...state, interruptedAt: now } };
  }
  return { action: withinSecond(state.interruptedAt, now) ? "ignore" : "force-exit", state };
}

const withinSecond = (since: number | undefined, now: number) =>
  since !== undefined && now - since < SECOND_SIGNAL_MS;

/** The interactive child is gone: a SIGTERM or SIGHUP forwarded to it now stops the CLI too. */
export function foregroundCleared(
  state: SignalState,
  now: number,
): { action: "interrupt" | "ignore"; state: SignalState } {
  if (!state.forwarded) return { action: "ignore", state };
  const { forwarded: _, ...rest } = state;
  return { action: "interrupt", state: { ...rest, interruptedAt: rest.interruptedAt ?? now } };
}

type PolicyContext = {
  holder: ProcessHolder;
  interrupt: () => void;
  /** Removes every listener the policy installed. */
  removeListeners: () => void;
};

/** Performs one decided action for `signal`. */
function carryOut(action: SignalAction, signal: PolicySignal, context: PolicyContext): void {
  const { holder } = context;
  switch (action) {
    case "interrupt":
      context.interrupt();
      return;
    case "forward":
      if (holder.foreground !== undefined) killProcess(holder.foreground, signal);
      return;
    case "force-exit":
      killGroupsNow(holder.groups);
      process.exit(EXIT_INTERRUPTED);
      return;
    case "default":
      // With no listener left the runtime restores the default action; deliver it again. Dying
      // by a signal skips exit handlers, so kill the registered groups first.
      killGroupsNow(holder.groups);
      context.removeListeners();
      process.kill(process.pid, signal);
      return;
    case "ignore":
      return;
    default:
      action satisfies never;
  }
}

/**
 * Installs the policy for one invocation. `interrupt` aborts the program so finalizers run; a
 * forced exit SIGKILLs every registered process group first, since it skips finalizers, and so
 * does process exit. Returns a function that removes the signal listeners.
 */
export function installSignalPolicy(holder: ProcessHolder, interrupt: () => void): () => void {
  let state: SignalState = {};
  const signals: PolicySignal[] = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"];
  const listeners = new Map<PolicySignal, () => void>();
  const removeListeners = () => {
    for (const [signal, listener] of listeners) process.off(signal, listener);
  };
  const context: PolicyContext = { holder, interrupt, removeListeners };
  // Node invokes signal callbacks outside Effect, so both callbacks use the same wall clock.
  for (const signal of signals) {
    const listener = () => {
      const next = decide(state, signal, Date.now(), holder.foreground !== undefined);
      state = next.state;
      carryOut(next.action, signal, context);
    };
    listeners.set(signal, listener);
    process.on(signal, listener);
  }
  holder.onForegroundCleared = () => {
    const next = foregroundCleared(state, Date.now());
    state = next.state;
    if (next.action === "interrupt") interrupt();
  };
  process.on("exit", () => killGroupsNow(holder.groups));
  return () => {
    holder.onForegroundCleared = undefined;
    removeListeners();
  };
}
