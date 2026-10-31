---
schema_version: 1
id: clerk
kind: fragment
category: vendor
name: Clerk auth for Expo and Hono
description: Clerk sign-in for the Expo app and session verification on the Hono API, with auth on by default behind a public-path allowlist, a dev bypass, and tests that run Clerk's real verification against a local keypair with no account or network.
tags: [auth, clerk, vendor]
applies_to: [mobile-expo]
deps:
  api: ["@clerk/hono"]
  mobile: ["@clerk/expo", expo-secure-store]
decisions:
  - "Sign-in method: an emailed one-time code (default), or whatever the Clerk instance enables; leave social providers off until the user wants them."
---

# Clerk auth

Auth is on for every API route unless a path is named public, and the test suite proves it without a Clerk account. A clone with no keys still boots: the app runs with auth unmounted and the API serves its public routes.

<!-- stacks:when stack=mobile-expo -->
The base ships `createApp(databaseUrl)`, the anonymous `Providers`, `renderScreen`,
and `useHealth`. Extend those boundaries rather than replacing the slice. Install
auth middleware inside `createApp`, before mounting routes; retain its per-app
database URL. `/items` becomes protected, so move its existing success and zod-400
requests onto the harness's signed `t.as(...)` path. Keep the parallel isolation
files and same-process app-binding cases signed too. Extend `Providers` and the test renderer together, clear the
same QueryClient on identity changes, and add `test/auth-provider.test.tsx` from
the acceptance matrix in `docs/acceptance/mobile-expo.md`.
<!-- stacks:end -->

## API

- `middleware/auth.ts` exports `clerkAuth()`, which builds Clerk's Hono middleware per request with `jwtKey` from `CLERK_JWT_KEY` (read per request, since bun:test shares modules across files). Passing the PEM is what turns on networkless verification.
- `withUserId` copies the verified user id onto the context (`AppEnv.Variables.userId: string | null`), and `requireAuth` throws `HTTPException(401)` when it's absent, so the body comes from `app.ts`'s error handler like every other error.
- `app.ts` mounts the chain globally: `app.use('*', except(PUBLIC_PATHS, clerkAuth(), withUserId, requireAuth))`, with `PUBLIC_PATHS` holding `/health`, `/health/ready`, `/docs`, `/openapi.json`. Clerk's middleware throws without keys, so health checks must stay outside it. Adding a path is a security decision with a comment saying why. Keep the chain out of route modules: `@clerk/hono` must stay unreachable from `AppType`, and the import-graph test should assert it.
- Authenticated routes declare `security: [{ bearerAuth: [] }]` and a 401 response; register the `bearerAuth` scheme on the app. Handlers read `c.get('userId')` and treat a missing one behind `requireAuth` as a miswired chain (500), not an anonymous caller.
- Add `GET /api/me` returning the caller's id: the authenticated half of the proving slice.
- `index.ts` warns at boot when the Clerk keys are unset or placeholders, naming the public routes that still work.

**Dev bypass.** With `DEV_AUTH_USER_ID` set, a request carrying no `authorization` header at all is attributed to that id, and `clerkAuth()` calls `next()` without running Clerk's middleware, so the bypass works on a clone with no keys. A request with any header, valid or not, is never bypassed, or a failed verification would answer 200. `index.ts` exits when it's set with `NODE_ENV=production`.

## Mobile

- `lib/clerk.ts` reads `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, treating an empty value as absent. Auth is enabled only when a key is present and `EXPO_PUBLIC_AUTH_BYPASS` isn't `1`. Outside `__DEV__` it throws on a missing key, a placeholder key (one containing `replace_me` or ending in `_xxx`, the shapes EAS profiles and docs use), or the bypass flag, so none of them can ship.
- The root layout wraps everything in `ClerkProvider` (with Clerk's secure-store token cache) only when auth is enabled.
- `lib/auth-token.ts` exports `useSessionToken`, chosen once at module load: Clerk's `getToken` when enabled, a function resolving `null` otherwise. Hooks fetch a fresh token per request (Clerk rotates them) and pass `authorization: Bearer <token>` through a small `authHeaders(getToken)` helper; screens never touch tokens.
- A sign-in route using the chosen method. Register the app's URL scheme as a redirect URL in the Clerk instance.

**`--no-auth`.** Extend the stack's `scripts/dev.sh` with a `--no-auth` flag (reject unknown flags) that exports `EXPO_PUBLIC_AUTH_BYPASS=1` and `DEV_AUTH_USER_ID` (default `user_devbypass`) for that run only, and clears Metro's transform cache, because inlined `EXPO_PUBLIC_*` values are otherwise served stale. Neither variable goes in `.env`.

## Tests

- `test/setup.ts` gains `setupTestAuth()`: generate a 2048-bit RS256 keypair, set `CLERK_JWT_KEY` to the public PEM, `CLERK_TELEMETRY_DISABLED=1` (so nothing leaves the machine), a fake secret key, and a well-formed publishable key (`pk_test_` plus base64 of `<frontend-api-host>$`; Clerk parses it). Return `signSessionToken(userId, overrides?)`, which signs a Clerk-shaped session JWT (`sub`, `sid`, `iat`, `nbf`, `exp`, `azp`, and `iss` of `https://<that frontend-api-host>`) with overrides merged into the claims. `createSigner()` makes an untrusted second key. `setupApiTest` calls it and adds `t.auth` and `t.as(userId, path, init?)`, which signs a token and adds a JSON content type when there's a body.
- Every authenticated route gets four cases: valid token, no token, a token from another key, an expired token. Write them for `/api/me` first.
- Mobile tests stub `@clerk/expo` through the shared `test/clerk-mock.ts` factory, matching its resources. `renderScreen` mounts the project's real provider composition, including the SDK-boundary provider stub when enabled. Exercise keyless, signed-out/in, token refresh/failure and sign-out through real query hooks and hc; assert Authorization and cache clearing. Add the SDK stub to `docs/testing.md`'s sanctioned boundaries. Account/device flows remain external.

## Gotchas

- Clerk's backend PEM loader may reject RSA key sizes other than the one Clerk issues; if the test key fails to load, generate it at 2048 bits.
- If Clerk's Expo package keeps jest's process alive after the run reports, set jest's force-exit option with a comment explaining why; nothing in the project holds the handle.
- A Clerk config plugin can add the Apple sign-in entitlement, which makes simulator builds demand a signing certificate. Turn it off unless Apple sign-in is wanted.

## Environment and AGENTS.md

Add to `.env.example`, all empty (a fake value counts as present and mounts Clerk with a bogus key): `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWT_KEY` (tests set their own), `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`; and the bypass variables as comments explaining why they aren't set there. Add an **Auth** section to AGENTS.md: the allowlist, the bypass, the four test cases. Pending user actions: create the Clerk application, fill the keys, and register the redirect URLs.
