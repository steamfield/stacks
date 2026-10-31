import type { AppInfo, CommandError, Tick } from "./generated/bindings";

export type InfoResult = { status: "ok"; data: AppInfo } | { status: "error"; error: CommandError };
export type TickObserver = { next: (tick: Tick) => void; end: (error?: unknown) => void };

export interface Transport {
  readonly windowLabel: string;
  appInfo(): Promise<InfoResult>;
  subscribeTicks(observer: TickObserver): () => void;
}
