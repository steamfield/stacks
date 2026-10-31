import type { Context } from 'hono';
import type { z } from 'zod';
import type { AppEnv } from './env';

// Child OpenAPI groups need this too: mounting a group doesn't inherit hooks.
export function validationHook(result: z.ZodSafeParseResult<unknown>, c: Context<AppEnv>) {
  if (!result.success) {
    return c.json(
      {
        message: result.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      },
      400,
    );
  }
}
