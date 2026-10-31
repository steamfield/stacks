import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "../router.ts";

const Health = z.object({ status: z.literal("ok") }).openapi("Health");

const health = createRoute({
  method: "get",
  path: "/healthz",
  operationId: "health",
  responses: {
    200: { description: "The server is up", content: { "application/json": { schema: Health } } },
  },
});

export function healthRoutes() {
  return createRouter().openapi(health, (c) => c.json({ status: "ok" as const }, 200));
}
