import { z } from "zod";

// Validates the server's view of runtimeConfig once. Nuxt fills runtimeConfig from
// nuxt.config.ts defaults and NUXT_* environment variables; it doesn't check their values.
const ServerConfig = z.object({
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  public: z.object({
    appTitle: z.string().trim().min(1).default("Notes"),
  }),
});

export type ServerConfig = z.infer<typeof ServerConfig>;

export function parseServerConfig(raw: unknown): ServerConfig {
  const parsed = ServerConfig.safeParse(raw);
  if (!parsed.success) {
    // Name the keys, never the values: a value can be a secret.
    const keys = parsed.error.issues.map((issue) => issue.path.join("."));
    throw new Error(`Invalid runtime config: ${keys.join(", ")}`);
  }
  return parsed.data;
}

let cached: ServerConfig | undefined;

export function serverConfig(): ServerConfig {
  cached ??= parseServerConfig(useRuntimeConfig());
  return cached;
}
