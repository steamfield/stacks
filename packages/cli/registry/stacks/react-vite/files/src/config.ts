import { z } from "zod";
import { LOG_LEVELS, type LogLevel } from "./logging";

export type AppConfig = {
  /** Base for every API request: a same-origin path ("/api") or an absolute http(s) URL. */
  apiUrl: string;
  logLevel: LogLevel;
};

export class ConfigError extends Error {
  override name = "ConfigError";
}

// An empty value in .env means "use the default", the same as leaving the line out.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const isApiUrl = (value: string) =>
  value.startsWith("/") || (URL.canParse(value) && /^https?:$/.test(new URL(value).protocol));

const Env = z.object({
  VITE_API_URL: optional(
    z.string().trim().refine(isApiUrl, "must be a path starting with / or an http(s) URL"),
  ),
  VITE_LOG_LEVEL: optional(z.enum(LOG_LEVELS)),
});

/** Parses the build-time environment. Throws ConfigError naming each bad variable. */
export function parseConfig(env: Record<string, unknown>): AppConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return {
    apiUrl: (parsed.data.VITE_API_URL ?? "/api").replace(/\/+$/, ""),
    logLevel: parsed.data.VITE_LOG_LEVEL ?? "info",
  };
}

/** The app's config. Vite inlines VITE_* values at build time; nothing here is secret. */
export function loadConfig(): AppConfig {
  return parseConfig(import.meta.env);
}
