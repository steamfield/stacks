---
schema_version: 1
id: clerk
kind: fragment
category: vendor
name: Clerk auth for Expo and Hono
description: Clerk sign-in for the Expo app and session verification on the Hono API, with auth on by default behind a public-path allowlist, a dev bypass that fails closed, and tests that run Clerk's real verification against a local keypair with no account or network.
tags: [auth, clerk, vendor]
applies_to: [mobile-expo]
deps:
  api: ["@clerk/hono"]
  mobile: ["@clerk/expo", expo-secure-store]
decisions:
  - "Sign-in method: an emailed one-time code (default), or whatever the Clerk instance enables; leave social providers off until the user wants them."
verify:
  - { name: auth-api, layer: test, run: bun run test:api test/auth.test.ts }
  - { name: auth-mobile, layer: test, run: bun run test:mobile --runInBand test/clerk-auth.test.tsx }
commands:
  test:api: The API suite (bun test)
  test:mobile: The mobile suite (jest)
---

# Clerk auth

Every API route needs a verified Clerk session unless its path is in `PUBLIC_PATHS`, and the tests prove it with no Clerk account. A clone with no keys still boots: the app runs anonymous and the API serves its public routes, answering 503 elsewhere.

Stacks wrote:

- `apps/api/src/middleware/auth.ts`: `protectRoutes()` (the whole chain), `clerkAuth()`, `requireAuth`, `PUBLIC_PATHS`, `devBypassUserId()`, `authConfigured()` and the `AuthEnv` type. Passing `CLERK_JWT_KEY` as `jwtKey` is what makes verification networkless.
- `apps/api/src/routes/me.ts`: `GET /me`, the authenticated half of the proving slice.
- `apps/api/test/auth.ts` (`setupTestAuth()`, `createSigner()`) and `test/auth.test.ts`, which the `auth-api` step runs: valid, missing, foreign-key and expired tokens, keyless, bypass and no-network cases on the chain, then the real API booted from `src/index.ts` (so it fails until `app.ts` and `config.ts` are wired).
- `apps/mobile/src/lib/clerk.ts` (`clerkConfig()`) and `src/lib/auth.tsx` (`AuthProvider`, `useSessionToken`, `authHeaders`).
- `apps/mobile/test/clerk-mock.ts` (the SDK stub, `setClerkSession`) and `test/clerk-auth.test.tsx`, which the `auth-mobile` step runs. It passes before any wiring; the stack's `auth-provider` step proves the wiring.

Read them before wiring them in. Lint and typecheck fail until the edits below are made.

## API edits

1. `src/env.ts`: add `userId: string | null` to `AppEnv`'s `Variables`.
2. `packages/schemas/src/index.ts`: add `MeResponse = z.object({ id: z.string() }).meta({ id: 'MeResponse' })` and its type.
3. `routes/index.ts`: mount `.route('/me', me)`.
4. `app.ts`: `app.use('*', protectRoutes())` after the request-logging middleware and before the routes, so 401s are logged and answered by `onError`. Register the scheme `me.ts` declares: `app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer' })`. Keep auth out of route modules: the shipped import-graph check already rejects `@clerk/` and `middleware/` reachable from `client.ts`.
5. `config.ts`: call `devBypassUserId(env)` after parsing, so the server refuses to boot when `DEV_AUTH_USER_ID` is set beside `NODE_ENV=production` or an `sk_live_` key. `index.ts` warns once when `authConfigured()` is false, naming `PUBLIC_PATHS`.
6. `test/setup.ts`: `setupApiTest` calls `setupTestAuth()` and returns `auth` and `as: (userId, path, init?) => auth.as(app, userId, path, init)`. Move every protected request in the existing tests onto `t.as(...)`: `items.test.ts`, the 404 and zod-400 requests in `health.test.ts`, both isolation files, the `__unexpected`, `__resource` and missing-path requests in `errors.test.ts`, and harness-contract's two apps (`t.auth.as(first, ...)`). The unexpected-error case sends `t.auth.signSessionToken(...)` as its bearer and asserts that token never reaches the logs either. An anonymous request to an unknown path answers 401, not 404; that's intended.

Handlers read `c.get('userId')`; a missing one behind `requireAuth` is a miswired chain (500), as in `me.ts`. A new authenticated route declares `security: [{ bearerAuth: [] }]` and a 401 response, and gets valid, missing, foreign-key and expired token cases through `t.as` and `createSigner()`.

