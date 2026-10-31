import "server-only";
import { z } from "zod";

const configSchema = z.object({
  APP_TITLE: z.string().trim().min(1).default("Items"),
});

export function readConfig(env: Record<string, string | undefined>) {
  return configSchema.parse({ APP_TITLE: env.APP_TITLE });
}

let cached: ReturnType<typeof readConfig> | undefined;

export function config() {
  cached ??= readConfig(process.env);
  return cached;
}
