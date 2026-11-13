// A3, the signal policy: what a signal to the CLI means, with or without an interactive child in
// the foreground. `decide` is the policy; `installSignalPolicy` wires it to the process.
import { killGroupsNow, killProcess, type ProcessHolder } from "./process";

type PolicySignal = "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGQUIT";
type SignalAction = "interrupt" | "ignore" | "force-exit" | "forward" | "default";
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
 * wrapper (scripts/dev.ts, `npm exec`) forwards its own copy. A second interrupting signal sooner
 * than this after the first is that same keypress.
 */
export const SECOND_SIGNAL_MS = 1000;

export function decide(
  state: SignalState,
  signal: PolicySignal,
  now: number,
  foreground: boolean,
): { action: SignalAction; state: SignalState } {
  if (foreground) {
    // The terminal already delivered SIGINT and SIGQUIT to the child, which decides what they
    // mean. A wrapper's copy of that SIGINT may land after the child exits; remember when.
    if (signal === "SIGINT") return { action: "ignore", state: { ...state, ignoredAt: now } };
    if (signal === "SIGQUIT") return { action: "ignore", state };
    return { action: "forward", state: { ...state, forwarded: true } };
  }
  if (signal === "SIGQUIT") return { action: "default", state };
  if (state.interruptedAt === undefined) {
    if (
      signal === "SIGINT" &&
      state.ignoredAt !== undefined &&
      now - state.ignoredAt < SECOND_SIGNAL_MS
    )
      return { action: "ignore", state };
    return { action: "interrupt", state: { ...state, interruptedAt: now } };
  }
  return { action: now - state.interruptedAt < SECOND_SIGNAL_MS ? "ignore" : "force-exit", state };
}

/** The interactive child is gone: a SIGTERM or SIGHUP forwarded to it now stops the CLI too. */
export function foregroundCleared(
  state: SignalState,
  now: number,
): { action: "interrupt" | "ignore"; state: SignalState } {
  if (!state.forwarded) return { action: "ignore", state };
  const { forwarded: _, ...rest } = state;
  return { action: "interrupt", state: { ...rest, interruptedAt: rest.interruptedAt ?? now } };
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
  const remove = () => {
    for (const [signal, listener] of listeners) process.off(signal, listener);
  };
  for (const signal of signals) {
    const listener = () => {
      const next = decide(state, signal, Date.now(), holder.foreground !== undefined);
      state = next.state;
      switch (next.action) {
        case "interrupt":
          interrupt();
          return;
        case "forward":
          if (holder.foreground !== undefined) killProcess(holder.foreground, signal);
          return;
        case "force-exit":
          killGroupsNow(holder.groups);
          process.exit(130);
          return;
        case "default":
          // With no listener left the runtime restores the default action; deliver it again. Dying
          // by a signal skips exit handlers, so kill the registered groups first.
          killGroupsNow(holder.groups);
          remove();
          process.kill(process.pid, signal);
          return;
        case "ignore":
          return;
        default:
          next.action satisfies never;
      }
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
    remove();
  };
}
