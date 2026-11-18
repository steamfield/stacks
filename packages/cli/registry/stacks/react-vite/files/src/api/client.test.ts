/**
 * Exercises the fetch client against MSW responses for GET, POST and 204 answers and for HTTP,
 * network and decoding failures. It also checks safe logging and cancellation passthrough.
 */

import { HttpResponse, http } from "msw";
import { expect, onTestFinished, test, vi } from "vitest";
import { z } from "zod";
import { server, TEST_API_URL } from "../../tests/msw/server";
import { createLogger } from "../logging";
import { createApiClient } from "./client";
import { ApiError } from "./errors";

const Body = z.object({ name: z.string() });

function client() {
  const logger = createLogger("silent");
  const spies = { warn: vi.spyOn(logger, "warn"), error: vi.spyOn(logger, "error") };
  return { api: createApiClient({ baseUrl: TEST_API_URL, logger }), ...spies };
}

const answer = (response: () => Response) => server.use(http.get("*/api/thing", response));

test("decodes a successful body with the schema", async () => {
  answer(() => HttpResponse.json({ name: "ok", extra: true }));
  await expect(client().api.get("/thing", Body)).resolves.toEqual({ name: "ok" });
});

test("sends a POST with a JSON body and decodes the answer", async () => {
  server.use(
    http.post("*/api/thing", async ({ request }) =>
      HttpResponse.json(
        {
          name: `${request.headers.get("content-type")} ${request.headers.get("x-trace")}`,
          sent: await request.json(),
        },
        { status: 201 },
      ),
    ),
  );
  const Created = z.object({ name: z.string(), sent: z.object({ title: z.string() }) });
  const created = await client().api.request("/thing", Created, {
    method: "POST",
    body: { title: "new" },
    headers: { "x-trace": "t-1" },
  });
  expect(created).toEqual({ name: "application/json t-1", sent: { title: "new" } });
});

test("lets a caller's headers replace the defaults, whatever their case", async () => {
  server.use(
    http.patch("*/api/thing", ({ request }) =>
      HttpResponse.json({
        name: `${request.headers.get("accept")} ${request.headers.get("content-type")}`,
      }),
    ),
  );
  const fetched = vi.spyOn(globalThis, "fetch");
  onTestFinished(() => fetched.mockRestore());
  const patched = await client().api.request("/thing", Body, {
    method: "PATCH",
    body: { title: "renamed" },
    headers: { Accept: "application/problem+json", "Content-Type": "application/merge-patch+json" },
  });
  expect(patched).toEqual({ name: "application/problem+json application/merge-patch+json" });
  // happy-dom keeps the last of two names that differ only in case, where browsers and Node
  // join them, so also check that fetch got each header name once.
  const headers = fetched.mock.calls[0]?.[1]?.headers;
  const names = headers instanceof Headers ? [...headers.keys()] : Object.keys(headers ?? {});
  expect(names.map((name) => name.toLowerCase()).sort()).toEqual(["accept", "content-type"]);
});

test("refuses a body on GET before sending anything", async () => {
  const sent = vi.fn(() => HttpResponse.json({ name: "sent" }));
  answer(sent);
  const error = await client()
    .api.request("/thing", Body, { body: { title: "x" } })
    .catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(TypeError);
  expect(error).not.toBeInstanceOf(ApiError);
  expect(sent).not.toHaveBeenCalled();
});

test("resolves a 204 without reading a body", async () => {
  server.use(http.delete("*/api/thing", () => new HttpResponse(null, { status: 204 })));
  await expect(
    client().api.request("/thing", z.undefined(), { method: "DELETE" }),
  ).resolves.toBeUndefined();
});

test("rejects a 204 when the caller's schema expects a body", async () => {
  server.use(http.delete("*/api/thing", () => new HttpResponse(null, { status: 204 })));
  const answered = client().api.request("/thing", Body, { method: "DELETE" });
  await expect(answered).rejects.toMatchObject({ kind: "decode", status: 204 });
});

test("rejects a non-2xx answer with its status and request id, and logs it", async () => {
  answer(() =>
    HttpResponse.json({ secret: "body" }, { status: 503, headers: { "x-request-id": "req-1" } }),
  );
  const { api, warn } = client();
  const error = await api.get("/thing", Body).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ kind: "http", status: 503, requestId: "req-1", path: "/thing" });
  expect(warn).toHaveBeenCalledWith("api_error", {
    path: "/thing",
    status: 503,
    requestId: "req-1",
  });
});

test("rejects a body that doesn't match the schema, logging no body content", async () => {
  answer(() => HttpResponse.json({ name: 42, token: "private" }));
  const { api, error } = client();
  await expect(api.get("/thing", Body)).rejects.toMatchObject({ kind: "decode", status: 200 });
  expect(JSON.stringify(error.mock.calls)).not.toContain("private");
});

test("rejects a 2xx answer that isn't JSON", async () => {
  answer(() => new HttpResponse("<html>a proxy page</html>", { status: 200 }));
  await expect(client().api.get("/thing", Body)).rejects.toMatchObject({ kind: "decode" });
});

test("turns a failed connection into a network error", async () => {
  answer(() => HttpResponse.error());
  await expect(client().api.get("/thing", Body)).rejects.toMatchObject({ kind: "network" });
});

test("passes a cancellation through untouched", async () => {
  answer(() => HttpResponse.json({ name: "late" }));
  const controller = new AbortController();
  controller.abort();
  const error = await client()
    .api.get("/thing", Body, { signal: controller.signal })
    .catch((caught: unknown) => caught);
  expect(error).not.toBeInstanceOf(ApiError);
});
