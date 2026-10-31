import { Effect, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { args, useTestRuntime } from "../../tests/helpers/runtime";
import { loader as healthLoader } from "../routes/healthz";
import { action, loader } from "../routes/home";
import { ErrorBody, GreetingData } from "../schemas/greeting";
import {
  BadInput,
  errorTable,
  NotFound,
  PayloadTooLarge,
  Unavailable,
  UnsupportedMediaType,
} from "./errors";
import { runData, runRoute } from "./http";

async function envelope(response: Response, status: number, message: string, retryable: boolean) {
  expect(response.status).toBe(status);
  expect(response.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body: unknown = await response.json();
  expect(Schema.decodeUnknownSync(ErrorBody)(body)).toEqual({ message, retryable });
}
const post = (body: string, contentType = "application/json") =>
  new Request("http://test.local/", {
    method: "POST",
    body,
    headers: { "content-type": contentType },
  });
async function rejectedResponse(run: Promise<unknown>) {
  try {
    await run;
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
  throw new Error("Expected a thrown error Response");
}

describe("real loaders, action and Effect runtime", () => {
  it("loads config and health, returns ids and emits one debug record per health call", async () => {
    const { records } = useTestRuntime({ GREETING: "Welcome" });
    const result = await loader(args(new Request("http://test.local/")));
    expect(Schema.decodeUnknownSync(GreetingData)(result.data)).toEqual({
      message: "Welcome, world!",
    });
    const response = await healthLoader(
      args(
        new Request("http://test.local/healthz", { headers: { "x-request-id": "caller_123" } }),
        "/healthz",
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("x-request-id")).toBe("caller_123");
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({
      msg: "request",
      level: "debug",
      path: "/healthz",
      method: "GET",
      status: 200,
      requestId: "caller_123",
      durationMs: expect.any(Number),
    });
  });
  it.each(["application/json", "application/x-www-form-urlencoded"])(
    "greets through the action using %s",
    async (type) => {
      const { records } = useTestRuntime();
      const body = type === "application/json" ? '{"name":"Ada"}' : "name=Ada";
      const result = await action(args(post(body, type)));
      expect(result.data).toEqual({ message: "Hello, Ada!" });
      expect(new Headers(result.init?.headers).get("x-request-id")).toBeTruthy();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ msg: "request", method: "POST", status: 200 });
    },
  );
  it.each([
    '{"name":7}',
    '{"name":""}',
    '{"name":"   "}',
    '{"name":"Ada","extra":true}',
    "{broken",
    JSON.stringify({ name: "x".repeat(65) }),
  ])("rejects invalid payload %s", async (body) => {
    useTestRuntime();
    await envelope(
      await rejectedResponse(action(args(post(body)))),
      400,
      "Invalid request.",
      false,
    );
  });
  it("accepts the name length limit and rejects unsupported media", async () => {
    useTestRuntime();
    expect((await action(args(post(JSON.stringify({ name: "x".repeat(64) }))))).data.message).toBe(
      `Hello, ${"x".repeat(64)}!`,
    );
    await envelope(
      await rejectedResponse(action(args(post("Ada", "text/plain")))),
      415,
      "Unsupported content type.",
      false,
    );
  });
  for (const ErrorClass of [
    BadInput,
    NotFound,
    UnsupportedMediaType,
    Unavailable,
    PayloadTooLarge,
  ]) {
    it(`maps ${new ErrorClass()._tag} for resources and page data`, async () => {
      useTestRuntime();
      const row = errorTable[new ErrorClass()._tag];
      const program = Effect.fail(new ErrorClass());
      const request = new Request("http://test.local/");
      await envelope(await runRoute(request, program), row.status, row.message, row.retryable);
      await envelope(
        await rejectedResponse(runData(request, program)),
        row.status,
        row.message,
        row.retryable,
      );
    });
  }
  it("logs a defect once with correlated safe fields and no secret message", async () => {
    const { records } = useTestRuntime();
    const response = await runRoute(
      new Request("http://test.local/?secret=PRIVATE_SENTINEL"),
      Effect.die(new TypeError("PRIVATE_SENTINEL")),
    );
    await envelope(response, 500, "Internal server error.", true);
    expect(records).toHaveLength(2);
    expect(records.filter((record) => record.msg === "defect")).toHaveLength(1);
    expect(records[0]?.error).toMatchObject({ class: "TypeError", stack: expect.any(Array) });
    for (const record of records)
      expect(record.requestId).toBe(response.headers.get("x-request-id"));
    expect(JSON.stringify(records)).not.toContain("PRIVATE_SENTINEL");
  });
  it("returns a retryable cancellation and still records the completed request", async () => {
    const { records } = useTestRuntime();
    const controller = new AbortController();
    const result = runRoute(
      new Request("http://test.local/", { signal: controller.signal }),
      Effect.never,
    );
    controller.abort();
    await envelope(await result, 503, "Service unavailable.", true);
    expect(records.filter((record) => record.msg === "request")).toHaveLength(1);
  });
  it("reports invalid runtime configuration as a safe response and logs its failure", async () => {
    useTestRuntime({ LOG_LEVEL: "PRIVATE_SENTINEL" });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await envelope(
        await healthLoader(args(new Request("http://test.local/healthz"), "/healthz")),
        500,
        "Internal server error.",
        true,
      );
      const lines = stderr.mock.calls.map(([line]) => String(line));
      expect(lines.join("")).toContain('"msg":"defect"');
      expect(lines.join("")).not.toContain("PRIVATE_SENTINEL");
    } finally {
      stderr.mockRestore();
    }
  });
  it("replaces unsafe caller ids", async () => {
    useTestRuntime();
    const response = await runRoute(
      new Request("http://test.local/", { headers: { "x-request-id": "unsafe id" } }),
      Effect.succeed({ ok: true }),
    );
    expect(response.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(response.headers.get("x-request-id")).not.toBe("unsafe id");
  });
  it("preserves streaming and download Responses and logs their actual status", async () => {
    const { records } = useTestRuntime();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello stream"));
        controller.close();
      },
    });
    const streamed = await runRoute(
      new Request("http://test.local/"),
      Effect.succeed(
        new Response(stream, { status: 202, headers: { "content-type": "text/event-stream" } }),
      ),
    );
    expect(streamed.status).toBe(202);
    expect(streamed.headers.get("content-type")).toBe("text/event-stream");
    expect(await streamed.text()).toBe("hello stream");
    const download = await runRoute(
      new Request("http://test.local/"),
      Effect.succeed(
        new Response("# Export", {
          headers: {
            "content-type": "text/markdown",
            "content-disposition": 'attachment; filename="export.md"',
            "cache-control": "private",
          },
        }),
      ),
    );
    expect(download.headers.get("content-disposition")).toContain("export.md");
    expect(download.headers.get("cache-control")).toBe("private");
    expect(await download.text()).toBe("# Export");
    expect(
      records.filter((record) => record.msg === "request").map((record) => record.status),
    ).toEqual([202, 200]);
  });
  it("maps response encoding defects before logging a successful status", async () => {
    const { records } = useTestRuntime();
    await envelope(
      await runRoute(new Request("http://test.local/"), Effect.succeed({ value: 1n })),
      500,
      "Internal server error.",
      true,
    );
    expect(records.filter((record) => record.msg === "defect")).toHaveLength(1);
    expect(records.filter((record) => record.msg === "request")).toEqual([
      expect.objectContaining({ status: 500 }),
    ]);
  });
  it.each(["application/json", "application/x-www-form-urlencoded"])(
    "bounds %s bytes, including a chunked body",
    async (type) => {
      useTestRuntime({ MAX_BODY_BYTES: "32" });
      const exact =
        type === "application/json" ? `${" ".repeat(18)}{"name":"Ada"}` : `name=${"x".repeat(27)}`;
      expect(new TextEncoder().encode(exact).length).toBe(32);
      expect((await action(args(post(exact, type)))).data.message).toMatch(/^Hello,/);
      const bytes = new TextEncoder().encode(`${exact} `);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, 16));
          controller.enqueue(bytes.slice(16));
          controller.close();
        },
      });
      const init = {
        method: "POST",
        headers: { "content-type": type },
        body: stream,
        duplex: "half",
      };
      await envelope(
        await rejectedResponse(action(args(new Request("http://test.local/", init)))),
        413,
        "Request body is too large.",
        false,
      );
    },
  );
});
