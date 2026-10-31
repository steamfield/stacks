import { createStore } from "zustand/vanilla";
import type { Tick } from "./generated/bindings";

export function createTickStore() {
  return createStore<{ tick: Tick | null; status: "connecting" | "live" | "reconnecting" }>(() => ({
    tick: null,
    status: "connecting",
  }));
}
