// A local OpenRouter for tests and no-key development runs. It serves the models and
// chat-completions endpoints under /api/v1 in OpenRouter's wire format (docs: openrouter.ai/docs),
// records what it received, and can be scripted per test. It uses only node:http, so it runs under
// Vitest on Node and under Bun (scripts, Playwright web servers).
//
//   const stub = await startStubOpenRouter();   // ephemeral port; pass a fixed one for e2e
//   OPENROUTER_BASE_URL = stub.baseUrl          // http://127.0.0.1:<port>/api/v1
//   stub.toolCalls.push({ name: "currentTime", arguments: { timeZone: "UTC" } });
//   stub.failCompletions(429, { retryAfter: 1, times: 1 });
//   expect(stub.chatRequests[0]).toMatchObject({ models: ["a/b"] });
//   await stub.close();
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";

export interface ToolCall {
  readonly name: string;
  /** An object is sent as JSON; a string is sent as is (to test malformed arguments). */
  readonly arguments: Record<string, unknown> | string;
}

export interface FailOptions {
  readonly message?: string;
  /** Seconds, sent as Retry-After. OpenRouter sends it on some 429, 503 and 402 responses. */
  readonly retryAfter?: number;
  readonly metadata?: Record<string, unknown>;
  /** How many completions fail before replies resume. Default: every one until reset(). */
  readonly times?: number;
}

export interface StreamErrorOptions {
  readonly message?: string;
  /** Text deltas streamed before the error chunk. Default 0. */
  readonly afterDeltas?: number;
}

export interface StubOpenRouter {
  readonly port: number;
  /** The value for OPENROUTER_BASE_URL: the stub's /api/v1 root. */
  readonly baseUrl: string;
  /** Model ids /models lists and /chat/completions accepts. */
  models: string[];
  /** Parsed JSON bodies of every /chat/completions request, in order. */
  readonly chatRequests: Record<string, unknown>[];
  /** Lowercased headers of every /chat/completions request, aligned with chatRequests. */
  readonly chatHeaders: Record<string, string>[];
  /** Queued tool calls: each completion takes one and replies with it instead of text. */
  readonly toolCalls: ToolCall[];
  /** Queued reply texts; the default reply is used when empty. */
  readonly replies: string[];
  /** Queued served-model ids, to imitate a fallback; the requested model is served when empty. */
  readonly servedModels: string[];
  /** Fail completions with an HTTP error status and OpenRouter's error body. */
  failCompletions(status: number, options?: FailOptions): void;
  /** Next completion fails in band: an error chunk with finish_reason "error" on a 200 stream,
   *  or a 200 body with `error` and no `choices` when the request isn't streaming. */
  streamError(code: number, options?: StreamErrorOptions): void;
  /** Next streamed completion sends N text deltas, then drops the connection. */
  dropAfter(deltas: number): void;
  /** Next streamed completion sends N text deltas, then never finishes. */
  hangAfter(deltas: number): void;
  /** Next completions replay recorded SSE bodies (read them from tests/fixtures/openrouter/), one
   *  per request, optionally written in small chunks to exercise the client's stream parser. */
  replay(bodies: readonly string[], options?: { readonly chunkSize?: number }): void;
  /** Clear requests, queues and failures, and restore the default models. */
  reset(): void;
  close(): Promise<void>;
}

type Script =
  | {
      readonly kind: "in-band";
      readonly code: number;
      readonly message: string;
      readonly after: number;
    }
  | { readonly kind: "drop"; readonly after: number }
  | { readonly kind: "hang"; readonly after: number }
  | { readonly kind: "replay"; readonly body: string; readonly chunkSize: number };

interface Failure {
  readonly status: number;
  readonly options: FailOptions;
  remaining: number;
}

interface Reply {
  readonly id: string;
  readonly model: string;
  readonly text: string;
  readonly toolCall: ToolCall | undefined;
  readonly promptTokens: number;
}

export const DEFAULT_MODELS = ["openai/gpt-test", "anthropic/claude-test", "google/gemini-test"];
export const DEFAULT_REPLY = "Hello from the stub OpenRouter.";
// OpenRouter prices per token as decimal strings; usage cost below follows the same rates.
const PROMPT_PRICE = 0.000001;
const COMPLETION_PRICE = 0.000002;

