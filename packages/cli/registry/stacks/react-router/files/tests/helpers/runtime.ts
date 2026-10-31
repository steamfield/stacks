import { ConfigProvider } from "effect";
import { RouterContextProvider } from "react-router";
import { onTestFinished } from "vitest";
import type { LogEntry } from "../../app/.server/logging";
import { makeRuntime, setRuntime } from "../../app/.server/runtime";

export function useTestRuntime(env: Record<string, string | undefined> = {}) {
  const records: LogEntry[] = [];
  const runtime = makeRuntime(
    ConfigProvider.fromEnvRecord({ LOG_LEVEL: "debug", ...env }),
    (record) => records.push(record),
  );
  const restore = setRuntime(runtime);
  onTestFinished(async () => {
    restore();
    await runtime.dispose();
  });
  return { runtime, records };
}
export function args(request: Request, pattern = "/") {
  return {
    request,
    params: {},
    context: new RouterContextProvider(),
    url: new URL(request.url),
    pattern,
  };
}
