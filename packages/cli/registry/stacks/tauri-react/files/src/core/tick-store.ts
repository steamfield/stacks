/**
 * Creates a standalone tick and connection-status store for each provider.
 * React views select narrow slices while transport callbacks update it without depending on React.
 */

import { createStore } from "zustand/vanilla";
import type { Tick } from "./generated/bindings";

export function createTickStore() {
  return createStore<{ tick: Tick | null; status: "connecting" | "live" | "reconnecting" }>(() => ({
    tick: null,
    status: "connecting",
  }));
}
