import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { describe, expect, it } from "vitest";
import { createLogger, requestLogger } from "./logging.ts";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger("debug", {
    write: (line: string) => {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  return { logger, lines };
}

describe("createLogger", () => {
  it("writes JSON with an ISO time and a text level", () => {
    const { logger, lines } = capture();
    logger.info({ port: 1 }, "listening");
    expect(lines[0]).toMatchObject({ level: "info", msg: "listening", port: 1 });
    expect(String(lines[0]?.time)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("redacts secret-shaped keys at the top level and one level down", () => {
    const { logger, lines } = capture();
    logger.info({ password: "p1", user: { token: "t1", name: "ada" } }, "event");
    const text = JSON.stringify(lines[0]);
    expect(text).not.toContain("p1");
    expect(text).not.toContain("t1");
    expect(lines[0]).toMatchObject({ password: "[redacted]", user: { name: "ada" } });
  });
});

describe("requestLogger", () => {
  it("logs only allowlisted fields: no query, headers or body", async () => {
    const { logger, lines } = capture();
    const app = new Hono()
      .use(requestId())
      .use(requestLogger(logger))
      .post("/v1/items/:id", (c) => c.json({ ok: true }));
    await app.request("/v1/items/7?token=query-secret", {
      method: "POST",
      headers: { authorization: "Bearer header-secret", "content-type": "application/json" },
      body: JSON.stringify({ password: "body-secret" }),
    });
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0] ?? {}).sort()).toEqual(
      ["durationMs", "level", "method", "msg", "requestId", "route", "status", "time"].sort(),
    );
    expect(lines[0]).toMatchObject({ method: "POST", route: "/v1/items/:id", status: 200 });
    expect(JSON.stringify(lines)).not.toMatch(/secret/);
  });
});