const deltasOf = (text: string) => text.split(/(?<= )/).filter((part) => part.length > 0);

export function modelRecord(id: string, baseUrl: string) {
  const [author = id] = id.split("/");
  return {
    id,
    canonical_slug: id,
    name: `${author}: ${id.slice(author.length + 1) || id}`,
    created: 1_700_000_000,
    description: `Stub model ${id}`,
    context_length: 128_000,
    architecture: {
      input_modalities: ["text"],
      output_modalities: ["text"],
      modality: "text->text",
      tokenizer: "Other",
      instruct_type: null,
    },
    pricing: { prompt: String(PROMPT_PRICE), completion: String(COMPLETION_PRICE) },
    top_provider: { context_length: 128_000, max_completion_tokens: 16_384, is_moderated: false },
    per_request_limits: null,
    supported_parameters: ["max_tokens", "temperature", "tools", "tool_choice", "response_format"],
    default_parameters: null,
    supported_voices: null,
    endpoints: ["/api/v1/chat/completions"],
    links: { details: `${baseUrl}/models/${id}/endpoints` },
  };
}

function modelsPage(url: URL, models: readonly string[], baseUrl: string) {
  const data = models.map((id) => modelRecord(id, baseUrl));
  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");
  // The real endpoint returns the full list when both are omitted.
  if (limitParam === null && offsetParam === null)
    return { data, total_count: data.length, links: { next: null } };
  const limit = Math.min(Math.max(Number(limitParam ?? 500) || 500, 1), 1000);
  const offset = Math.max(Number(offsetParam ?? 0) || 0, 0);
  const end = offset + limit;
  const next = end < data.length ? `${baseUrl}/models?offset=${end}&limit=${limit}` : null;
  return { data: data.slice(offset, end), total_count: data.length, links: { next } };
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, options: FailOptions = {}) {
  const error = {
    code: status,
    message: options.message ?? `Stub OpenRouter error ${status}`,
    ...(options.metadata ? { metadata: options.metadata } : {}),
  };
  const headers =
    options.retryAfter === undefined ? {} : { "retry-after": String(options.retryAfter) };
  sendJson(res, status, { error }, headers);
}

function usage(reply: Reply, completionTokens: number) {
  const cost = reply.promptTokens * PROMPT_PRICE + completionTokens * COMPLETION_PRICE;
  return {
    prompt_tokens: reply.promptTokens,
    completion_tokens: completionTokens,
    total_tokens: reply.promptTokens + completionTokens,
    cost: Number(cost.toFixed(9)),
    prompt_tokens_details: { cached_tokens: 0 },
    completion_tokens_details: { reasoning_tokens: 0 },
    // Strict clients require the prompt/completions split whenever cost_details is present.
    cost_details: {
      upstream_inference_cost: null,
      upstream_inference_prompt_cost: 0,
      upstream_inference_completions_cost: 0,
    },
  };
}

// error.metadata.error_type takes OpenRouter's canonical values; strict clients reject others.
function errorType(code: number) {
  const types: Record<number, string> = {
    400: "invalid_request",
    401: "authentication",
    402: "payment_required",
    403: "content_policy_violation",
    404: "not_found",
    408: "timeout",
    429: "rate_limit_exceeded",
    502: "provider_unavailable",
    503: "provider_unavailable",
  };
  return types[code] ?? "server";
}

const inBandError = (code: number, message: string) => ({
  code,
  message,
  metadata: { error_type: errorType(code) },
});

function toolCallWire(call: ToolCall, id: string) {
  const args = typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments);
  return {
    index: 0,
    id: `call_${id}`,
    type: "function",
    function: { name: call.name, arguments: args },
  };
}

// Every chunk carries a string system_fingerprint: some clients (@effect/ai-openrouter) decode
// strictly and reject a chunk without one.
function chunk(reply: Reply, choice: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id: reply.id,
    provider: "Stub",
    model: reply.model,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    system_fingerprint: "fp_stub",
    choices: [
      { index: 0, logprobs: null, finish_reason: null, native_finish_reason: null, ...choice },
    ],
    ...extra,
  };
}

