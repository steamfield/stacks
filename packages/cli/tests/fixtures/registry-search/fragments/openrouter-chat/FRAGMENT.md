---
schema_version: 1
id: openrouter-chat
kind: fragment
category: app
name: OpenRouter web chat for React Router
description: "A web chat app on OpenRouter: streaming replies, a model picker, tool calls, contact extraction, server-side history, usage and cost, Markdown export and a stub-backed Playwright flow, with Claude Code, Codex, OpenCode and Cursor guidance."
tags: [typescript, web, ai, openrouter]
applies_to: [react-router]
requires: [openrouter-ai]
deps:
  app: [ai, "@ai-sdk/react", "@openrouter/ai-sdk-provider", "@openrouter/sdk", "@fontsource-variable/inter", "@fontsource-variable/jetbrains-mono"]
tools: [bun, node]
merge: [.claude/settings.json]
decisions:
  - "Chat storage: an in-memory Map (default), or SQLite behind the same service when restart persistence is needed; if its driver needs a native build, add it to trustedDependencies so bun runs its install script."
  - "Authentication: none (default); document URL-based chat access and defer auth behind rateLimitKey and a future CurrentUser service."
verify:
  - { name: app-e2e, layer: test, run: bun run e2e:app }
  - { name: app-acceptance, layer: test, run: bun run test tests/app-acceptance.test.ts }
  - { name: app-eval-dry-run, layer: test, run: bun scripts/check-eval-dry-run.ts }
  - name: app-styling-plugin
    layer: check
    run: "grep -q 'biome-plugins/styling.grit' biome.json"
commands:
  e2e:app: Build and run only the stub-backed chat browser flow
---

# OpenRouter web chat

Implement `scripts/eval.ts` with `--dry-run --models <csv> --report <path>` per
`docs/eval-report.md`; cases live in `evals/cases.ts` and pure scoring in `evals/score.ts`.
Verify runs the shipped independent checkpoint, `scripts/check-eval-dry-run.ts` (with
`scripts/lib/eval-report.ts`); keep both unchanged. The shipped `.eval/.gitignore` keeps
reports out of git. Keep the runner, scoring and real app calls agent-owned.

Read `docs/guidance/openrouter-chat/index.md` before implementation; it supplies the shared guidance for every selected agent.

Implement the assertions in `docs/acceptance/openrouter-chat.md`: verify runs the authored acceptance suite separately, plus a stub-only eval dry run. The suite must check recorder/eval no-key refusal, stub plumbing, export metadata and the route/UI state matrix. Live recording/eval remain manual; never fabricate paid fixtures.

Build this application after the base health slice passes. Read DESIGN.md and the shared app guidance before implementation, and `docs/chat-turn.md` before working on the chat route. Preserve the base runtime, error contract, development scripts, and health route. Add application dependencies and scripts to shared configuration, update README/AGENTS and the stack-owned .env.example, and add `./biome-plugins/styling.grit` to `plugins` in `biome.json` (the `app-styling-plugin` step checks it). Verify provider/AI SDK peer compatibility and use installed types for API details.

## Routes, services, and UI

`/` redirects to `/c/<random UUID>`. `app/routes/chat.tsx` loads server history and whether a key is configured; the page renders even if models are unreachable. Resource routes are `api.chat.ts`, `api.models.ts`, `api.extract.ts`, and `api.chats.$chatId.export.ts`; `/extract` has a small form. Use thin runRoute/runData boundaries. Add server programs chat, chat-options, models, openrouter, export, extract, prompts, and tool/schema modules. Services are Llm, OpenRouter, ChatStore, RateLimiter, and StreamSlots with static real/test layers.

Keep messages on the server: the client sends only the new user message and selected model. Validate ids and payloads, truncate history on regenerate, and enforce MAX_MESSAGES including the new reply. ChatStore get/save persists the complete list after each turn; preserve partial replies with interrupted metadata on abort or disconnect. Use fresh memory layers in tests, retain development state across hot reload, and document that unowned chat URLs grant access. SQLite, if selected, uses the same service interface.

Build the chat, message list, MessageParts, tool-step, composer, model-picker, and export-actions components. Shared page-header, prompt-card, error-row, and KeyNotice serve chat and extraction. The shadcn searchable Command combobox groups models by author (the id prefix; the serving provider comes only from a response); when discovery fails, show the configured default. OPENROUTER_MODEL applies only when no model was requested; unknown explicit ids produce UnknownModel.

