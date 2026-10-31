import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { LOG_LEVELS, type LogLevel } from "./logging.ts";

export type AppConfig = {
  /** Absolute path of the directory the tools may read. */
  root: string;
  logLevel: LogLevel;
  /** Files larger than this are refused with the too_large tool error. */
  maxFileBytes: number;
};

export class ConfigError extends Error {
  override name = "ConfigError";
}

// An empty value means "use the default", the same as leaving the variable out.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const Env = z.object({
  MCP_ROOT: z.string({ error: "set MCP_ROOT to the directory the server may read" }).min(1),
  LOG_LEVEL: optional(
    z.preprocess(
      (value) => (typeof value === "string" ? value.toLowerCase() : value),
      z.enum(LOG_LEVELS),
    ),
  ),
  MAX_FILE_BYTES: optional(z.coerce.number().int().positive()),
});

/**
 * Parses settings from an environment record and checks the root is a directory. A relative
 * MCP_ROOT resolves against `cwd`. Throws ConfigError naming each bad variable.
 */
export async function loadConfig(
  env: Record<string, string | undefined>,
  cwd: string,
): Promise<AppConfig> {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const { data } = parsed;
  const root = resolve(cwd, data.MCP_ROOT);
  const isDirectory = await stat(root).then(
    (stats) => stats.isDirectory(),
    () => false,
  );
  if (!isDirectory) throw new ConfigError(`Invalid configuration: MCP_ROOT is not a directory`);
  return {
    root,
    logLevel: data.LOG_LEVEL ?? "info",
    maxFileBytes: data.MAX_FILE_BYTES ?? 1_048_576,
  };
}
