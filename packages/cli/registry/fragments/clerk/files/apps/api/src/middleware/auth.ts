import { clerkMiddleware, getAuth } from '@clerk/hono';
import type { MiddlewareHandler } from 'hono';
import { except } from 'hono/combine';
import { HTTPException } from 'hono/http-exception';

/** What the chain sets on the context; AppEnv's Variables include it. */
export type AuthEnv = { Variables: { userId: string | null } };

// Every other path requires a verified session. Adding a path here is a security
// decision: say why beside it.
export const PUBLIC_PATHS = [
  '/health', // liveness probes carry no token
  '/health/ready', // readiness probes carry no token
  '/docs', // the API reference is public
  '/openapi.json', // the reference reads it
];

type Env = Record<string, string | undefined>;

/**
 * The dev bypass user id, or undefined when the bypass is off. Throws when the
 * bypass is set where it must never apply: Bun doesn't set NODE_ENV, so a live
 * Clerk key counts as production too.
 */
export function devBypassUserId(env: Env = process.env) {
  const id = env.DEV_AUTH_USER_ID;
  if (!id) return undefined;
  if (env.NODE_ENV === 'production' || env.CLERK_SECRET_KEY?.startsWith('sk_live_')) {
    throw new Error('DEV_AUTH_USER_ID must not be set in production. Unset it.');
  }
  return id;
}

/** True when the API has the keys Clerk's middleware needs. */
export function authConfigured(env: Env = process.env) {
  return Boolean(env.CLERK_SECRET_KEY && env.CLERK_PUBLISHABLE_KEY);
}

/**
 * Verifies the bearer session token and sets `userId` (null when absent or
 * invalid). Env is read per request: bun:test shares modules across files.
 */
export function clerkAuth(): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    // Only a request with no authorization header at all is bypassed, so a token
    // that fails verification can never answer 200.
    const bypass = devBypassUserId();
    if (bypass && c.req.header('authorization') === undefined) {
      c.set('userId', bypass);
      return next();
    }
    if (!authConfigured()) throw new HTTPException(503, { message: 'Auth is not configured' });
    // jwtKey (the instance's PEM public key) verifies tokens locally, with no
    // request to Clerk. authorizedParties stays unset: it matches the token's azp
    // claim against web origins, and rejects tokens that carry none, as a native
    // app's may. Set it when a web client joins.
    const verify = clerkMiddleware({
      secretKey: process.env.CLERK_SECRET_KEY,
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
      jwtKey: process.env.CLERK_JWT_KEY || undefined,
    });
    return verify(c, async () => {
      c.set('userId', getAuth(c).userId ?? null);
      await next();
    });
  };
}

/** Rejects a request with no verified user. */
export const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  if (!c.get('userId')) throw new HTTPException(401, { message: 'Unauthorized' });
  await next();
};

/** The whole chain for `app.ts`: every path but PUBLIC_PATHS needs a user. */
export function protectRoutes(): MiddlewareHandler<AuthEnv> {
  return except(PUBLIC_PATHS, clerkAuth(), requireAuth);
}
