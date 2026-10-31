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
