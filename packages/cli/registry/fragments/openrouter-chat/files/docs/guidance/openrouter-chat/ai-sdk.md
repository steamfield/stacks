# AI SDK boundary

## Who owns what in a chat request

- **Effect owns everything before `streamText`**: content-type check, body decode, key configured, limits, model resolution, taking a stream slot, loading history. Failures here are HTTP errors through `runRoute`.
- **The AI SDK owns the stream.** Its built-in retries cover opening it. Pass an abort signal combining the request's signal with a timeout for the max stream duration. Upstream errors after the response starts arrive inside the stream: map them to user-safe text in the stream response's error handler.
- **Work that outlives the Response** (releasing the stream slot exactly once, saving messages, the request log line) runs from the SDK's end-of-stream, error, and abort callbacks through `Effect.runForkWith` on the context captured before the stream (`yield* Effect.context<never>()`), because the request's Effect has already finished. Abort includes a client disconnect.

Don't wrap `streamText` in `Effect.retry` or `Effect.timeout`: it doesn't throw on upstream failure, so the retry never fires, and if it did it would stack with the SDK's own retries.

A failed stream rejects `result.text` with `NoOutputGeneratedError`; the real `APICallError` (with its status) reaches only `onError`, so the status-mapping test collects errors from `onError`.

## APIs change between majors

Read the installed package's type definitions before writing against it (`node_modules/ai/dist/*.d.ts`, `node_modules/@ai-sdk/react/dist/*.d.ts`). Older examples use names that were renamed, deprecated or removed: `useChat` input helpers, `maxSteps`, `stepCountIs` (now `isStepCount`), tool `parameters`, `toDataStreamResponse`, the result's `toUIMessageStreamResponse` (now `toUIMessageStream` plus `createUIMessageStreamResponse` over `result.stream`), `generateObject`, `system` (now `instructions`), `onFinish` (now `onEnd`). If something is marked deprecated, use its replacement.

Shapes the installed types enforce that older examples get wrong: mock-model usage is nested (`inputTokens: { total, noCache, cacheRead, cacheWrite }`, `outputTokens: { total, text, reasoning }`) and `finishReason` is `{ unified, raw }`; `tool.execute`'s options carry the tool's own `context`, which the call supplies through `toolsContext` (`runtimeContext` is the separate call-level context), so unit tests pass one; Effect's `Config.fail` takes a `ConfigError`, not a string.

## Messages and metadata

- The client sends only the new message; the server appends it to stored history.
- Message metadata (usage, cost, interrupted) has one schema in `app/schemas/`, shared by server and client. If you validate incoming UI messages with the SDK's validator, the metadata schema must accept `undefined` (user messages have none).
- Usage and cost come from each step's finish part, not the final one. Collect across steps, attach on finish, and return nothing from the metadata hook on other parts.

## Tools and structured output

- Tool input and structured-output schemas are Effect Schemas converted to draft-07 by `toAiSchema` (`Schema.toJsonSchemaDocument`, which emits draft 2020-12, then `JsonSchema.toDocumentDraft07`; closed objects) and passed through the SDK's JSON Schema helper, with a validate function built on the schema's decoder. Use `title`/`description` annotations, not `identifier` (it produces a `$ref`).
- Decode structured output with the same schema before returning it; a failed decode is `InvalidModelOutput`.
- Tools are small, deterministic where possible, and have their own tests. Cap tool steps from Config.
