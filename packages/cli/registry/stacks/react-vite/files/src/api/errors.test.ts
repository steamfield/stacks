import { expect, test } from "vitest";
import { ApiError, isRetryable, userMessage } from "./errors";

const http = (status: number) => new ApiError({ kind: "http", path: "/items", status });

test.each([
  [new ApiError({ kind: "network", path: "/items" }), true],
  [http(503), true],
  [http(429), true],
  [http(500), false],
  [http(404), false],
  [new ApiError({ kind: "decode", path: "/items", status: 200 }), false],
  [new Error("not an ApiError"), false],
])("isRetryable(%s) is %s", (error, expected) => {
  expect(isRetryable(error)).toBe(expected);
});

test.each([
  [new ApiError({ kind: "network", path: "/items" }), "Couldn't reach the server"],
  [new ApiError({ kind: "decode", path: "/items", status: 200 }), "can't read"],
  [http(401), "don't have access"],
  [http(404), "Not found."],
  [http(502), "The server had a problem."],
  [http(422), "The request failed."],
  ["thrown string", "Something went wrong."],
])("userMessage(%s) says %s", (error, expected) => {
  expect(userMessage(error)).toContain(expected);
});
