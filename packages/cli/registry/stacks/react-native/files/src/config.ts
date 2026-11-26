/**
 * App settings: validated defaults, overridden by the root component's initial properties
 * (passed from the native side or by tests). An invalid value throws a `config` AppError, which
 * the root error boundary renders instead of starting the app with a bad setting.
 */
import { z } from "zod";
import { AppError } from "./errors";
import { LOG_LEVELS, type LogLevel } from "./logging";

export type AppConfig = {
  logLevel: LogLevel;
  /** How long a native module call may take before the screen shows a timeout. */
  nativeTimeoutMs: number;
};

const overridesSchema = z.strictObject({
  logLevel: z.enum(LOG_LEVELS).optional(),
  nativeTimeoutMs: z.number().int().min(100).max(60_000).optional(),
});

export function defaultConfig(dev: boolean): AppConfig {
  return { logLevel: dev ? "debug" : "info", nativeTimeoutMs: 5_000 };
}

export function loadConfig(raw: unknown, dev: boolean): AppConfig {
  const parsed = overridesSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "settings"}: ${issue.message}`,
    );
    throw new AppError("config", problems.join("; "));
  }
  const defaults = defaultConfig(dev);
  return {
    logLevel: parsed.data.logLevel ?? defaults.logLevel,
    nativeTimeoutMs: parsed.data.nativeTimeoutMs ?? defaults.nativeTimeoutMs,
  };
}
