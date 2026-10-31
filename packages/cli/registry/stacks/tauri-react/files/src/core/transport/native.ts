import { Channel } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { commands, type Tick } from "../generated/bindings";
import type { TickObserver, Transport } from "../transport";

export function createNativeTransport(): Transport {
  const observers = new Set<TickObserver>();
  let running = false;
  return {
    windowLabel: getCurrentWindow().label,
    appInfo: () => commands.appInfo(),
    subscribeTicks(observer) {
      observers.add(observer);
      if (!running) {
        running = true;
        const channel = new Channel<Tick>();
        channel.onmessage = (tick) => {
          for (const subscriber of observers) subscriber.next(tick);
        };
        const end = (error?: unknown) => {
          running = false;
          for (const subscriber of [...observers]) subscriber.end(error);
        };
        // One native stream belongs to this window; React subscriptions only detach listeners.
        // Rust cancels it on page replacement or window destruction.
        void commands.subscribeTicks(channel).then((result) => {
          if (result.status === "error") end(result.error);
          else end();
        }, end);
      }
      return () => observers.delete(observer);
    },
  };
}
