# Routes

- Routes are listed explicitly in `app/routes.ts`. Use generated `Route.*` types through `~/routes/+types/<route>`; the tsconfig alias includes the generated type tree. Run `bun run typecheck` (which runs typegen) after adding or renaming a route.
- A loader or action decodes its input with a schema from `app/schemas/`, runs one program through `runRoute` (resource routes) or `runData` (page loaders), and returns data. No business logic, no direct SDK calls, no `process.env`.
- Resource routes return JSON or a stream. Reject non-JSON bodies with 415 before decoding.
- Route modules may import from `app/.server/`, but only use it inside `loader`/`action`; anything else leaks into the client bundle and fails `bun run build`.
- Resource routes export only `loader` and `action`. Their programs live in `app/.server/`: any other export that touches `~/.server` passes tsc and vitest but fails the build.
- Expected errors come back as `{ message, retryable }` (the `ErrorBody` schema) with the right status from `runRoute`; the UI shows `message` and offers Retry only when `retryable`. A new tagged error needs a case in both `statusFor` and `retryableFor`. Don't throw raw errors from a loader for expected cases. Runtime construction failure, cancellation, and defects still produce Responses.
- Every response carries `x-request-id`, and `runRoute` logs one completed request. `/healthz` proves config, service, and runtime wiring without touching an external service, and logs at debug.
- `runRoute` preserves streamed/download Responses, including status and headers. Ordinary values are JSON-encoded inside the protected boundary. Forward boundary headers from page `headers` exports, including the root boundary's error headers.