**Dev bypass.** With `DEV_AUTH_USER_ID` set, a request with no `authorization` header at all is attributed to that id, even with no keys. Any header is verified normally, so a bad token never answers 200.

## Mobile edits

1. `src/lib/providers.tsx`: wrap the children in `<AuthProvider client={client}>` inside `QueryClientProvider`. `test/render.tsx` already mounts `Providers` with its own client and needs no change. `AuthProvider` mounts `ClerkProvider` (key from `clerkConfig()`, `tokenCache` from `@clerk/expo/token-cache`) only when a key is set, and clears the QueryClient when the signed-in user changes.
2. `test/setup.ts`: install the stub for every test and reset it after each:
   ```ts
   jest.mock('@clerk/expo', () => require('./clerk-mock').clerkExpoMock);
   jest.mock('@clerk/expo/token-cache', () => require('./clerk-mock').clerkTokenCacheMock);
   ```
   plus `require('./clerk-mock').resetClerkSession()` in the existing `afterEach`. Add a row for it to `docs/testing.md`'s module-stub table.
3. `queries/keys.ts` gains `me: ['me'] as const`, and `queries/use-me.ts` exports `useMe()`: `api.me.$get({}, { headers: await authHeaders(getToken) })` with `getToken` from `useSessionToken()`, `apiError` on failure, `MeResponse.parse` on success. Fetch a fresh token per request; screens never touch tokens. A screen shows it, so the signed-in path is visible in the simulator.
4. `test/auth-provider.test.tsx`, the acceptance matrix in `docs/acceptance/mobile-expo.md`: render a component using `useMe()` through `renderScreen`, stub fetch to answer 200 for a bearer token and 401 otherwise, and drive `setClerkSession`. Cover keyless (key unset, no Authorization even with a stubbed session), signed out, signed in, a token change between two refetches (both bearers sent), a rejected `getToken` (error, no request), sign-out (the `me` query data is cleared, the next request has no Authorization) and no token in any console output. Wrap session changes in `act`.
5. A sign-in route using the chosen method, on Core 3 APIs: `useSignIn()` with `signIn.emailCode.sendCode({ emailAddress })`, `signIn.emailCode.verifyCode({ code })`, then `signIn.finalize()`. Gate screens with `useAuth()`'s `isLoaded`/`isSignedIn` or `<Show>`. `SignedIn` and `SignedOut` are gone, and the old `create`/`attemptFirstFactor`/`setActive` flow lives in `@clerk/expo/legacy`: never import it. Sign-out calls `useAuth().signOut()`. Register the app's URL scheme as a redirect URL in the Clerk instance.

<!-- stacks:when mode=add -->
A project made without Clerk already has `test/auth-provider.test.tsx` for the anonymous seam. Replace its no-Clerk assertion with the matrix above, keeping the keyless case.
<!-- stacks:end -->

**`--no-auth`.** In `scripts/dev.ts`, replace the "dev accepts no arguments" check with a parser that accepts only `--no-auth` and rejects anything else with exit 2. With it, set `EXPO_PUBLIC_AUTH_BYPASS=1` and `DEV_AUTH_USER_ID` (default `user_devbypass`) in `process.env` before the children start: both inherit them, the app runs anonymous and the API attributes its requests to the bypass id. Neither variable goes in `.env`, and `clerkConfig()` refuses the bypass outside `__DEV__`.

## Gotchas

- The test keypair is 2048 bits; Clerk's PEM loader rejects 3072 and 4096.
- `expo install @clerk/expo` adds the plugin to `app.json` with Sign in with Apple on, so simulator builds demand a signing certificate. Replace it with `["@clerk/expo", { "appleSignIn": false }]` unless the sign-in decision chose Apple.
- `authorizedParties` stays unset in `clerkAuth()` because it rejects tokens without an `azp` claim. Set it when a web client joins.

## Environment and AGENTS.md

Add to `.env.example`, all empty (a fake value counts as present and mounts Clerk with a bogus key): `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWT_KEY` (the instance's PEM public key; tests set their own), `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`. Add the bypass variables as comments saying `bun run dev --no-auth` sets them. Add an **Auth** section to AGENTS.md: `PUBLIC_PATHS` and why each entry is public, the bypass and `--no-auth`, `t.as(...)` for protected requests, and the four token cases every authenticated route gets. Pending user actions: create the Clerk application, fill the keys (including the JWT public key), and register the redirect URL.
