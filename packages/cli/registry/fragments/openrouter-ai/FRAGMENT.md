---
schema_version: 1
id: openrouter-ai
kind: fragment
category: vendor
name: OpenRouter LLM provider
description: "OpenRouter as the LLM provider for a TypeScript project: an optional API key, model discovery, routing and fallback settings, attribution headers, OpenRouter's error classes mapped to safe retryable errors, and a local stub server with its own test."
tags: [typescript, ai, openrouter]
applies_to: [typescript-api, react-router, typescript-cli]
tools: [node]
decisions:
  - "Default model: a cheap current model with tool support, selected from OpenRouter's public models list during setup (default), recorded as OPENROUTER_MODEL and as the application's fallback default when it needs one."
  - "Routing: no fallback models or provider sort; provider fallbacks and data collection allowed, zero-data-retention disabled (default). All routing settings are configurable."
verify:
  - { name: openrouter-stub, layer: test, run: node node_modules/vitest/vitest.mjs run tests/openrouter-stub.test.ts }
---

# OpenRouter integration

stacks wrote `tests/helpers/stub-openrouter.ts`, a local OpenRouter on `node:http`, with `tests/openrouter-stub.test.ts` proving it speaks OpenRouter's wire format, and `docs/openrouter.md`, the contract the provider boundary follows: requests, attribution, usage, the error classes and their retry decisions. Read both before writing provider code. The application picks its client library, streaming protocol, recorder, evals and interface; vendor-only, call the endpoints through the stack's Effect `HttpClient` (or `@effect/ai-openrouter` for completions).

## Configuration and models

Read `OPENROUTER_API_KEY` as an optional redacted secret; empty means unset. Add `OPENROUTER_MODEL`, optional `OPENROUTER_BASE_URL` (the `/api/v1` root), comma-separated `OPENROUTER_FALLBACK_MODELS`, `OPENROUTER_PROVIDER_SORT`, `OPENROUTER_ALLOW_FALLBACKS`, `OPENROUTER_DATA_COLLECTION`, `OPENROUTER_ZDR` and optional `OPENROUTER_SITE_URL` to the stack-owned `.env.example`, config module and README. Leave optional SDK-owned variables commented out when empty values are invalid. Never commit or log the key.

The application starts, builds and tests without a key and reports a not-configured state only when a provider operation needs one. Discovery reads every model (see `docs/openrouter.md`, Models), caches the list for ten minutes and exposes the cached list without fetching; a stale or failed list never stops startup. An invalid requested model is `UnknownModel`. Group models by author, the id prefix; the serving provider is known only from a response.

## Requests and errors

Send the routing settings and attribution headers in every chat request, and read usage and cost from responses without sending the deprecated `usage.include`. Classify failures once, at the provider boundary, by the table in `docs/openrouter.md`: 402 says to add credits or raise the key limit, 403 says the request was blocked, a 503 under routing restrictions is not retryable, and a 200 can still carry an error in its body or as a stream's last chunk. Keep bounded retries and timeouts at one layer and turn off the client library's own retries. Map upstream failures to safe errors without request bodies or secrets; log the status, `error.code` and `metadata.error_type`.

<!-- stacks:when stack=react-router -->
Over HTTP, add `errorTable` rows: `LlmNotConfigured` (503, not retryable), `UnknownModel` (400), `UpstreamUnavailable` (502, carrying its own `retryable` and a log-only `detail`) and `InvalidModelOutput` (502, not retryable, for structured output that fails its schema). The body stays `{ message, retryable }` as `failure()` builds it.
<!-- stacks:end -->
<!-- stacks:when stack=typescript-api -->
Add rows to `apiErrorTable`, with classes in `errorClasses` and responses in `apiErrors`: `LlmNotConfigured` (503), `UnknownModel` (400), `UpstreamUnavailable` (502, retryable), `UpstreamRejected` and `UpstreamCredits` (502, not retryable; the credits message says what to do) and `InvalidModelOutput` (502). A row's message and `retryable` are fixed, so split by retryability; the envelope stays `{ "error": { "tag", "message", "retryable" } }`. Annotate each endpoint that calls the model with them, and keep them out of `tagForStatus`.
<!-- stacks:end -->
<!-- stacks:when stack=typescript-cli -->
Add `errorTable` rows: `LlmNotConfigured` on the config exit code, `UnknownModel` on the usage exit code, and `UpstreamUnavailable` (retryable), `UpstreamRejected`, `UpstreamCredits` and `InvalidModelOutput` on one new upstream exit code, each with a fixed safe message.
<!-- stacks:end -->

Use Effect Config for the settings and typed upstream errors. With Effect AI, map `AiError` reasons once into the application's tagged errors, keep status and code in log-only detail, and map retryability exhaustively.

<!-- stacks:when with=effect -->
Drive retry and timeout tests with TestClock.
<!-- stacks:end -->

Before paid recorder or eval use, tell the user to set a credit limit on the key. Those commands stay opt-in and outside verification; never put a key in CI.

## Testing

Provider tests run real HTTP clients against the stub, never module mocks, on an ephemeral port (apps use fixed ports only for their end-to-end harness), with credentials isolated and provider URLs unreachable unless the test owns a stub. `docs/openrouter.md`, The stub, lists what to cover. Extend the stub when a client needs a field it lacks, with a case in `tests/openrouter-stub.test.ts`.

## Verify

`openrouter-stub` runs `tests/openrouter-stub.test.ts` with Vitest on Node, the runner all three stacks share. It fails when the stub drifts from the wire format the provider tests depend on.

## AGENTS.md

Add an `OpenRouter` section: the environment variables; the key is optional; tests use `tests/helpers/stub-openrouter.ts` and never call OpenRouter; `docs/openrouter.md` is the wire contract; live calls cost money, need a credit-limited key and stay out of verify and CI.

## Gotchas

Check provider and SDK peer ranges against the installed packages: `@effect/ai-openrouter` peers on the matching `effect` release, so install them together. Some SDKs read `OPENROUTER_API_KEY` and `OPENROUTER_BASE_URL` despite explicit constructor options; normalize invalid empty options at that boundary and record the workaround with a regression test. A provider's transitive validator doesn't change the project's schema conventions.
