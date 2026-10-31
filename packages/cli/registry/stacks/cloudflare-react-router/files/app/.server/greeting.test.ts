import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { greeting } from "./greeting";

test("reads a real Wrangler binding in the Workers runtime", () => {
  expect(greeting(env)).toBe("Hello from Workers");
});

test("defaults an absent binding and trims public configuration", () => {
  expect(greeting({})).toBe("Hello from Workers");
  expect(greeting({ GREETING: "  Hello  " })).toBe("Hello");
});

test.each(["", "   ", "x".repeat(65), 42])(
  "rejects invalid public configuration: %j",
  async (value) => {
    try {
      greeting({ GREETING: value });
      expect.fail("invalid binding was accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      if (!(error instanceof Response)) throw error;
      expect(error.status).toBe(503);
      expect(await error.text()).toBe("Service unavailable.");
    }
  },
);
