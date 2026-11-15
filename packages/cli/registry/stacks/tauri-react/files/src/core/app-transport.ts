/**
 * Selects the native transport inside Tauri or the mock transport for browser use.
 * The frontend entry calls this boundary, which also validates the explicit transport setting.
 */

import { isTauri } from "@tauri-apps/api/core";
import { MockTransport } from "./mock-transport";
import { createNativeTransport } from "./transport/native";

export function appTransport() {
  const mode = import.meta.env.VITE_TRANSPORT;
  if (mode !== undefined && mode !== "mock" && mode !== "native") {
    throw new Error("VITE_TRANSPORT must be mock or native");
  }
  return isTauri() && mode !== "mock"
    ? createNativeTransport()
    : new MockTransport(new URLSearchParams(window.location.search));
}
