// Proves the stub speaks OpenRouter's wire format, so tests that point a real client at it test
// something true. Plain fetch only: the stub must not depend on any client library.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { type StubOpenRouter, startStubOpenRouter } from "./helpers/stub-openrouter.js";

interface WireError {
  code: number;
  message: string;
  metadata?: unknown;
}
interface WireToolCall {
  type: string;
  function: { name: string; arguments: string };
}
interface Choice {
  finish_reason: string | null;
  delta?: { content?: string | null; tool_calls?: WireToolCall[] };
  message?: { role: string; content: string | null };
}
interface Completion {
  object: string;
  model: string;
  system_fingerprint?: unknown;
  choices?: Choice[];
  usage?: { prompt_tokens: number; completion_tokens: number; cost: number };
  error?: WireError;
}
interface ModelsPage {
  data: { id: string }[];
  total_count: number;
  links: { next: string | null };
}

let stub: StubOpenRouter;
beforeAll(async () => {
  stub = await startStubOpenRouter();
});
beforeEach(() => stub.reset());
afterAll(() => stub.close());

const auth = { authorization: "Bearer sk-or-stub", "content-type": "application/json" };

async function json<T>(response: Response | Promise<Response>): Promise<T> {
  return (await (await response).json()) as T;
}

function complete(body: Record<string, unknown>, headers: Record<string, string> = auth) {
  return fetch(`${stub.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "openai/gpt-test",
      messages: [{ role: "user", content: "hi" }],
      ...body,
    }),
  });
}

/** Every `data:` payload of an SSE body, parsed, plus whether comments and [DONE] appeared. */
function events(text: string) {
  const blocks = text.split("\n\n").filter((block) => block.length > 0);
  const data = blocks.filter((block) => block.startsWith("data: ")).map((b) => b.slice(6));
  return {
    comments: blocks.filter((block) => block.startsWith(":")).length,
    done: data.at(-1) === "[DONE]",
    chunks: data
      .filter((payload) => payload !== "[DONE]")
      .map((payload) => JSON.parse(payload) as Completion),
  };
}

async function streamed(body: Record<string, unknown> = {}) {
  return events(await (await complete({ ...body, stream: true })).text());
}

const choice = (completion: Completion | undefined) => completion?.choices?.[0];

describe("models", () => {
  test("the full list comes back when limit and offset are omitted", async () => {
    stub.models = Array.from({ length: 7 }, (_, index) => `author${index % 2}/model-${index}`);
    const response = await fetch(`${stub.baseUrl}/models?output_modalities=text`);
    expect(response.status).toBe(200);
    const body = await json<ModelsPage>(response);
    expect(body.total_count).toBe(7);
    expect(body.links.next).toBeNull();
    expect(body.data).toHaveLength(7);
    expect(body.data[0]).toMatchObject({
      id: "author0/model-0",
      canonical_slug: "author0/model-0",
      context_length: expect.any(Number),
      pricing: { prompt: expect.any(String), completion: expect.any(String) },
      architecture: { output_modalities: ["text"] },
      top_provider: { is_moderated: false },
      supported_parameters: expect.arrayContaining(["tools"]),
    });
  });

  test("pages follow links.next until it is null", async () => {
    stub.models = Array.from({ length: 5 }, (_, index) => `a/m-${index}`);
    const seen: string[] = [];
    let next: string | null = `${stub.baseUrl}/models?limit=2`;
    while (next) {
      const body: ModelsPage = await json<ModelsPage>(fetch(next));
      seen.push(...body.data.map((model) => model.id));
      next = body.links.next;
    }
    expect(seen).toEqual(stub.models);
  });
});

describe("chat completions", () => {
  test("a streamed reply has deltas, a fingerprint on every chunk, usage once, then [DONE]", async () => {
    stub.replies.push("one two three");
    const response = await complete({ stream: true });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const { comments, done, chunks } = events(await response.text());
    expect(comments).toBeGreaterThan(0);
    expect(done).toBe(true);
    for (const chunk of chunks) {
      expect(chunk.object).toBe("chat.completion.chunk");
      expect(typeof chunk.system_fingerprint).toBe("string");
      expect(chunk.model).toBe("openai/gpt-test");
    }
    const text = chunks.map((chunk) => choice(chunk)?.delta?.content ?? "").join("");
    expect(text).toBe("one two three");
    const withUsage = chunks.filter((chunk) => chunk.usage);
    expect(withUsage).toHaveLength(1);
    expect(chunks.at(-1)).toBe(withUsage[0]);
    expect(choice(withUsage[0])?.finish_reason).toBe("stop");
    expect(withUsage[0]?.usage).toMatchObject({
      prompt_tokens: expect.any(Number),
      completion_tokens: 3,
      cost: expect.any(Number),
    });
  });

  test("a non-streamed reply carries the message, finish reason and usage with cost", async () => {
    const body = await json<Completion>(complete({}));
    expect(body).toMatchObject({
      object: "chat.completion",
      system_fingerprint: expect.any(String),
      usage: { cost: expect.any(Number) },
    });
    expect(choice(body)).toMatchObject({
      finish_reason: "stop",
      message: { role: "assistant", content: expect.any(String) },
    });
  });

  test("a queued tool call is streamed once, then replies return to text", async () => {
    stub.toolCalls.push({ name: "currentTime", arguments: { timeZone: "UTC" } });
    const first = (await streamed()).chunks;
    const call = first.map((chunk) => choice(chunk)?.delta?.tool_calls?.[0]).find(Boolean);
    expect(call).toMatchObject({ type: "function", function: { name: "currentTime" } });
    expect(JSON.parse(call?.function.arguments ?? "")).toEqual({ timeZone: "UTC" });
    expect(choice(first.at(-1))?.finish_reason).toBe("tool_calls");
    const second = (await streamed()).chunks;
    expect(choice(second.at(-1))?.finish_reason).toBe("stop");
  });

  test("request bodies and headers are recorded for routing and attribution assertions", async () => {
    await complete(
      { models: ["anthropic/claude-test"], provider: { sort: "price", zdr: true } },
      { ...auth, "http-referer": "https://example.test", "x-openrouter-title": "Demo" },
    );
    expect(stub.chatRequests[0]).toMatchObject({
      models: ["anthropic/claude-test"],
      provider: { sort: "price", zdr: true },
    });
    expect(stub.chatHeaders[0]).toMatchObject({
      "http-referer": "https://example.test",
      "x-openrouter-title": "Demo",
    });
  });

  test("replay serves recorded bodies byte for byte, one per request, in small chunks", async () => {
    const recorded = `data: ${JSON.stringify({ object: "chat.completion.chunk", choices: [] })}\n\ndata: [DONE]\n\n`;
    stub.replay([recorded, recorded], { chunkSize: 7 });
    expect(await (await complete({ stream: true })).text()).toBe(recorded);
    expect(await (await complete({ stream: true })).text()).toBe(recorded);
    expect((await streamed()).done).toBe(true);
  });

  test("a queued served model imitates a fallback", async () => {
    stub.servedModels.push("anthropic/claude-test");
    expect((await json<Completion>(complete({}))).model).toBe("anthropic/claude-test");
  });
});

describe("failures", () => {
  test("no key is a 401 with OpenRouter's error body", async () => {
    const response = await complete({}, { "content-type": "application/json" });
    expect(response.status).toBe(401);
    expect((await json<Completion>(response)).error).toMatchObject({ code: 401 });
  });

  test("an unknown model is a 400", async () => {
    const response = await complete({ model: "nobody/nothing" });
    expect(response.status).toBe(400);
    expect((await json<Completion>(response)).error?.code).toBe(400);
  });

  test("failCompletions sends the status, Retry-After and metadata, then stops after times", async () => {
    stub.failCompletions(429, { retryAfter: 3, times: 1 });
    const failed = await complete({});
    expect(failed.status).toBe(429);
    expect(failed.headers.get("retry-after")).toBe("3");
    expect((await json<Completion>(failed)).error?.code).toBe(429);
    expect((await complete({})).status).toBe(200);

    stub.failCompletions(403, { metadata: { reasons: ["flagged"] } });
    for (let attempt = 0; attempt < 2; attempt++) {
      const blocked = await complete({});
      expect(blocked.status).toBe(403);
      expect((await json<Completion>(blocked)).error?.metadata).toEqual({ reasons: ["flagged"] });
    }
  });

  test("streamError ends a 200 stream with an error chunk and finish_reason error", async () => {
    stub.streamError(502, { afterDeltas: 1, message: "Provider returned error" });
    const response = await complete({ stream: true });
    expect(response.status).toBe(200);
    const { done, chunks } = events(await response.text());
    expect(done).toBe(false);
    expect(choice(chunks[0])?.delta?.content).toBe("Hello ");
    expect(chunks.at(-1)?.error).toMatchObject({ code: 502, message: "Provider returned error" });
    expect(choice(chunks.at(-1))?.finish_reason).toBe("error");
  });

  test("streamError on a non-streamed request is a 200 with error and no choices", async () => {
    stub.streamError(502);
    const response = await complete({});
    expect(response.status).toBe(200);
    const body = await json<Completion>(response);
    expect(body.error?.code).toBe(502);
    expect(body.choices).toBeUndefined();
  });

  test("dropAfter cuts the connection mid-stream", async () => {
    stub.dropAfter(1);
    const response = await complete({ stream: true });
    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toThrow();
  });

  test("hangAfter leaves the stream open until the client gives up", async () => {
    stub.hangAfter(1);
    const response = await complete({ stream: true });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("no body");
    let ended = false;
    const drain = async () => {
      while (!(await reader.read()).done);
      ended = true;
    };
    drain().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(ended).toBe(false);
    await reader.cancel();
  });
});