With no key, show a muted accessible notice explaining configuration; disable sending and connect the input to the notice with aria-describedby. This state is not an alert. Show errors inline with Retry only when retryable, Stop during streaming, and interrupted status immediately after stopping. Tool rows have pending/done/failed state, label, and detail; maintain ChatTools and explicit tool-part rendering, ignoring unknown parts. Avoid animation on history loaded from the server.

## Streaming, limits, metadata

Effect owns pre-stream work: JSON content type, schema decoding, key, input/message/output/tool limits, model resolution, rate limiting, stream-slot acquisition, and history loading. RateLimiter is a token bucket, never a fixed window; rateLimitKey initially returns global. Apply it to chat and extract. StreamSlots independently caps concurrent replies. RateLimited is 429 with Retry-After; release slots on every completion/failure/abort.

The AI SDK owns the stream. Spread `chatModelOptions(config, deps)` (prompt, tools, step limit, output cap) and combine request cancellation with the max-duration signal. Do not wrap streaming in Effect retry/timeout: SDK retries apply only to opening it. After streaming begins, errors travel inside the stream through userSafeStreamError as JSON ErrorBody; errorFrom handles both HTTP bodies and stream errors and decodes ErrorBody leniently: a missing `retryable` means true, since nothing says Retry can't help. Unwrap retry wrappers, map upstream errors using openrouter-ai, and log upstreamErrorDetail without leaking secrets. Allow undefined metadata for user messages when validating message history.

Work that outlives the returned Response (releasing the stream slot exactly once, saving messages, the chat-request log line) runs from the SDK's end, error, and abort callbacks, forked with `Effect.runForkWith` on the context captured with `Effect.context` before the stream starts, so it keeps the request's log annotations. Every forked program ends by logging its cause, and callbacks typed to return void or a promise must not return the fiber.

Collect usage and cost from each step's finish metadata, including the actual served model/provider, then attach totals as typed assistant-message metadata. Emit metadata chunks only when intended; the final SDK finish part may contain only token totals. fallbackDetector uses an already-cached canonical model list and counts only a configured fallback distinct from the requested model; aliases, auto routing, and free variants do not imply fallback. Show provider, tokens, cost, and fallback markers below each reply, wrapping by item on narrow screens. Log one chat-request line with chat id, requested/served model, provider, fallback, first-token latency, tokens, cost, finish reason, and aborted flag under the request id.

Add SYSTEM_PROMPT, MAX_INPUT_CHARS, MAX_MESSAGES, MAX_OUTPUT_TOKENS, MAX_TOOL_STEPS, MAX_STREAM_SECONDS, RATE_LIMIT_CAPACITY, RATE_LIMIT_REFILL_PER_MINUTE, and MAX_CONCURRENT_STREAMS to config/env docs. Document key credit limits under Pending user actions.

## Tools, extraction, and export

Use `makeTools(deps)` and explicit ToolDeps captured from the runtime, with a deterministic currentTime tool taking an IANA time zone. `toAiSchema` converts Effect schemas into closed draft-07 schemas (`Schema.toJsonSchemaDocument`, then `JsonSchema.toDocumentDraft07`) plus the same decoder wrapped in the AI SDK schema helper. Standard Schema alone cannot describe a model tool. Give descriptions before refinements, avoid reference-producing identifiers, and pin actual generated tool/output schemas in tests against the installed API.

Extract Contact from free text using the installed SDK's structured-output API, decode the result again, and map invalid output to InvalidModelOutput. extractContact returns contact plus usage/provider/model for evals; the route returns only contact. Nonstreaming retry/timeout is bounded, retries only retryable errors, and is clock-tested.

Export stored chats as Markdown with role headings, text, quoted tool calls, requested/served model, provider, finish reason, input/output tokens, cost and interruption metadata. Bad ids are 400; empty/missing chats 404. After a reply exists, show segmented Export download and Copy as Markdown controls, disabled while streaming. Copy fetches the same route, preserves Safari's gesture via ClipboardItem with a promise, falls back to writeText, and reports copied/failure visibly.

## Test harness and paid tools

