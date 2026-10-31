import { z } from 'zod';

const Config = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(?:ql)?$/ }),
  PORT_API: z.coerce.number().int().min(1).max(65535).default(3000),
});
export function config(env: Record<string, string | undefined> = process.env) {
  const parsed = Config.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Fix .env: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }
  return parsed.data;
}