const sse = (res: ServerResponse, data: unknown) =>
  res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);

function streamHead(res: ServerResponse) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  // OpenRouter sends SSE comments to keep connections open; clients must skip them.
  res.write(": OPENROUTER PROCESSING\n\n");
}

function streamDeltas(res: ServerResponse, reply: Reply, count: number) {
  const parts = deltasOf(reply.text).slice(0, count);
  for (const content of parts) sse(res, chunk(reply, { delta: { role: "assistant", content } }));
  return parts.length;
}

function streamReply(res: ServerResponse, reply: Reply, script: Script | undefined) {
  streamHead(res);
  if (script?.kind === "drop" || script?.kind === "hang") {
    streamDeltas(res, reply, script.after);
    // Drop only after the deltas reach the socket, so the client sees a partial stream.
    if (script.kind === "drop") res.write("", () => res.destroy());
    return;
  }
  if (script?.kind === "in-band") {
    streamDeltas(res, reply, script.after);
    const failed = {
      delta: { content: "" },
      finish_reason: "error",
      native_finish_reason: "error",
    };
    sse(res, chunk(reply, failed, { error: inBandError(script.code, script.message) }));
    res.end();
    return;
  }
  let completionTokens: number;
  let finish: string;
  if (reply.toolCall) {
    const call = toolCallWire(reply.toolCall, reply.id);
    sse(res, chunk(reply, { delta: { role: "assistant", content: null, tool_calls: [call] } }));
    completionTokens = 10;
    finish = "tool_calls";
  } else {
    completionTokens = streamDeltas(res, reply, Number.POSITIVE_INFINITY);
    finish = "stop";
  }
  const done = {
    delta: { role: "assistant", content: "" },
    finish_reason: finish,
    native_finish_reason: finish,
  };
  sse(res, chunk(reply, done));
  // Usage arrives once, on a final accounting chunk that repeats the finish reason.
  sse(res, chunk(reply, done, { usage: usage(reply, completionTokens) }));
  sse(res, "[DONE]");
  res.end();
}

function completeReply(res: ServerResponse, reply: Reply, script: Script | undefined) {
  const base = {
    id: reply.id,
    provider: "Stub",
    model: reply.model,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    system_fingerprint: "fp_stub",
  };
  if (script?.kind === "in-band") {
    sendJson(res, 200, { ...base, error: inBandError(script.code, script.message) });
    return;
  }
  const call = reply.toolCall ? toolCallWire(reply.toolCall, reply.id) : undefined;
  const message = call
    ? {
        role: "assistant",
        content: "",
        refusal: null,
        reasoning: null,
        tool_calls: [{ id: call.id, type: call.type, function: call.function }],
      }
    : { role: "assistant", content: reply.text, refusal: null, reasoning: null };
  const finish = call ? "tool_calls" : "stop";
  const completionTokens = call ? 10 : deltasOf(reply.text).length;
  sendJson(res, 200, {
    ...base,
    choices: [
      { index: 0, logprobs: null, finish_reason: finish, native_finish_reason: finish, message },
    ],
    usage: usage(reply, completionTokens),
  });
}

async function writeReplay(res: ServerResponse, script: Extract<Script, { kind: "replay" }>) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const bytes = Buffer.from(script.body, "utf8");
  for (let at = 0; at < bytes.length; at += script.chunkSize) {
    res.write(bytes.subarray(at, at + script.chunkSize));
    // Yield between chunks so the client sees them as separate reads.
    await new Promise((resolve) => setImmediate(resolve));
  }
  res.end();
}

async function readBody(req: IncomingMessage) {
  const parts: Buffer[] = [];
  for await (const part of req)
    parts.push(Buffer.isBuffer(part) ? part : Buffer.from(String(part)));
  return Buffer.concat(parts).toString("utf8");
}

function headerRecord(req: IncomingMessage) {
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers))
    if (value !== undefined) record[key] = Array.isArray(value) ? value.join(", ") : value;
  return record;
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === "object" && value !== null && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    // Fall through: the caller answers 400.
  }
  return undefined;
}

