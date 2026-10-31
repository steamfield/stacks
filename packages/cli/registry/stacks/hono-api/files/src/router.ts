import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import { BadRequestError, type Issue } from "./errors.ts";

export type AppEnv = { Variables: RequestIdVariables };

/**
 * Every router comes from here. The validation hook lives on each OpenAPIHono instance, not on the
 * app it's mounted into, so a router built with `new OpenAPIHono()` would answer invalid input
 * with Hono's plain-text 400 instead of the error envelope.
 */
export function createRouter(): OpenAPIHono<AppEnv> {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        const issues: Issue[] = result.error.issues.map((issue) => ({
          path: [result.target, ...issue.path].join("."),
          message: issue.message,
        }));
        throw new BadRequestError(issues);
      }
    },
  });
}
