import { HttpResponse, http } from "msw";
import { expect, test, vi } from "vitest";
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