Unit tests never use external services. `makeTestLayer` supplies real config parsing, fresh stores/limits/slots, a real local OpenRouter client, and an injected AI SDK mock language model. `useTestRuntime` swaps/disposes the route runtime; `toolCallReply` builds mock replies. Assert two layer builds share no state.

The required closed-loop test renders chat, routes transport fetch into the real api.chat action (build a Node `Request` from `new URL(input, "http://localhost")` and call the action directly), types a message, and sees streamed text plus tool result in the DOM; wrap router links in a routes stub. This test guards SDK stream/client compatibility.

Cover route statuses and retryable flags, no key, malformed/non-JSON input, unknown model, rate/concurrency limits, invalid runtime config, tool/output schemas, error mapping, persistence after success/abort, and structured-output retry. Test token-bucket refill and no double boundary burst with TestClock. Exercise real provider request shapes against the shipped `startStubOpenRouter`, including routing, attribution headers, usage and cost read from responses, 401/402/403/429/5xx, in-band errors (`streamError`) and fallback detection (`servedModels`). UI tests cover model discovery failure, accessible no-key states, errors, export failures/busy/clipboard fallbacks, tool and interrupted states.

Playwright's app-e2e uses one worker and two owned servers, fixed ports 5180 for the production app and 5181 for the stub. No development .env is loaded: set a dummy key and local provider URL explicitly. e2e/stub-server.ts runs `startStubOpenRouter(5181)` from `tests/helpers/stub-openrouter.ts`. One flow in `e2e/chat.spec.ts` opens /, lands on /c/<uuid>, sends, sees reply/usage, reloads persisted content after hydration, then downloads export. Fail on browser pageerrors and console errors. Retain traces/reports on failure. Add an `e2e:app` script that builds and runs only that spec; the stack's `e2e` step already runs every spec, so the app step doesn't repeat the whole suite.

Scripts share `chatModelOptions` and a fresh script layer with terminal-only logging, no startup line, fresh ConfigProvider, and disposal. The recorder runs a local tee proxy on `OPENROUTER_BASE_URL` (the Llm layer takes no `fetch`) and keeps actual response bodies (never headers) for one plain reply and both requests of a two-step tool turn, validates successful stop/text/tool execution before replacing fixtures, and writes metadata with requested/served models and time. Replay sends fixtures whole and in seven-byte chunks (`stub.replay(bodies, { chunkSize: 7 })`) through the real provider and chat route; derive expected values from fixture SSE so rerecording changes no assertions. Missing fixtures produce an explicit skip and Pending user actions item, not a fabricated recording.

Evals call real chat/extract programs one case/model at a time with deadlines. Case ids are exactly `currentTime`, `concise-answer` and `extract` (the checkpoint requires them); report pass/fail/error/truncated, finish reason, latency, tokens, cost, provider, served model, and per-model totals/median. Write timestamped JSON, fail on any failed/errored case or no passing cases, and unit-test pure scoring plus recording validation. Add `eval` and `record:openrouter` scripts. Live eval and recording require a paid key and stay outside check, verify and CI. Only `eval --dry-run` runs automatically: it owns a local stub, needs no key, and validates the same runner/scoring/report contract before returning success.

<!-- stacks:when with=ci-github -->
CI runs the app browser flow against stubs, installs Chromium system dependencies, and uploads failure artifacts. Keep real provider credentials absent. Include scripts and eval source in typechecking without executing paid commands.
<!-- stacks:end -->

## Design and adapter

Follow the shipped DESIGN.md, styling.grit, design-slop guidance (`docs/guidance/openrouter-chat/design-slop.md`, also Claude's `frontend-design-slop` skill), and app rules for layout and states; install the local font packages. Configure current Biome/Tailwind syntax, preserving style diagnostics. Biome must lint `app/components/ui/`: the styling plugin checks generated shadcn components' motion, so each one you add needs a pass. If a class-merging utility confuses custom text sizes with colors, use recognized size names. The app owns the add-route, add-tool and add-service workflows (`docs/guidance/openrouter-chat/workflows.md`, also Claude commands); update their references if implementation names differ. Record the installed AI SDK/schema boundary in `docs/guidance/effect/api.md` when the effect fragment is selected. Update base documentation after the application phase, including no-auth access, spend controls, commands, and debugging queries.
