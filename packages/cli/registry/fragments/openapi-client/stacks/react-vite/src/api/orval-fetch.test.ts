/**
 * Exercises the Orval mutator against MSW answers: a generated POST reaches the API through the
 * app's client with its JSON body and headers, failures keep the client's ApiError, and a call
 * made without the client is refused before any request.
 */

import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { server, TEST_API_URL } from "../../tests/msw/server";
import { createLogger } from "../logging";
import { createApiClient } from "./client";
import { ApiError } from "./errors";
import { orvalFetch } from "./orval-fetch";

const api = createApiClient({ baseUrl: TEST_API_URL, logger: createLogger("silent") });

test("sends a generated POST's JSON body and headers through the API client", async () => {
  server.use(
    http.post("*/api/v1/notes", async ({ request }) =>
      HttpResponse.json(
        { sent: await request.json(), trace: request.headers.get("x-trace") },
        { status: 201 },
      ),
    ),
  );
  const created = await orvalFetch("/v1/notes", {
    api,
    method: "POST",
    headers: { "Content-Type": "application/json", "x-trace": "t-1" },
    body: JSON.stringify({ title: "New", body: "Text" }),
  });
  expect(created).toEqual({ sent: { title: "New", body: "Text" }, trace: "t-1" });
});

test("rejects a failed call with the client's ApiError and request id", async () => {
  server.use(
    http.get("*/api/v1/notes", () =>
      HttpResponse.json({}, { status: 503, headers: { "x-request-id": "req-503" } }),
    ),
  );
  const failure = await orvalFetch("/v1/notes", { api }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ApiError);
  expect(failure).toMatchObject({ kind: "http", status: 503, requestId: "req-503" });
});

test("refuses a call made without the API client", async () => {
  await expect(orvalFetch("/v1/notes", { method: "GET" })).rejects.toThrow(
    "GET /v1/notes needs the API client: pass { request: { api } }",
  );
});

test("refuses a body the API client can't send as JSON", async () => {
  await expect(
    orvalFetch("/v1/notes", { api, method: "POST", body: new FormData() }),
  ).rejects.toThrow("POST /v1/notes has a non-JSON body, which the API client can't send");
});
