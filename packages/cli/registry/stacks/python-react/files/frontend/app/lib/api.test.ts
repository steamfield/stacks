import { HttpResponse, http } from "msw";
import { afterEach, expect, test, vi } from "vitest";
import { server } from "../../tests/mocks/server";
import { ApiError, apiFetch } from "./api";

afterEach(() => vi.unstubAllEnvs());

test("reads the success body without an HTTP wrapper", async () => {
  await expect(apiFetch("/health")).resolves.toEqual({ status: "ok" });
});

test("keeps the public error code, status and correlation id", async () => {
  server.use(
    http.get("*/health", () =>
      HttpResponse.json(
        {
          error: {
            code: "UNAVAILABLE",
            message: "Service unavailable.",
            details: null,
            requestId: "request-123",
          },
        },
        { status: 503 },
      ),
    ),
  );
  await expect(apiFetch("/health")).rejects.toMatchObject({
    name: "ApiError",
    code: "UNAVAILABLE",
    status: 503,
    message: "Service unavailable.",
    requestId: "request-123",
  });
});

test("rejects a malformed error envelope without exposing its body", async () => {
  server.use(http.get("*/health", () => HttpResponse.json({ secret: "hidden" }, { status: 502 })));
  await expect(apiFetch("/health")).rejects.toEqual(
    new ApiError("INVALID_RESPONSE", "API returned HTTP 502", 502),
  );
});

test.each(["<html>private upstream error</html>", ""])(
  "retains the HTTP status for a non-JSON error body %j",
  async (body) => {
    server.use(http.get("*/health", () => new HttpResponse(body, { status: 503 })));
    await expect(apiFetch("/health")).rejects.toMatchObject({
      name: "ApiError",
      code: "INVALID_RESPONSE",
      status: 503,
      message: "API returned invalid JSON (HTTP 503)",
    });
  },
);

test("uses the configured API origin", async () => {
  vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
  server.use(
    http.options(
      "https://api.example.test/health",
      () =>
        new HttpResponse(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET",
          },
        }),
    ),
  );
  server.use(
    http.get("https://api.example.test/health", () =>
      HttpResponse.json({ status: "ok" }, { headers: { "Access-Control-Allow-Origin": "*" } }),
    ),
  );
  await expect(apiFetch("/health")).resolves.toEqual({ status: "ok" });
});
