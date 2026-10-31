---
schema_version: 1
id: posthog
kind: fragment
category: vendor
name: PostHog analytics
description: PostHog analytics in the web client, disabled when no key is set so tests, CI, and sandboxes need no account, with a typed event catalog and a pre-init buffer.
tags: [analytics, vendor, web]
applies_to: [astro-blog, astro-fullstack, cloudflare-react-router, python-react, react-router, react-vite]
deps:
  web: [posthog-js]
decisions:
  - "PostHog host: US cloud (default), EU cloud, self-hosted, or a reverse-proxy domain."
  - "Consent: no banner with memory persistence (default), or a banner that opts in to cookies."
  - "Session recording and autocapture: off (default)."
---

# PostHog analytics

PostHog in the web client, inert without a key. An empty key is the normal state in dev, tests, CI, and sandboxes: nothing may fail or log because of it.

## What to add

<!-- stacks:when stack=astro-blog -->
**Env.** Append to `.env.example`, empty, under a comment saying analytics is off while the key is empty:
```
PUBLIC_POSTHOG_KEY=
PUBLIC_POSTHOG_HOST=
```
**Module**: `src/lib/analytics.ts`, initialized once from a module script in `BaseLayout.astro`'s head. Full page loads mean the SDK's default pageview capture is enough. Islands import `track()` from the module, so its pre-init buffer covers calls made before the client loads.
<!-- stacks:end -->
<!-- stacks:when stack=python-react -->
**Env.** Append to `.env.example`, empty, under a comment saying analytics is off while the key is empty:
```
VITE_PUBLIC_POSTHOG_KEY=
VITE_PUBLIC_POSTHOG_HOST=
```
**Module**: `frontend/app/lib/analytics.ts`, `initAnalytics()` called once from the root component's effect. Route changes don't reload the page: use the SDK's history-change pageview mode if the installed version has one, otherwise disable automatic pageviews and capture `$pageview` from an effect keyed on the router location.
<!-- stacks:end -->
<!-- stacks:when stack=react-vite -->
**Env.** Append to `.env.example`, empty, under a comment saying analytics is off while the key is empty:
```
VITE_PUBLIC_POSTHOG_KEY=
VITE_PUBLIC_POSTHOG_HOST=
```
Add both to `src/config.ts`'s schema as optional strings (only that file reads `import.meta.env`, and lint enforces it).

**Module**: `src/analytics.ts`. `main.tsx` calls `initAnalytics()` once with the parsed key, host and logger; the overflow warning goes through the logger, since only `src/logging.ts` may use `console`. Route changes don't reload the page: use the SDK's history-change pageview mode if the installed version has one, otherwise disable automatic pageviews and capture `$pageview` from an effect in `src/app/layout.tsx` keyed on the router location. In `e2e/`, abort requests to the PostHog host beside the API routes.
<!-- stacks:end -->

**One analytics module** owns the SDK and exports `initAnalytics()`, `track(event, props?)`, `identify(id, traits?)`, `reset()`. Nothing else imports `posthog-js`. Env vars are `<public prefix>POSTHOG_KEY`/`_HOST` in the framework's client-visible prefix, empty in `.env.example`.

- Empty key or no `window`: `initAnalytics()` returns without loading the SDK and everything else is a no-op.
- Load the SDK with a dynamic `import("posthog-js")` inside `initAnalytics()`. Guard against double init (hot reload, remounts).
- Config: host from env, identified-only person profiles, persistence, autocapture, and recording per the decisions.
- **Pre-init buffer**: `track()` can run before init finishes. Queue up to ~50 calls, replay them in the SDK's `loaded` callback; no key means no queue; overflow drops and warns once.
- **Event catalog**: `events.ts` (no SDK import) exports a const object of names; `track()` accepts only those. `snake_case` `object_verb` past tense (`post_shared`), snake_case properties.
- **Privacy**: never send free text users typed, emails, or tokens. Identify only after sign-in by internal id; `reset()` on sign-out.

## Testing

The test config sets the key to `""`. Test that `track()` is a silent no-op without a key and nothing loads the SDK, and unit-test the buffer (replay order, overflow warns once, no queue without key). If the project uses Playwright, block requests to the PostHog host.

## AGENTS.md

An **Analytics** section: the owning module, env var names, off-without-key, the event catalog and naming rule, the privacy rule. Without a key from the user, add "create a PostHog project and set the key in the deploy environment" to Pending user actions.
