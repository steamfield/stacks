---
schema_version: 1
id: posthog
kind: fragment
category: vendor
name: PostHog analytics for web clients
description: PostHog product analytics in the web client, with a shipped analytics module, typed event catalog and unit test for each supported stack. The SDK never loads while the key is empty, so tests, CI and sandboxes need no account.
tags: [analytics, vendor, web]
applies_to: [astro-blog, astro-fullstack, cloudflare-react-router, python-react, react-router]
deps:
  web: [posthog-js]
  web-dev: [happy-dom]
decisions:
  - "PostHog host: US cloud (default), EU cloud, self-hosted, or a reverse-proxy domain (then pass the proxy as host and the PostHog app as uiHost)."
  - "Consent: no banner, cookieless (default: cookieless_mode 'always'; cookieless tracking must be enabled in the PostHog project settings or its events are ignored), or a cookie banner with cookieless_mode 'on_reject'."
  - "Session recording and autocapture: off (default)."
---

# PostHog analytics

Inert without a key, the normal state in dev, tests, CI and sandboxes.

## What stacks wrote

`analytics.ts`, the only module that imports `posthog-js`, with `events.ts` (the event catalog) and a test beside them. `initAnalytics({ key, host })` takes env from its caller, loads nothing without a key or `window`, initializes once, and queues up to 50 earlier calls for replay. Its init options pin pageview, autocapture, recording and cookieless behaviour explicitly over `defaults: "latest"`. A failed SDK load (an ad blocker) turns analytics off instead of rejecting. The test covers the no-key path, replay, the queue limit, a failed load, single init and the installed SDK accepting the config offline, and checks that the entry file named below imports and calls `initAnalytics`: it fails until you wire it. Read the code before extending it.

## What to add

<!-- stacks:when stack=astro-blog -->
Shipped under `src/lib/`. Append `PUBLIC_POSTHOG_KEY=` and `PUBLIC_POSTHOG_HOST=` to `.env.example`, empty, under a comment saying analytics is off while the key is empty. Initialize once from a module `<script>` (not `is:inline`) in `BaseLayout.astro`'s head that imports `initAnalytics` and passes `import.meta.env.PUBLIC_POSTHOG_KEY` and `_HOST`. Every page is a full load, so the pageview option captures each one. Islands import `track()`; the queue covers calls made before the SDK loads. The shipped files are formatted for Prettier; keep them that way.
<!-- stacks:end -->
<!-- stacks:when stack=astro-fullstack -->
Shipped under `apps/web/src/lib/`, plus `config.ts`, the one module the Grit boundary lets read `import.meta.env` (if `lib/config.ts` already exists, merge `analyticsEnv` into it). The test is `analytics.test.tsx` because the web project only includes `src/**/*.test.tsx`. Add `posthog-js` to `apps/web`. Append `PUBLIC_POSTHOG_KEY=` and `PUBLIC_POSTHOG_HOST=`, empty, under `.env.example`'s `PUBLIC_` comment; Astro reads env files from `apps/web/`, so set the key in the build environment. Initialize once from a module `<script>` in `apps/web/src/layouts/BaseLayout.astro`'s head: `initAnalytics(analyticsEnv)`. The site never logs to the console, so the queue drops overflow silently.
<!-- stacks:end -->
<!-- stacks:when stack=cloudflare-react-router -->
Shipped under `app/lib/`, plus `vitest.client.config.ts`, a happy-dom project for browser modules. The Workers pool has no DOM, so add `"./vitest.client.config.ts"` to `projects` in `vitest.config.ts`, add `exclude: ["app/lib/**"]` to the workers project in `vitest.workers.config.ts`, and add `happy-dom` as a dev dependency. Coverage stays on server code. Append `VITE_PUBLIC_POSTHOG_KEY=` and `VITE_PUBLIC_POSTHOG_HOST=` to `.env.example`, empty (the key is public; secrets still never take `VITE_`). The root renders on the server: call `initAnalytics` from a `useEffect` in `App` in `app/root.tsx`, with `import.meta.env.VITE_PUBLIC_POSTHOG_KEY` and `_HOST`.
<!-- stacks:end -->
<!-- stacks:when stack=python-react -->
Shipped under `frontend/app/lib/`. Append `VITE_PUBLIC_POSTHOG_KEY=` and `VITE_PUBLIC_POSTHOG_HOST=`, empty, to the root `.env.example`'s frontend section. Call `initAnalytics` from a `useEffect` in `App` in `frontend/app/root.tsx`, passing `import.meta.env.VITE_PUBLIC_POSTHOG_KEY` and `_HOST`. The `history_change` pageview option covers SPA navigation; write no pageview code.
<!-- stacks:end -->
<!-- stacks:when stack=react-router -->
Shipped under `app/lib/`. Vitest runs in Node here, so the test carries `// @vitest-environment happy-dom`; keep that line. Append `VITE_PUBLIC_POSTHOG_KEY=` and `VITE_PUBLIC_POSTHOG_HOST=` to `.env.example`, empty. The root renders on the server: call `initAnalytics` from a `useEffect` in `App` in `app/root.tsx`, with `import.meta.env.VITE_PUBLIC_POSTHOG_KEY` and `_HOST`. Client navigation doesn't reload the page; the `history_change` pageview option captures it, so write no pageview code.
<!-- stacks:end -->

Add the declared `deps` to the web package. Apply the decisions in `analytics.ts`, not at call sites:

- **Host**: EU cloud is `https://eu.i.posthog.com`. Behind a proxy, `uiHost` is `https://us.posthog.com` or `https://eu.posthog.com`.
- **Consent**: the default `cookieless_mode: "always"` needs no banner, but PostHog ignores its events until cookieless tracking is enabled in the project settings. With a banner, use `"on_reject"`, export `optIn()`/`optOut()` calling `opt_in_capturing()`/`opt_out_capturing()`, and show the banner while `get_explicit_consent_status()` is `"pending"`.

Replace `example_viewed` with real events as they appear; `track()` accepts catalog names only.

## Conventions

- Nothing else imports `posthog-js`. Events are `snake_case` `object_verb`, past tense (`post_shared`), with flat snake_case scalar properties.
- Never send free text users typed, emails or tokens. `identify()` only after sign-in, by internal id; `reset()` on sign-out.
- A real-SDK test in a test DOM needs `opt_out_useragent_filter: true`: posthog-js treats the test user agent as a bot and silently drops its events.

## Testing

No verify step of its own, because the test command differs per stack: the stack's test step (`make test` on astro-blog and python-react, `bun run test` elsewhere) runs the shipped test, including its wiring check.

## AGENTS.md

An **Analytics** section: the module path, env var names, off-without-key, the catalog and naming rule, the privacy rule and the consent mode. Pending user actions: create a PostHog project, set the key in the build environment, and enable cookieless tracking in its settings.