export async function startStubOpenRouter(port = 0): Promise<StubOpenRouter> {
  let failure: Failure | undefined;
  let scripts: Script[] = [];
  let counter = 0;
  const sockets = new Set<Socket>();

  const takeReply = (body: Record<string, unknown>, stub: StubOpenRouter): Reply => {
    counter += 1;
    const requested = typeof body.model === "string" ? body.model : "";
    const messages = Array.isArray(body.messages) ? body.messages : [];
    return {
      id: `gen-stub-${counter}`,
      model: stub.servedModels.shift() ?? requested,
      text: stub.replies.shift() ?? DEFAULT_REPLY,
      toolCall: stub.toolCalls.shift(),
      promptTokens: 10 * Math.max(messages.length, 1),
    };
  };

  const rejectRequest = (
    req: IncomingMessage,
    body: Record<string, unknown> | undefined,
    stub: StubOpenRouter,
  ) => {
    const auth = req.headers.authorization ?? "";
    if (!/^Bearer \S+/.test(auth)) return { status: 401, message: "Missing Authentication header" };
    if (!body || !Array.isArray(body.messages))
      return { status: 400, message: "Invalid request: expected a JSON body with messages" };
    if (typeof body.model !== "string" || !stub.models.includes(body.model))
      return { status: 400, message: `${String(body.model)} is not a valid model ID` };
    return undefined;
  };

  const takeFailure = () => {
    if (!failure || failure.remaining <= 0) return undefined;
    failure.remaining -= 1;
    return failure;
  };

  const completions = async (req: IncomingMessage, res: ServerResponse, stub: StubOpenRouter) => {
    const body = parseObject(await readBody(req));
    stub.chatRequests.push(body ?? {});
    stub.chatHeaders.push(headerRecord(req));
    const rejected = rejectRequest(req, body, stub);
    if (rejected || !body) {
      sendError(res, rejected?.status ?? 400, { message: rejected?.message });
      return;
    }
    const failing = takeFailure();
    if (failing) {
      sendError(res, failing.status, failing.options);
      return;
    }
    const script = scripts.shift();
    if (script?.kind === "replay") {
      await writeReplay(res, script);
      return;
    }
    const reply = takeReply(body, stub);
    if (body.stream === true) streamReply(res, reply, script);
    else completeReply(res, reply, script);
  };

  const server = createServer();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const actual = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${actual}/api/v1`;

  const stub: StubOpenRouter = {
    port: actual,
    baseUrl,
    models: [...DEFAULT_MODELS],
    chatRequests: [],
    chatHeaders: [],
    toolCalls: [],
    replies: [],
    servedModels: [],
    failCompletions(status, options = {}) {
      failure = { status, options, remaining: options.times ?? Number.POSITIVE_INFINITY };
    },
    streamError(code, options = {}) {
      const message = options.message ?? `Stub OpenRouter error ${code}`;
      scripts.push({ kind: "in-band", code, message, after: options.afterDeltas ?? 0 });
    },
    dropAfter(deltas) {
      scripts.push({ kind: "drop", after: deltas });
    },
    hangAfter(deltas) {
      scripts.push({ kind: "hang", after: deltas });
    },
    replay(bodies, options = {}) {
      for (const body of bodies)
        scripts.push({
          kind: "replay",
          body,
          chunkSize: Math.max(options.chunkSize ?? body.length, 1),
        });
    },
    reset() {
      failure = undefined;
      scripts = [];
      stub.models = [...DEFAULT_MODELS];
      for (const list of [
        stub.chatRequests,
        stub.chatHeaders,
        stub.toolCalls,
        stub.replies,
        stub.servedModels,
      ])
        list.length = 0;
    },
    close() {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };

  server.on("request", (req, res) => {
    const url = new URL(req.url ?? "/", baseUrl);
    if (req.method === "GET" && url.pathname === "/api/v1/models") {
      sendJson(res, 200, modelsPage(url, stub.models, baseUrl));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/v1/chat/completions") {
      completions(req, res, stub).catch(() => {
        if (!res.headersSent) sendError(res, 500);
        else res.destroy();
      });
      return;
    }
    sendError(res, 404, { message: "Not Found" });
  });
  return stub;
}
