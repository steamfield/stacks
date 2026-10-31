import { z } from "@hono/zod-openapi";
import { LOG_LEVELS, type LogLevel } from "./logging.ts";

export type AppConfig = {
  port: number;
  logLevel: LogLevel;
  /** Requests with a larger body get the 413 envelope. */
  maxBodyBytes: number;
};

export class ConfigError extends Error {
  override name = "ConfigError";
}

// An empty value in .env means "use the default", the same as leaving the line out.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const Port = z.coerce.number().int().min(0).max(65_535);

const Env = z.object({
  PORT_API: optional(Port),
  PORT: optional(Port),
  LOG_LEVEL: optional(
    z.preprocess(
      (value) => (typeof value === "string" ? value.toLowerCase() : value),
      z.enum(LOG_LEVELS),
    ),
  ),
  MAX_BODY_BYTES: optional(z.coerce.number().int().positive()),
});

/** Parses settings from an environment record. Throws ConfigError naming each bad variable. */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const { data } = parsed;
  return {
    port: data.PORT_API ?? data.PORT ?? 3000,
    logLevel: data.LOG_LEVEL ?? "info",
    maxBodyBytes: data.MAX_BODY_BYTES ?? 65_536,
  };
}
